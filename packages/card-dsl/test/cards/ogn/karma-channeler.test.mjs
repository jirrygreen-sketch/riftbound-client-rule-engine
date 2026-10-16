import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/karma-channeler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { isTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d";
const [vision, recycleTrigger] = program.abilities;
const [buffInstruction] = recycleTrigger.body;
const [friendlyUnit] = buffInstruction.targets;

test("ogn-235-298 Karma, Channeler: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-235-298 Karma, Channeler: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /card-recycled/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)"
  );
});

test("ogn-235-298 Karma, Channeler: [Vision] is declared as a keyword ability", () => {
  // CR 817.1.b: Vision is functionally "When this is played, [Predict]"; the expansion lives
  // in engine-core/src/effects/keywords/Vision.ts (contract 3.7).
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
});

test("ogn-235-298 Karma, Channeler: the recycle clause is a mandatory buff of one friendly unit", () => {
  assert.equal(recycleTrigger.kind, "triggered");
  assert.equal(recycleTrigger.trigger.at, "card-recycled");
  assert.deepEqual(recycleTrigger.trigger.filter, { event: "card-recycled", player: "self" });
  assert.equal(recycleTrigger.optional, false);

  assert.equal(buffInstruction.id, "karma-channeler.buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "karma-channeler.friendly-unit" }
  });
  assert.equal(buffInstruction.targets.length, 1);
  assert.equal(friendlyUnit.id, "karma-channeler.friendly-unit");
  assert.deepEqual(friendlyUnit.filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });
  assert.equal(friendlyUnit.min, 1);
  assert.equal(friendlyUnit.max, 1);
  assert.equal(friendlyUnit.selection, "one");
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("ogn-235-298 Karma, Channeler: the merged trigger matcher rejects the declared recycle event name", () => {
  // events/trigger-spec.ts keeps a closed EVENT_PATTERN_TYPES list and its validator
  // rejects any name outside it; "card-recycled" is not a member, so the declared
  // trigger cannot be registered by the production pipeline today.
  assert.equal(isTriggerSpec({ at: "card-recycled", filter: recycleTrigger.trigger.filter }), false);
  // The timing point itself exists (events/timing-points.ts), which is the mismatch.
  assert.equal(recycleTrigger.trigger.at, "card-recycled");
});

test("ogn-235-298 Karma, Channeler: the buff clause executes against a friendly unit (CR 702.2.a)", () => {
  const kernel = world().unit("karma").unit("ally").build();
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: friendlyUnit.id
  }, {
    world: kernel,
    targets: { [friendlyUnit.id]: [kernel.ref("ally")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(run.result.linkedValues.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test("ogn-235-298 Karma, Channeler: a unit that already has a buff is not buffed twice (CR 702.3.a)", () => {
  const kernel = world().unit("karma").unit("ally", { buffs: 1 }).build();
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: friendlyUnit.id
  }, {
    world: kernel,
    targets: { [friendlyUnit.id]: [kernel.ref("ally")] }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
  // The negated result carries no linkedValues object, but the primitive still publishes
  // the actual per-unit outcome through ctx.link (CR 427.1.c).
  assert.equal(run.linked.buffedCount, 0);
  assert.deepEqual(run.linked.buffed, []);
});

test("ogn-235-298 Karma, Channeler: the declared buff instruction runs through the ability interpreter", () => {
  const kernel = world().unit("karma").unit("ally").build();
  kernel.setTargets(friendlyUnit.id, [kernel.ref("ally")]);
  const { targets, ...instruction } = buffInstruction;
  assert.equal(targets.length, 1);
  const outcome = resolveChainBody([instruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["karma-channeler.buff-friendly-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("ally").buffs, 1);
});

test.todo(
  "ogn-235-298 Karma, Channeler: [Vision]'s Predict step (CR 437.1/437.3) needs an ordered " +
    "top-of-deck source for effect.inspect (the merged primitive blocks non-zero top ranges " +
    "without an ordered picksSpecId)"
);
test.todo(
  "ogn-235-298 Karma, Channeler: registering the recycle trigger needs 'card-recycled' to be " +
    "part of the closed EVENT_PATTERN_TYPES plus the 'one or more cards' batch semantics and the " +
    "'Runes aren't cards' zone filter (CR 417.1/417.5, 185.1)"
);
