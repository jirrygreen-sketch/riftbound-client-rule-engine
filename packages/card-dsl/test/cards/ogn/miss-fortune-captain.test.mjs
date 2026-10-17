import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/miss-fortune-captain.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL = "card.hash-541ef049150d65551ee54e4c6763bc4a7009a9e321032a8470f0ec2a2030a8f7";

/** A real chain engine so the production static binder and movement query run. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20, power: ["Body"] })
    .player("B", { energy: 20 })
    .unit("miss-fortune", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

const [accelerate, ganking, moveTrigger] = program.abilities;
const optionalInstruction = moveTrigger.body[0];
const readyInstruction = optionalInstruction.args.body.value[0];

function missFortuneWorld() {
  const kernel = world()
    .unit("miss-fortune", { exhausted: false, location: { type: "battlefield", id: "bf-1" } })
    .unit("exhausted-ally", { exhausted: true, location: { type: "base", player: "A" } })
    .unit("enemy-unit", { owner: "B", exhausted: true, location: { type: "base", player: "B" } })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("miss-fortune") });
}

test("ogn-162-298 Miss Fortune, Captain: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "The first time I move each turn, you may ready something else that's exhausted."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ogn-162-298 Miss Fortune, Captain: judgeReason cites the move timing and the pick pipeline", () => {
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  // Restored pre-resweep assertions: both phrasings are still in the reason.
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /Standard Move/);
  assert.match(program.judgeReason, /PickSpec/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /standard-move-executor-v2/);
  assert.match(program.judgeReason, /finalizePick/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /普通 PickSpec|PickSpec/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /permission\.routes/);
});

test("ogn-162-298 Miss Fortune, Captain: the object-moved trigger is still rejected by the closed event list", () => {
  // 383.1/449.1: the timing point exists, but the card's EventPattern is not in
  // the closed EVENT_PATTERN_TYPES vocabulary, so registration fails outright.
  const translated = translateTriggerFilter(moveTrigger.trigger.filter, "miss-fortune", moveTrigger.trigger.at);
  assert.deepEqual(translated, { event: "object-moved", object: { objectId: "miss-fortune" } });
  assert.throws(
    () => assertTriggerSpec({ at: moveTrigger.trigger.at, filter: translated, once: moveTrigger.trigger.once }),
    error => error.name === "TriggerSpecValidationError" && /trigger\.filter\.event/.test(String(error.message))
  );
});

test("ogn-162-298 Miss Fortune, Captain: the expanded Accelerate cost is unmappable and Ganking stays inert", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("miss-fortune");
  const expanded = createProgramBinding({ cardPrograms: [program] }).inspect(source).abilities;
  const accelerateCost = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "accelerate.cost");
  const gankingPermission = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "continuous.movement");
  assert.ok(accelerateCost && gankingPermission, "both keyword expansions must exist");

  const binder = createEngineStaticBinder(engine);
  const error = (() => {
    try {
      binder.bindStatic(accelerateCost, source);
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error, "the merged layer binder must still refuse accelerate.cost");
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /accelerate\.cost has no layer mapping/);

  const handle = binder.bindStatic(gankingPermission, source);
  const entry = engine.layers.registry.list().find(candidate => candidate.effect.effect.kind === "continuous.movement");
  assert.equal(entry.effect.effect.permission, "battlefield-to-battlefield");
  // The scalar KeywordDef payload never becomes permission.routes, so the
  // merged movement() query cannot grant the battlefield-to-battlefield move.
  assert.equal(movement(engine.layers.registry, source.ref, source, "A").canGank, false);
  handle.unbind();
});

test("ogn-162-298 Miss Fortune, Captain: Accelerate and Ganking stay keyword declarations (805/810)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("ogn-162-298 Miss Fortune, Captain: 'the first time I move each turn' is a per-turn move trigger (383.1/383.1.b)", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.once, "per-turn");
  assert.equal(moveTrigger.optional, true);
  assert.equal(moveTrigger.body.length, 1);
});

test("ogn-162-298 Miss Fortune, Captain: 'you may ready something else' is choice.optional wrapping the ready (contract 3.9)", () => {
  assert.equal(optionalInstruction.id, "miss-fortune.may-ready-other");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.equal(optionalInstruction.args.body.value.length, 1);
  assert.equal(optionalInstruction.linkedTo, undefined);
  assert.deepEqual(optionalInstruction.args.prompt, {
    kind: "constant",
    value: "Ready something else that's exhausted?"
  });

  assert.equal(readyInstruction.id, "miss-fortune.ready-other");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "pick", id: "miss-fortune.exhausted-other" } }
  });
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-162-298 Miss Fortune, Captain: 'something else that's exhausted' is a non-target pick (355.10.d)", () => {
  assert.equal(readyInstruction.picks.length, 1);
  const [pick] = readyInstruction.picks;
  assert.equal(pick.id, "miss-fortune.exhausted-other");
  assert.deepEqual(pick.options, ["exhausted-object-other-than-source"]);
  assert.deepEqual(pick.filter, { exclude: "source", states: "exhausted" });
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
  // picks are not targets: nothing here may trigger became-target effects.
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-162-298 Miss Fortune, Captain: accepting the optional readies another object through the kernel", () => {
  const kernel = missFortuneWorld();
  kernel.setAnswers({ "miss-fortune.may-ready-other/optional": true });
  kernel.setPicks("miss-fortune.exhausted-other", [kernel.ref("exhausted-ally")]);

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("exhausted-ally").exhausted, false);
  assert.equal(kernel.getObject("miss-fortune").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.readied.objects, [
    { id: "exhausted-ally", zoneEntryId: 1 }
  ]);
});

test("ogn-162-298 Miss Fortune, Captain: declining the optional readies nothing (403.1)", () => {
  const kernel = missFortuneWorld();
  kernel.setAnswers({ "miss-fortune.may-ready-other/optional": false });

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["miss-fortune.may-ready-other", "negated"]
  ]);
  assert.equal(kernel.getObject("exhausted-ally").exhausted, true);
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "ogn-162-298 Miss Fortune, Captain: 'The first time I move each turn' needs the duel Standard Move " +
    "(CR v1.5 421.1/449.1) to publish its results into the single event pipeline (zones/movement and " +
    "duel/standard-move-executor-v2 only hands requiresMoveTriggers to the outer caller)."
);
test.todo(
  "ogn-162-298 Miss Fortune, Captain: the ordinary non-target PickSpec (355.10.d/355.10.d.1) needs " +
    "a production Finalize selection pipeline; ordered zoneSlice picks are supported, but finalizePick " +
    "has no production caller and effect.ready reads picks that nothing populates for this card yet."
);
