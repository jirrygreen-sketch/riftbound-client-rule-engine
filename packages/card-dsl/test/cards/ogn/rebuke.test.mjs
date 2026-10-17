import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/rebuke.js";
import action from "../../../../engine-core/dist/effects/keywords/Action.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/index.js";
import { actionTimings, canAct } from "../../../../engine-core/dist/layers/rules/query.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-b729f880ae397e8eedd9b1e93aaab464d98abc273a98ec06ba2e03bf7c0c97a6";
const play = program.abilities.find((ability) => ability.kind === "play");
const [returnInstruction] = play.body;
const targetSpec = returnInstruction.targets[0];

const returnWithLockedTarget = (kernel, ref) =>
  runInstruction(
    zone,
    {
      target: returnInstruction.args.target.value,
      to: returnInstruction.args.to,
      amount: returnInstruction.args.amount
    },
    { world: kernel, targets: { [targetSpec.id]: [ref] } }
  );

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher, and the layers filter matcher reads
 * location: "battlefield" as the Location *type*. The reference kernel's own
 * query compares filter values literally, so the goldens below go through the
 * same normalization the production chain applies (the merged switcheroo /
 * facebreaker goldens use this exact helper).
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

test("ogn-172-298 Rebuke: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Return a unit at a battlefield to its owner's hand."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-172-298 Rebuke: [Action] keyword plus one battlefield-scoped return target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(returnInstruction.id, "rebuke.return-unit");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(targetSpec, {
    id: "rebuke.unit-at-battlefield",
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(returnInstruction.picks, undefined);
});

test("ogn-172-298 Rebuke golden: the unit returns to its OWNER's hand (108.1)", () => {
  const kernel = world()
    .unit("human-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = returnWithLockedTarget(kernel, kernel.ref("human-unit"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("human-unit").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["human-unit"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(run.linked.destination, "hand");
});

test("ogn-172-298 Rebuke golden: a stale battlefield target is ignored (359.3.e.6-e.8)", () => {
  const kernel = world()
    .unit("departing-unit", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("departing-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = returnWithLockedTarget(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("departing-unit").zone, "trash");
});

test("ogn-172-298 Rebuke: the declared [Action] grant is consumed by the merged timing query (806.1.c / RIFT-259)", () => {
  // The card only names the keyword (contract 3.7); the keyword registry owns
  // the expansion and the layers/rules query decides the admission.
  const [grant] = action.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(grant.effect.kind, "continuous.timing");

  const kernel = world().object("rebuke", { zone: "chain", types: ["spell"], owner: "A", controller: "A" }).build();
  const registry = new ContinuousEffectRegistry();
  registry.register({ id: "rebuke-action", source: kernel.ref("rebuke"), filter: {}, effect: grant.effect }, { type: "permanent" }, 1);
  assert.deepEqual(actionTimings(registry, kernel.ref("rebuke"), kernel.getObject("rebuke"), "A"), ["showdown"]);

  const base = { player: "A", speed: "action", closedState: false, priorityHolder: "A", ref: kernel.ref("rebuke"), object: kernel.getObject("rebuke") };
  // Showdown during the opponent's turn: the printed [Action] permission allows it.
  assert.equal(canAct(registry, { ...base, showdown: true, turnPlayer: "B", focusHolder: "A" }), true);
  // Outside a Showdown on the opponent's turn: still not playable.
  assert.equal(canAct(registry, { ...base, showdown: false, turnPlayer: "B" }), false);
  // The controller's own open turn remains playable.
  assert.equal(canAct(registry, { ...base, showdown: false, turnPlayer: "A" }), true);
});

test("ogn-172-298 Rebuke golden: the card body returns the unit to its owner's hand through the chain adapter", () => {
  const kernel = world()
    .unit("human-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("human-unit")]);
  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["rebuke.return-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("human-unit").zone, "hand");
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["human-unit"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand"]);
});

test("ogn-172-298 Rebuke golden: the 359.3.e.9 example — moving to Base after Finalize Mistargets the locked unit", () => {
  // Rebuke's own rules example: the chosen unit leaves the battlefield (here it
  // moves to its Base) when Rebuke resolves, so the choice is Mistargeted and
  // the return instruction does not execute.
  const kernel = world()
    .unit("mover", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const context = chainContext(kernel, "A");

  const plan = finalizeTargetPlan(context, {
    id: targetSpec.id,
    filter: targetSpec.filter,
    min: targetSpec.min,
    max: targetSpec.max,
    selection: targetSpec.selection
  }, { selected: [kernel.ref("mover")] });
  assert.deepEqual(plan.selected.map((ref) => ref.id), ["mover"]);
  assert.equal(resolveTargetPlan(context, plan).status, "resolved");

  kernel.perform({ type: "move-location", object: kernel.ref("mover"), to: { type: "base", player: "B" } });
  const resolution = resolveTargetPlan(context, plan);
  assert.equal(resolution.status, "ignored");
  assert.equal(resolution.reason, "mistargeted");
  assert.deepEqual(resolution.selected, []);

  // The re-verified (empty) target set drives the real instruction: it is
  // ignored as mistargeted and the unit stays in its Base.
  const run = runInstruction(
    zone,
    {
      target: returnInstruction.args.target.value,
      to: returnInstruction.args.to,
      amount: returnInstruction.args.amount
    },
    { world: kernel, targets: { [targetSpec.id]: [...resolution.selected] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.getObject("mover").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.zone("B", "hand"), []);
});
