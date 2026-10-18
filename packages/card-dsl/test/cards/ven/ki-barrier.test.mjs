import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ki-barrier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";

const CARD_ID = "card.hash-c7314bf7e9131668bdd7205b5d3fbea9f04822a76c74bdac078317dc203fae52";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. " +
  "(Opponents can assign it extra combat damage to kill it.)";

const [reactionKeyword, play] = program.abilities;
const [prevent] = play.body;
const targetSpec = prevent.targets[0];

test("ven-126-166 Ki Barrier: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-126-166 Ki Barrier: judgeReason distinguishes the merged budget from remaining wiring gaps", () => {
  // 438.1/438.1.b.1 Prevent Value, 438.3 decrement, 438.7 delayed replacement.
  assert.match(program.judgeReason, /438\.1/);
  assert.match(program.judgeReason, /438\.3/);
  assert.match(program.judgeReason, /replacement\.prevent/);
  assert.match(program.judgeReason, /ResolveContext\.replacement/);
  assert.match(program.judgeReason, /instructionContext/);
  assert.match(program.judgeReason, /zoneEntryId/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /438\.5\.a/);
  assert.match(program.judgeReason, /duration|期限/);
  assert.match(program.judgeReason, /不近似实现/);
  assert.match(program.judgeReason, /BlockedReplacementError/);
  assert.match(program.judgeReason, /resolveChainBody/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120|RIFT-91/);
});

test("ven-126-166 Ki Barrier: [Reaction] plus a prevent declaration over the chosen unit", () => {
  assert.equal(program.abilities.length, 2);
  // 813: the keyword is a pure permission and carries no value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["ki-barrier.prevent-7", "replacement.prevent"]
  ]);
  // 438.1.b.1: the Prevent Value is exactly the printed 7; the window is this turn.
  assert.deepEqual(prevent.args, {
    amount: { kind: "constant", value: 7 },
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: { target: "ki-barrier.unit" } }
  });
  // "Choose a unit": 355.7/355.9.a.1 one chosen Board unit; the parenthetical is
  // 438.5 reminder text and never a second ability.
  assert.deepEqual(targetSpec, {
    id: "ki-barrier.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(prevent.picks, undefined);
  assert.equal(prevent.linkedTo, undefined);
  assert.equal(prevent.condition, undefined);
});

test("ven-126-166 Ki Barrier: the printed [Reaction] keyword is a registered definition", () => {
  // Positive-only check: the [Reaction] declaration names a real registry entry; the
  // Full-card execution still needs the context and lifetime wiring below.
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
  assert.equal(keywordDefinitionsById.get("Reaction").stacking, "single");
});

/**
 * Primitive-only evidence with actual target plans, world actions and pipeline
 * registration. Supplying the required extension here does not prove that the
 * card's play body can receive it through instructionContext.
 */
function preventionWorld(target = "unit") {
  const kernel = world()
    .object("barrier", { cardId: CARD_ID, types: ["spell"], zone: "chain", might: null, energy: 2, power: ["Order"] })
    .unit("unit", { controller: "A", might: 10 })
    .unit("other", { controller: "A", might: 10 })
    .unit("enemy", { owner: "B", controller: "B", might: 10 })
    .build();
  const context = (source, controller) => bindResolveContext(kernel, { source, controller });
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: (checkpoint) => kernel.restore(checkpoint),
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    context,
    choose: (request) => kernel.choose(request)
  }), ["A", "B"], "A");
  const ctx = context(kernel.getObject("barrier"), "A");
  const plan = finalizeTargetPlan(ctx, targetSpec, { selected: [kernel.ref(target)] });
  const resolved = resolveTargetPlan(ctx, plan);
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.selected, [kernel.ref(target)]);
  kernel.setTargets(targetSpec.id, resolved.selected);
  const dependencies = {
    host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context },
    pipeline
  };
  const definition = instructionDefinitionsById.get(prevent.op);
  assert.ok(definition);
  const result = definition.execute(
    bindResolveContext(ctx, { replacement: dependencies }),
    definition.argsSchema.parse(prevent.args)
  );
  assert.equal(result.status, "executed");
  assert.equal(result.linkedValues.amount, 7);
  assert.equal(result.linkedValues.duration, "this-turn");
  assert.equal(typeof result.linkedValues.replacementId, "string");
  assert.deepEqual(result.events, []);
  // The delayed effect remains usable after the resolving spell goes to Trash.
  assert.equal(pipeline.commit({ type: "move-zone", object: kernel.ref("barrier"), to: "trash" }).status, "done");
  assert.equal(kernel.getObject("barrier").zone, "trash");
  const damage = (amount, victim = target, combat = false) => pipeline.commit({
    type: "damage", source: kernel.ref("enemy"), target: kernel.ref(victim), amount, combat
  });
  return { kernel, pipeline, damage };
}

test("ven-126-166 subeffect: the next 7 damage is consumed cumulatively, with combat overflow and target isolation", () => {
  const { kernel, pipeline, damage } = preventionWorld();
  assert.equal(damage(1, "other").status, "done");
  assert.equal(kernel.getObject("other").damage, 1);
  const first = damage(3);
  assert.equal(first.status, "prevented");
  assert.deepEqual(first.events, []);
  assert.equal(kernel.getObject("unit").damage, 0);
  assert.equal(damage(6, "unit", true).status, "replaced");
  assert.equal(kernel.getObject("unit").damage, 2);
  assert.equal(damage(1).status, "done");
  assert.equal(kernel.getObject("unit").damage, 3);
  const events = pipeline.events.filter((event) => event.timingPoint === "damage-dealt");
  assert.deepEqual(events.map((event) => [event.action.target.id, event.amount, event.action.combat]), [
    ["other", 1, false], ["unit", 2, true], ["unit", 1, false]
  ]);
});

test("ven-126-166 subeffect: an enemy unit is a legal choice and exact prevention exhausts the shield", () => {
  const { kernel, pipeline, damage } = preventionWorld("enemy");
  assert.equal(damage(2, "unit").status, "done");
  assert.equal(kernel.getObject("unit").damage, 2);
  assert.equal(damage(7).status, "prevented");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(damage(1).status, "done");
  assert.equal(kernel.getObject("enemy").damage, 1);
  assert.deepEqual(
    pipeline.events.filter((event) => event.timingPoint === "damage-dealt").map((event) => event.amount),
    [2, 1]
  );
});

test.todo(
  "ven-126-166 Ki Barrier: install the 438.7 delayed damage prevention on the chosen unit and track " +
    "the remaining Prevent Value (438.1.b.1/438.2/438.3) so the next 7 damage is prevented in whole or " +
    "in part through the original play body — ChainEngine.context must supply ResolveContext.replacement " +
    "and instructionContext must preserve its host + pipeline dependencies"
);

test.todo(
  "ven-126-166 Ki Barrier: expire prevention during Expiration Special Cleanup (317.2.c), " +
    "before the next turn-start — replacement.prevent only compares pipeline.clock.turn"
);

test.todo(
  "ven-126-166 Ki Barrier: a unit that leaves and re-enters must lose its old shield (124/124.1) — " +
    "replacement.prevent binds objectId without the selected zoneEntryId"
);

test.todo(
  "ven-126-166 Ki Barrier: combat lethal assignment must include the remaining Prevent Value (438.5.a) — " +
    "the numeric budget is private to the replacement closure and is not exposed to combat allocation"
);

test("ven-126-166 Ki Barrier evidence: the original play body cannot install the delayed replacement", () => {
  // Re-measured 2026-10-18: the card's own play body goes through the production
  // chain adapter and fails before any registration, because the frozen
  // ResolveContext has no replacement entry point.
  const kernel = world()
    .object("barrier", { cardId: CARD_ID, types: ["spell"], zone: "chain", might: null, energy: 2, power: ["Order"] })
    .unit("unit", { controller: "A", might: 10 })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("unit")]);
  assert.throws(
    () => resolveChainBody(play.body, kernel),
    (error) => error.constructor.name === "BlockedReplacementError" &&
      /requires ResolveContext\.replacement dependencies/.test(error.message)
  );
});

test("ven-126-166 Ki Barrier evidence: the shield survives into the end-of-turn window (317.2.c)", () => {
  // The primitive-only path is what the merged tree can execute today. This row
  // pins the measured lifetime boundary: after the next turn-start the shield is
  // gone, but damage taken inside the end-of-turn cleanup window is still
  // prevented, which is exactly what a 317.2.c Expiration-Step expiry must fix.
  const { kernel, pipeline, damage } = preventionWorld();
  pipeline.emit({ timingPoint: "turn-end" });
  assert.equal(damage(5).status, "prevented");
  assert.equal(kernel.getObject("unit").damage, 0);
  pipeline.emit({ timingPoint: "turn-start" });
  assert.equal(damage(5).status, "done");
  assert.equal(kernel.getObject("unit").damage, 5);
});
