import { buildHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/hidden.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/resonating-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fa3fca39f51f36c4a7eaf70e836d2271f5e26b7994a64cbafa1b79ec0ea7dad7";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Reaction] (Play on your turn or in showdowns.)\n" +
  "Choose a battlefield you control and a unit you control at a different location. " +
  "Move that unit to that battlefield and give it +2 :rb_might: this turn.";

const [hiddenKeyword, reactionKeyword, play] = program.abilities;
const [moveInstruction, mightInstruction] = play.body;
const [unitSpec, battlefieldSpec] = moveInstruction.targets;

test("ven-034-166 Resonating Strike: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-034-166 Resonating Strike: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /811/);
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /differentLocationThan/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|120)/);
});

test("ven-034-166 Resonating Strike: both printed keywords are declared only", () => {
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(hiddenKeyword.value, undefined);
  assert.equal(reactionKeyword.value, undefined);
});

test("ven-034-166 Resonating Strike: printed cost, the two Finalize choices and the symbolic destination", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  // 355.4/355.4.a: the Move destination is the chosen battlefield, a runtime
  // Location resolved from the finalized battlefield target by the interpreter.
  assert.equal(moveInstruction.id, "resonating-strike.move-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: { kind: "target-location", target: battlefieldSpec.id }
  });
  assert.deepEqual(battlefieldSpec.filter, { type: "battlefield", controller: "self" });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveInstruction.args.linkKey, { kind: "constant", value: "moved" });

  // 355.5/355.7: this sentence explicitly chooses two objects, so the
  // instruction carries both TargetSpecs.
  assert.deepEqual(unitSpec, {
    id: "resonating-strike.friendly-unit",
    filter: {
      type: "unit",
      zone: "board",
      controller: "controller",
      differentLocationThan: { target: "resonating-strike.battlefield" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(battlefieldSpec, {
    id: "resonating-strike.battlefield",
    filter: { type: "battlefield", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(moveInstruction.targets.length, 2);

  // "and give it +2 Might this turn": the same moved unit ("it"), a temporary
  // Might modification (317.2.c), never a Buff counter.
  assert.equal(mightInstruction.id, "resonating-strike.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.equal(mightInstruction.linkedTo, "resonating-strike.move-unit");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.target, { kind: "constant", value: unitSpec.id });
  assert.deepEqual(mightInstruction.targets, [unitSpec]);
});

test("ven-034-166 Resonating Strike golden: the merged Move really relocates the unit", () => {
  // Isolate the Move primitive with a literal Location and verify its receipt.
  // The original symbolic destination and linked body execute in the regression below.
  const kernel = world()
    .unit("ally", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const locked = kernel.ref("ally");

  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveInstruction.args.amount,
      linkKey: moveInstruction.args.linkKey
    },
    { world: kernel, targets: { [unitSpec.id]: [locked], ally: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("ven-034-166 Resonating Strike golden: +2 Might this turn registers on the moved unit", () => {
  const kernel = world()
    .unit("ally", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const locked = kernel.ref("ally");
  kernel.setTargets(unitSpec.id, [locked]);

  // Execute the card's own Expr arguments through the merged primitive. The
  // test supplies only the finalized TargetSpec binding; it does not replace
  // the card's target argument with a hand-written runtime object selector.
  const context = bindResolveContext(kernel, {
    query: filter => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
      }
      return kernel.objects.filter(object => matchesObjectFilter(normalized, object));
    }
  });

  // The Move link is removed only to isolate this already merged instruction;
  // all args and the TargetSpec are the card's originals.
  const run = runAbilityBody([{ ...mightInstruction, linkedTo: undefined }], context);

  assert.equal(run.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.effect.filter.objectId, "ally");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});

test("ven-034-166 Resonating Strike regression: the original linked body moves to the selected battlefield then grants +2", () => {
  const kernel = world()
    .unit("ally", { might: 3, location: { type: "base", player: "A" } })
    .unit("battlefield", { types: ["battlefield"], location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("ally")]);
  kernel.setTargets(battlefieldSpec.id, [kernel.ref("battlefield")]);
  const outcome = runAbilityBody(play.body, finalizedContext(kernel));
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [moveInstruction.id, "executed"], [mightInstruction.id, "executed"]
  ]);
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
  assert.equal(outcome.linkedValues[`${moveInstruction.id}.moved`].count, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.filter.objectId, "ally");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});

test.todo(
  "ven-034-166 Resonating Strike: enforce 'a unit you control at a different location' as a 355.11 group " +
    "restriction over both targets, and the 190 battlefield-control predicate for 'a battlefield you control' " +
    "— programs/filters.ts and target-plan still lack the cross-target/battlefield-control adapter"
);

test.todo(
  "ven-034-166 Resonating Strike: give the moved unit +2 Might this turn — the +2 arithmetic registration is " +
    "proven with the original linked body, but production Finalize still needs the group-restriction plan"
);

test.todo(
  "ven-034-166 Resonating Strike: [Hidden] (811) — the Hide action, the facedown zone, free play from facedown " +
    "and the 811.1.d.2 target narrowing need a consumer for cost.hidden; buildHiddenCostPlan already supports both costs"
);

function finalizedContext(kernel) {
  return bindResolveContext(kernel, { query: filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
      if (normalized[key] === "opponent") normalized[key] = kernel.playerIds().find(id => id !== kernel.controller);
    }
    return kernel.query(normalized);
  } });
}

test("ven-034-166 Resonating Strike: Hidden cost plans already support the [A] hide cost and zero base play cost", () => {
  const base = world().hand("strike", { types: ["spell"], energy: 2, power: ["Calm"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("strike") });
  const hide = buildHiddenCostPlan(kernel, { id: "strike:hide", mode: "hide", domains: [] });
  assert.equal(hide.total.energy, 0);
  assert.equal(hide.total.power[0].amount, 1);
  assert.deepEqual(hide.total.power[0].allowedDomains, ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  const playHidden = buildHiddenCostPlan(kernel, { id: "strike:play-hidden", mode: "play" });
  assert.equal(playHidden.total.energy, 0);
  assert.deepEqual(playHidden.total.power, []);
  assert.deepEqual(playHidden.printed, { energy: 2, power: ["Calm"] });
  assert.equal(kernel.getObject("strike").zone, "hand", "cost planning alone does not perform Hide or Play");
});
