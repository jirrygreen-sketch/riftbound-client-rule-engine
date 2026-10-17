import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/field-musicians.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-08498917b444057f23afae275c8776d4bff33d47135466ce826cff2b935cea29";
const SOURCE_TEXT = "When you play me, give a unit +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;
const targetSpec = grantMight.targets[0];

test("ven-026-166 Field Musicians: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-026-166 Field Musicians: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.judgeReason, undefined);
});

test("ven-026-166 Field Musicians: one mandatory card-played play effect scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.a / 383.4.a.1 / 420.4.a: "When you play me".
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("ven-026-166 Field Musicians: the body is one temporary +3 Might grant on a chosen unit", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "field-musicians.give-plus-3-might"
  ]);
  // 143.2.a / 475-477: this is an arithmetic-layer Might change, never a Buff
  // counter (effect.buff's own header assigns temporary Might to layers/).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "field-musicians.unit" }
  });
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
  // 355.5 / 355.7 / 355.9.a.1: "a unit" is a Choice, so a TargetSpec.
  assert.deepEqual(targetSpec, {
    id: "field-musicians.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
});

test("ven-026-166 Field Musicians golden: the body registers +3 Might for the locked unit until turn end", () => {
  const base = world()
    .unit("field-musicians", { zone: "board", controller: "A", owner: "A", might: 3 })
    .unit("target", { zone: "board", controller: "A", owner: "A", might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("field-musicians") });
  kernel.setTargets(targetSpec.id, [kernel.ref("target")]);

  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["field-musicians.give-plus-3-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 3);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(layers.evaluate(kernel.ref("target")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("field-musicians")).might, 3);
});


test("ven-026-166 Field Musicians golden: playing the unit triggers a locked enemy target and expires at turn end", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [
      { id: "musicians", cardId: CANONICAL_ID, types: ["unit"], might: 3, energy: 4, power: null },
      { id: "target", owner: "B", controller: "B", types: ["unit"], might: 2 }
    ],
    describePlay: binding.describePlay,
    choose: request => request.type === "select-objects"
      ? request.options.filter(ref => ref.id === "target") : undefined
  });
  binding.attachLifecycle(f.engine);
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("target"), to: "battlefield" });
  f.engine.commit({ type: "play", object: f.kernel.ref("musicians"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("musicians").zone, "board");
  assert.equal(f.kernel.getObject("musicians").power, null);
  assert.equal(f.kernel.player("A").energy, 16);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-played").length, 1);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("target")).might, 5);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("musicians")).might, 3);
  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("target")).might, 2);
});

test("ven-026-166 Field Musicians golden: a target that leaves before resolution is ignored", () => {
  const base = world()
    .unit("musicians", { might: 3 })
    .unit("target", { might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("musicians") });
  const locked = kernel.ref("target");
  kernel.setTargets(targetSpec.id, [locked]);
  assert.equal(kernel.perform({ type: "kill", object: locked }).status, "done");
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("target").zone, "trash");
});
