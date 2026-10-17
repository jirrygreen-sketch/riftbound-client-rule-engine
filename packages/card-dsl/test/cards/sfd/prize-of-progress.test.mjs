// Golden test for Prize of Progress (sfd-075-221).
//
// The card keeps judge-required: the ability-activated subscription still has no
// production caller, so "When you use an activated ability of a gear" cannot
// enter the chain. The body half is fully merged, so the golden really executes
// "give me +1 Might this turn" through the interpreter + layer engine and
// asserts the registered arithmetic-layer effect and its end-of-turn duration.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/prize-of-progress.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/index.js";
import { deriveAbilityActivatedEmission } from "../../../../engine-core/dist/events/producers/ability-activation.js";

const CARD_ID = "card.hash-2affca3f8f8306aa0687163e5113f3532b04acb9960f806d7a7eba3bf504104a";
const SOURCE_TEXT =
  "When you use an activated ability of a gear, give me +1 :rb_might: this turn.";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;

const prizeWorld = () =>
  world()
    .unit("prize-of-progress", {
      cardId: CARD_ID,
      types: ["unit"],
      might: 3,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("other-unit", {
      types: ["unit"],
      might: 3,
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();

const effectiveMight = (kernel, id) =>
  createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({
      effect: entry.effect,
      duration: entry.duration,
      timestamp: 1
    }))
  ).evaluate(kernel.ref(id)).might;

test("sfd-075-221 Prize of Progress: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-075-221 Prize of Progress: judgeReason names the current missing caller and the merged body", () => {
  assert.match(program.judgeReason, /ability-activated/);
  assert.match(program.judgeReason, /deriveAbilityActivatedEmission/);
  assert.match(program.judgeReason, /producers|programs\/activate/);
  // The Might primitive and its end-of-turn duration are merged now, so the
  // reason must not keep claiming a missing primitive.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /已合入|merged/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-075-221 Prize of Progress: the trigger subscribes to ability-activated for gear sources", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 400/402/405-407: using an activated ability runs the same steps as playing
  // a card; the availability of the timing point is what a score trigger needs.
  assert.equal(ability.trigger.at, "ability-activated");
  assert.deepEqual(ability.trigger.filter, {
    event: "ability-activated",
    // "you use": the activating player is the ability's controller (190.6.d).
    player: "self",
    // "of a gear": the used ability's source object is the event's sourceId.
    source: { type: "gear" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("sfd-075-221 Prize of Progress: the subscription target is a declared timing point", () => {
  assert.equal(getTimingPoint("ability-activated").id, "ability-activated");
  assert.equal(ability.trigger.at, "ability-activated");
});

test("sfd-075-221 Prize of Progress: the merged producer emits ability-activated only for a committed activation", () => {
  // The merged pure producer has no production caller yet
  // (judgeReason). The golden asserts the producer's own contract so the
  // remaining wiring is unambiguous.
  const committed = deriveAbilityActivatedEmission({
    status: "committed",
    chainItemId: "chain:1",
    playerId: "A",
    sourceId: "gear-1",
    abilityId: "ability:1"
  });
  assert.equal(committed.timingPoint, "ability-activated");
  assert.equal(committed.player, "A");
  assert.deepEqual(committed.details, {
    chainItemId: "chain:1",
    playerId: "A",
    sourceId: "gear-1",
    abilityId: "ability:1"
  });
  // Cancelled / countered / invalid activations produce no timing at all.
  for (const status of ["cancelled", "countered", "invalid"]) {
    assert.equal(
      deriveAbilityActivatedEmission({
        status,
        chainItemId: "chain:1",
        playerId: "A",
        sourceId: "gear-1",
        abilityId: "ability:1"
      }),
      null
    );
  }
});

test("sfd-075-221 Prize of Progress: the body declares a one-turn self Might modification", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "prize-of-progress.give-plus-1-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the ability host: the merged appliesTo shorthand, never a runtime
  // ObjectRef and never a Buff counter (702/703).
  assert.deepEqual(mightInstruction.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
});

test("sfd-075-221 Prize of Progress golden: the body registers +1 Might on itself until end of turn", () => {
  const kernel = prizeWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("prize-of-progress") });

  const outcome = resolveChainBody(ability.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["prize-of-progress.give-plus-1-might", "executed"]
  ]);
  assert.equal(scoped.continuousEffects.length, 1);
  const [registration] = scoped.continuousEffects;
  // 478.1.a: the modification lands in the arithmetic layer.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  // 317.1.a / 468.7.c: "this turn" is registered as the end-of-turn duration.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.filter.objectId, "prize-of-progress");
  // The host is the only affected object.
  assert.equal(effectiveMight(scoped, "prize-of-progress"), 4);
  assert.equal(effectiveMight(scoped, "other-unit"), 3);
});

test.todo(
  "sfd-075-221 Prize of Progress: the merged deriveAbilityActivatedEmission needs a chain caller that " +
    "hands it every committed activation result, so the ability-activated timing really enters the pipeline " +
    "(CR 400/402/405-407); programs/activate.ts currently only builds a ChainDraft"
);

