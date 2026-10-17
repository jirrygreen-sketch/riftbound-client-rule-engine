import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/undying-loyalty.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7931567b3f67164c8892f798e2afcb96c5f980a4e74c3677fdb5e52bb602b376";
const SOURCE_TEXT =
  "This costs :rb_energy_2: less if you choose a Bird, Cat, Dog, or Poro.\n" +
  "Play a unit with cost no more than :rb_energy_2: and no more than :rb_rune_rainbow: from your trash, ignoring its cost.";

const [discount, play] = program.abilities;
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
      might: 1,
      energy: 2,
      power: null,
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

test("unl-168-219 Undying Loyalty: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /356\.1\.c/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /RIFT-261/);
});

test("unl-168-219 Undying Loyalty: the conditional [2] energy discount is declared as cost.modify", () => {
  // 356.4 / 356.4.d: a discount on the total printed cost, evaluated in the
  // Finalize cost steps; consumed by the cost system (RIFT-261).
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "cost.modify");
  assert.deepEqual(discount.effect.value, { kind: "constant", value: { energy: -2 } });
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.effect.appliesTo, "play-cost");
  // "if you choose a Bird, Cat, Dog, or Poro": the condition reads the choice
  // made while playing; no merged expression exposes it (judgeReason).
  assert.deepEqual(discount.condition, {
    kind: "expression",
    value: { kind: "constant", value: "you-choose-Bird-Cat-Dog-or-Poro" }
  });
});

test("unl-168-219 Undying Loyalty: printed cost plus the trash-unit play with descriptive cost ceilings", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(playUnit.op, "effect.play");
  assert.deepEqual(playUnit.args.target, {
    kind: "constant",
    value: "undying-loyalty.unit-in-trash"
  });
  // 356.1.b.1: "ignoring its cost" is a zero-base Energy/Power plan produced by
  // the cost pipeline (RIFT-261), never derived by effect.play itself.
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
  assert.deepEqual(playUnit.args.linkKey, { kind: "constant", value: "played" });
  assert.equal(playUnit.linkedTo, undefined);

  // 355.10.a: the Trash is public, so the unit is a target. The 356.1.c
  // printed-cost ceilings stay descriptive (see judgeReason).
  assert.deepEqual(playUnit.targets, [
    {
      id: "undying-loyalty.unit-in-trash",
      filter: {
        zone: "trash",
        type: "unit",
        owner: "controller",
        printedEnergyMax: 2,
        printedPowerMax: 1
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-168-219 Undying Loyalty golden: the merged play primitive plays the chosen trash unit for free", () => {
  const kernel = world().player("A").build();
  const ref = trashUnit(kernel, "poro", { tags: ["Poro"], energy: 2, power: null });
  kernel.setTargets("undying-loyalty.unit-in-trash", [ref]);
  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["undying-loyalty.play-unit", "executed"]]
  );
  assert.equal(outcome.linkedValues["undying-loyalty.play-unit.played"], 1);
  // 420.3 / 356.1.b.1: the unit enters the Board without paying its printed
  // 2 Energy (the zero-cost plan pays nothing).
  assert.equal(kernel.getObject("poro").zone, "board");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.events.map((event) => event.action), ["pay", "play"]);
});

test("unl-168-219 Undying Loyalty golden: a unit no longer in the Trash is mistargeted (359.3.e.6)", () => {
  const kernel = world().player("A").build();
  const stale = trashUnit(kernel, "recycled-poro", { tags: ["Poro"] });
  assert.equal(kernel.perform({ type: "recycle", object: stale }).status, "done");
  kernel.setTargets("undying-loyalty.unit-in-trash", [stale]);
  const outcome = resolveChainBody(executableBody, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["undying-loyalty.play-unit", "ignored", "mistargeted"]]
  );
  assert.equal(kernel.getObject("recycled-poro").zone, "deck");
});

test.todo(
  "unl-168-219 Undying Loyalty: apply the [2] energy discount at Finalize when the player chose a Bird, Cat, Dog, " +
    "or Poro (CR 356.4/356.4.d) — needs the cost.modify discount consumer (RIFT-261) plus an expression that reads " +
    "the play-time choice, which the frozen IR has no binding for (condition.result)"
);

test.todo(
  "unl-168-219 Undying Loyalty: enforce 'cost no more than :rb_energy_2: and no more than :rb_rune_rainbow:' as the " +
    "printed-cost ceiling of the trash target (CR 356.1.c) — needs the printed-cost predicate (RIFT-90) and support " +
    "for the 163.2.b Universal Power ([A]); it must never be approximated with a named domain"
);

test.todo(
  "unl-168-219 Undying Loyalty: generate the 356.1.b.1 ignore-cost finalized plan (base Energy and base Power 0) " +
    "from the chosen trash unit through the cost pipeline (RIFT-261)"
);

