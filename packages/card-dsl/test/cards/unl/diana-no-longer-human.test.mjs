import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/diana-no-longer-human.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL_ID =
  "card.hash-11be609f8d3a73cf3ab397a574e5dc2de111d0ec840bd515e8f6df0e19e3774b";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play a spell, give me +2 :rb_might: this turn.";

const [ambush, spellTrigger] = program.abilities;
const [grantMight] = spellTrigger.body;

/**
 * Production installs the card-program binding on a real ChainEngine
 * (RIFT-257: createProgramBinding + registerProgramTriggers). The golden
 * builds the same pair on the reference kernel so the card-played trigger
 * subscribes to real emissions and its body resolves through the real
 * interpreter. The chain play flow emits "card-played" with the played spell
 * as the event object and the playing player (chain/engine.ts:440).
 */
function dianaFixture() {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .unit("diana", { owner: "A", controller: "A", cardId: CANONICAL_ID, might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("played-spell", { owner: "A", types: ["spell"], zone: "chain" })
    .unit("enemy-spell", { owner: "B", types: ["spell"], zone: "chain" })
    .build();
  const decide = () => { throw new AwaitChoice({ id: "x", type: "optional" }); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  // ProgramRegistry.get refuses judge-required programs before binding; the
  // local executable clone isolates the halves this card already executes
  // (the merged continuous.might body and the card-played trigger binding),
  // while the shipped program keeps its judgeReason for the [Ambush] half.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const triggerIds = binding.registerProgramTriggers(engine, kernel.getObject("diana"));
  return { kernel, engine, binding, triggerIds };
}

function resolveAll(fixture, { limit = 12 } = {}) {
  fixture.engine.advance();
  let guard = 0;
  while (fixture.engine.items.length && guard++ < limit) fixture.engine.pass(fixture.engine.priority);
}

test("unl-149-219 Diana, No Longer Human: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-149-219 Diana, No Longer Human: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822/);
  // The current, verified gap is that both Ambush static declarations are
  // rejected by the production static binder.
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /card-played/);
});

test("unl-149-219 Diana, No Longer Human: [Ambush] is declared as a keyword only (CR 822)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
  // 822.1.b 的展开（合法打出位置 + Reaction 许可）属关键词管线；卡内不重写。
  assert.equal(keywordDefinitionsById.has("Ambush"), true);
});

test("unl-149-219 Diana, No Longer Human: 'when you play a spell' is a card-played trigger on a spell", () => {
  // 420.4.a：打出动作完成时触发；383.4.a.4：这不是 Play Effect。
  assert.equal(spellTrigger.kind, "triggered");
  assert.equal(spellTrigger.trigger.at, "card-played");
  assert.deepEqual(spellTrigger.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  assert.equal(spellTrigger.trigger.condition, undefined);
  assert.equal(spellTrigger.trigger.once, undefined);
  // 原文没有 “may”：触发是强制的（383.3.a 只适用于 “you may”）。
  assert.equal(spellTrigger.optional, false);
});

test("unl-149-219 Diana, No Longer Human: 'give me +2 Might this turn' targets the host, not a choice", () => {
  assert.equal(spellTrigger.body.length, 1);
  assert.equal(grantMight.id, "diana-no-longer-human.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.10.g：“me” 指能力宿主，用 continuous.might 的 appliesTo 选择器；不是 targets/picks 选择。
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-149-219 Diana, No Longer Human golden: the merged Might body registers a temporary arithmetic effect", () => {
  const kernel = world()
    .unit("diana", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const context = kernel.clone({ source: kernel.ref("diana"), sourceSnapshot: kernel.getObject("diana") });
  const outcome = resolveChainBody([grantMight], context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });
});

test("unl-149-219 Diana, No Longer Human: both merged Ambush static declarations are rejected by the production binder", () => {
  // 822.1.b: Ambush expands to a play-location permission plus a conditional
  // Reaction timing. Neither can be bound today: layerFor has no mapping for
  // play-location-permission, and the timing declaration uses the unsupported
  // appliesTo: ["card"] anchor. Fail closed — the card must not be executable.
  const definition = keywordDefinitionsById.get("Ambush");
  assert.ok(definition, "effects/keywords/Ambush.ts must be registered");
  const expanded = definition.expand({ value: ambush.value, host: { canonicalCardId: CANONICAL_ID } });
  const statics = expanded.filter((ability) => ability.kind === "static");
  assert.deepEqual(statics.map((ability) => ability.effect.kind), [
    "play-location-permission",
    "continuous.timing"
  ]);

  const kernel = world().unit("diana", { owner: "A", controller: "A", might: 3 }).build();
  const source = kernel.getObject("diana");
  const engine = {
    layers: { addContinuous() {}, removeContinuous() {} },
    pipeline: { host: { objects: () => [source], context() { throw new Error("no engine context"); } } }
  };
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(statics[0], source),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
  assert.throws(
    () => binder.bindStatic(statics[1], source),
    (error) => error.name === "ProgramBindingError" && /Unsupported static appliesTo/.test(error.message)
  );
});

test("unl-149-219 Diana, No Longer Human golden: a real card-played event for an allied spell grants +2 Might until end of turn", () => {
  const fixture = dianaFixture();
  assert.equal(fixture.triggerIds.length, 1);
  fixture.engine.emit({
    timingPoint: "card-played",
    object: fixture.kernel.getObject("played-spell"),
    player: "A"
  });
  resolveAll(fixture);

  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("diana")).might, 5);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("enemy")).might, 3);
  // 143.2.a / 479.4: the bonus is an arithmetic-layer modification, not a
  // 702 Buff counter, and the base snapshot stays untouched.
  assert.equal(fixture.kernel.getObject("diana").might, 3);
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("diana")).buffs, 0);
  assert.ok(fixture.engine.pipeline.events.some(event => event.timingPoint === "chain-item-resolve"));

  // "this turn": expires at end of turn (CR 317.1.a / 468.7.c).
  fixture.engine.layers.expireAt("turn-end");
  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("diana")).might, 3);
});

test("unl-149-219 Diana, No Longer Human golden: an opponent's played spell does not trigger 'you play a spell'", () => {
  const fixture = dianaFixture();
  // controller: "self" compares the event object's controller with the ability
  // controller (events/pipeline-match.ts playerMatches); an opponent's spell
  // must not fire the trigger.
  fixture.engine.emit({
    timingPoint: "card-played",
    object: fixture.kernel.getObject("enemy-spell"),
    player: "B"
  });
  resolveAll(fixture);

  assert.equal(fixture.engine.layers.evaluate(fixture.kernel.ref("diana")).might, 3);
});
