import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/fretful-feline.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-864252b4f9e2a925ac4decd2d9c2a4df3025182c727f74f452c8d8f70143d8c9";
const SOURCE_TEXT = "When I become ready, give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;

test("ven-071-166 Fretful Feline: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-071-166 Fretful Feline: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /settlement-1/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("ven-071-166 Fretful Feline: 'When I become ready' subscribes object-readied on self (416.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-readied");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-readied",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-071-166 Fretful Feline: the body is the temporally-bounded Might modification shape", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "fretful-feline.plus-2-might-this-turn");
  // 143.2.a 的算术层修正；effect.buff 不是临时 Might（702 的计数器语义不同）。
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 指能力宿主（053.1），用契约 3.6 的符号选择器，不写运行时 ObjectRef。
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.op === "effect.buff", false);
});

test("ven-071-166 Fretful Feline golden: the triggered body grants +2 Might to self until turn end", () => {
  const base = world()
    .unit("fretful-feline", { zone: "board", controller: "A", owner: "A", might: 5 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("fretful-feline") });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["fretful-feline.plus-2-might-this-turn", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(layers.evaluate(kernel.ref("fretful-feline")).might, 7);
});


// Register the supported trigger/body directly in the real pipeline. The full
// CardProgram remains blocked by the repeated-settlement regression below.
function readyScenario() {
  const f = fixture({ cards: [
    { id: "feline", cardId: CANONICAL_ID, types: ["unit"], might: 5, energy: 6, power: null, exhausted: true },
    { id: "other", types: ["unit"], might: 2, exhausted: true }
  ] });
  for (const id of ["feline", "other"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield" });
  }
  const source = f.kernel.getObject("feline");
  f.engine.pipeline.registerTrigger({
    id: "fretful-feline.ready",
    source,
    controller: source.controller,
    spec: {
      ...ability.trigger,
      filter: translateTriggerFilter(ability.trigger.filter, source.ref.id, ability.trigger.at)
    },
    body: ability.body,
    optional: ability.optional,
    activeZones: ["board"],
    boundToIncarnation: true
  });
  return f;
}

test("ven-071-166 Fretful Feline golden: a real ready event triggers only self and expires at turn end", () => {
  const f = readyScenario();
  f.engine.commit({ type: "ready", object: f.kernel.ref("other") });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 5);

  f.engine.commit({ type: "ready", object: f.kernel.ref("feline") });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("feline").exhausted, false);
  assert.equal(f.kernel.getObject("feline").power, null);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 7);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("other")).might, 2);

  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 5);
});

test("ven-071-166 Fretful Feline regression: two ready triggers in one turn must stack to +4 Might", {
  todo: "Shared interpreter/chain settlement identity collides across resolutions; engine-core fix required"
}, () => {
  const f = readyScenario();
  f.engine.commit({ type: "ready", object: f.kernel.ref("feline") });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 7);
  f.engine.commit({ type: "exhaust", object: f.kernel.ref("feline") });
  f.engine.commit({ type: "ready", object: f.kernel.ref("feline") });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 9);
});


test("ven-071-166 Fretful Feline regression: readying an already ready unit must emit no new ready event", {
  todo: "events/action-adapter must suppress unchanged orientation events (416.1.c)"
}, () => {
  const f = readyScenario();
  f.engine.commit({ type: "ready", object: f.kernel.ref("feline") });
  f.engine.advance();
  resolveAll(f.engine);
  const readyEvents = () => f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length;
  const before = readyEvents();
  f.engine.commit({ type: "ready", object: f.kernel.ref("feline") });
  assert.equal(readyEvents(), before);
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("feline")).might, 7);
});
