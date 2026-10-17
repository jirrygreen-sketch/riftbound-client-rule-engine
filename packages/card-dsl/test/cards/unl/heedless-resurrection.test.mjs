import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/heedless-resurrection.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8a8cf37e4136f085e1b3f5e57e7db30e4b4ddadd4f76bcb5a00d613d15514798";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "As an additional cost to play this, kill a friendly unit.\n" +
  "Play a unit from your trash that costs no more Energy and no more Power than the killed unit, ignoring its cost.";

const [speed, costAbility, play] = program.abilities;
const [playUnit] = play.body;
const executableBody = play.body.map(({ targets, ...rest }) => rest);

const trashUnit = (kernel, id, values = {}) => {
  kernel.addObject(
    {
      ref: { id, zoneEntryId: 1 },
      cardId: "card:" + id,
      name: id,
      types: ["unit"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "trash",
      location: null,
      might: 2,
      energy: 2,
      power: ["Chaos"],
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false,
      ...values
    },
    "trash"
  );
  return kernel.ref(id);
};

test("unl-142-219 Heedless Resurrection: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // The remaining gaps are card-program cost consumption, cost-result
  // binding, and the printed-cost ceiling predicate.
  assert.match(program.judgeReason, /356\.2\.a\.1/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|261)/);
});

test("unl-142-219 Heedless Resurrection: [Reaction] plus the mandatory kill-friendly-unit additional cost", () => {
  // 813: the printed [Reaction] permission is a keyword the registry expands.
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  // 356.2.a.1: "as an additional cost" without "may" is a Mandatory Additional
  // Cost; 355.10.c states the killed unit is not a target.
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "cost.additional");
  assert.equal(costAbility.effect.optional, false);
  assert.equal(costAbility.effect.stage, "mandatory-additional");
  assert.deepEqual(costAbility.effect.payments, [
    {
      kind: "kill",
      amount: { kind: "constant", value: 1 },
      choice: {
        id: "heedless-resurrection.friendly-unit",
        options: ["dynamic:friendly-unit"],
        min: 1,
        max: 1,
        selection: "one",
        filter: { type: "unit", zone: "board", controller: "controller" }
      }
    }
  ]);
});

test("unl-142-219 Heedless Resurrection: printed cost plus a trash-unit play with the ignore-cost plan shape", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(playUnit.op, "effect.play");
  assert.deepEqual(playUnit.args.target, {
    kind: "constant",
    value: "heedless-resurrection.unit-in-trash"
  });
  // 356.1.b.1: "ignoring its cost" sets base Energy and Power to 0; the
  // The finalized plan itself would be produced by the cost pipeline.
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
  assert.deepEqual(playUnit.args.linkKey, { kind: "constant", value: "played" });
  assert.equal(playUnit.linkedTo, undefined);

  // 355.10.a / 355.9.a: the Trash is a public zone, so the unit is a target.
  // The printed-cost ceiling against the killed unit stays descriptive
  // (356.1.c; see judgeReason).
  assert.deepEqual(playUnit.targets, [
    {
      id: "heedless-resurrection.unit-in-trash",
      filter: {
        zone: "trash",
        type: "unit",
        owner: "controller",
        printedCostNoMoreThanKilledUnit: true
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-142-219 Heedless Resurrection golden: the merged play primitive plays the locked trash unit ignoring its cost", () => {
  const kernel = world().player("A").build();
  const ref = trashUnit(kernel, "killed-unit", { energy: 2, power: ["Chaos"] });
  kernel.setTargets("heedless-resurrection.unit-in-trash", [ref]);
  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["heedless-resurrection.play-unit", "executed"]]
  );
  assert.equal(outcome.linkedValues["heedless-resurrection.play-unit.played"], 1);
  // 420.3 / 356.1.b.1: the card leaves the Trash and enters the Board for zero
  // base Energy and Power; the printed 2 Energy / 1 Chaos is not charged.
  assert.equal(kernel.getObject("killed-unit").zone, "board");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.events.map((event) => event.action), ["pay", "play"]);
});

test("unl-142-219 Heedless Resurrection golden: the merged kill primitive performs the cost's non-target pick", () => {
  // 355.10.c: the cost's unit is a pick, never a target (no became-target
  // events); the merged effect.kill consumes a PickSpec.
  const kernel = world()
    .unit("fodder", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const run = runInstruction(
    kill,
    { picks: "heedless-resurrection.friendly-unit" },
    { world: kernel, picks: { "heedless-resurrection.friendly-unit": [kernel.ref("fodder")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "fodder", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("fodder").zone, "trash");
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("unl-142-219 Heedless Resurrection golden: a trash unit that already left for the Board is mistargeted (359.3.e.6)", () => {
  const kernel = world().player("A").build();
  const stale = trashUnit(kernel, "recycled-unit");
  assert.equal(kernel.perform({ type: "recycle", object: stale }).status, "done");
  kernel.setTargets("heedless-resurrection.unit-in-trash", [stale]);
  const outcome = resolveChainBody(executableBody, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["heedless-resurrection.play-unit", "ignored", "mistargeted"]]
  );
  assert.equal(kernel.getObject("recycled-unit").zone, "deck");
});

test.todo(
  "unl-142-219 Heedless Resurrection: charge the mandatory 'kill a friendly unit' additional cost at Finalize " +
    "(CR 356.2.a/356.2.a.1, 355.10.c non-targeting cost) — cost/plan-values.ts supports kill payments, but no merged " +
    "card-program consumer turns the static cost.additional ability into CostPlanInput.mandatoryAdditional"
);

test.todo(
  "unl-142-219 Heedless Resurrection: restrict the played trash unit to 'costs no more Energy and no more Power " +
    "than the killed unit' (CR 356.1.c printed-cost comparison against the cost's chosen object) — needs the " +
    "printed-cost predicate and a cost-result binding"
);

test.todo(
  "unl-142-219 Heedless Resurrection: generate the 356.1.b.1 ignore-cost finalized plan from the chosen trash unit " +
    "(base Energy and base Power set to 0) through the card play Finalize adapter"
);
