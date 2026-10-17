import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/ember-monk.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /fromHidden/);
  assert.match(program.judgeReason, /settlement/);
  assert.match(program.judgeReason, /指令路径前缀/);
  assert.match(program.judgeReason, /重复注册/);
  assert.equal(
    program.sourceText,
    "When you play a card from [Hidden], give me +2 :rb_might: this turn."
  );
});

test("trigger records the intended 'played from Hidden' card-played filter", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    player: "controller",
    filter: { fromHidden: true }
  });
  assert.equal(ability.optional, false);
});

test("body records the +2 Might-this-turn self grant and does not fake it as a Buff counter", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "ember-monk.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(instruction.targets, undefined);
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { kind: "source" } });
  // No effect.buff instruction: a Buff counter would be a different effect (703).
  assert.notEqual(instruction.op, "effect.buff");
});

test("golden: the +2 Might grant registers and expires at turn-end", () => {
  const base = world().unit("monk", { might: 4 }).build();
  const kernel = base.clone({ source: base.ref("monk"), sourceSnapshot: base.getObject("monk") });
  const outcome = runAbilityBody(
    ability.body,
    kernel,
    undefined,
    { host: kernel.ref("monk") }
  );

  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine([kernel.getObject("monk")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("monk")).might, 6);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("monk")).might, 4);
});

test("Ember Monk supported Might primitive stacks separate settlements until turn-end", () => {
  const base = world().unit("monk", { cardId: CANONICAL, might: 4 }).unit("other", { might: 2 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("monk") });
  let layers;
  for (let index = 1; index <= 2; index++) {
    const run = runInstruction(might, instruction.args, { world: kernel });
    assert.equal(run.result.status, "executed");
    layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
    assert.equal(layers.snapshot(kernel.ref("monk")).might, 4 + 2 * index);
    assert.equal(layers.snapshot(kernel.ref("other")).might, 2);
    assert.equal(kernel.getObject("monk").buffs, 0);
  }
  assert.notEqual(kernel.continuousEffects[0].effect.id, kernel.continuousEffects[1].effect.id);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.snapshot(kernel.ref("monk")).might, 4);
});

test.todo("Ember Monk: retain Hidden origin on card-played and translate the fromHidden trigger filter (CR 811/412.4)");

test("Ember Monk: preserve continuous.might settlement identity between Chain resolutions so repeated triggers stack without duplicate effect IDs", {
  todo: "Chain settlement counter reads an unqualified key after writing an instruction-path-qualified key"
}, () => {
  const f = fixture({ cards: [{ id: "monk", cardId: CANONICAL, types: ["unit"], might: 4 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("monk"), to: "base", location: { type: "base", player: "A" } });
  f.engine.advance();

  // Test the unmodified body through Chain, independently of the still-missing
  // Hidden-origin event/filter binding. The primitive-only test above is not
  // evidence that separate Chain resolutions allocate distinct effect IDs.
  for (let index = 1; index <= 2; index++) {
    f.engine.enqueue(f.draft(`monk-trigger-${index}`, {
      kind: "triggered", source: f.kernel.getObject("monk"), body: ability.body
    }));
    f.engine.advance();
    resolveAll(f.engine);
    assert.equal(f.engine.layers.snapshot(f.kernel.ref("monk")).might, 4 + 2 * index);
    assert.equal(f.engine.layers.snapshot(f.kernel.ref("source")).might, 2);
    assert.equal(f.kernel.getObject("monk").buffs, 0);
  }
  f.engine.emit({ timingPoint: "turn-end" });
  f.engine.advance();
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("monk")).might, 4);
});
