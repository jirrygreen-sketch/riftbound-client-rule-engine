import assert from "node:assert/strict";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-witherclaw.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3a9686028c1c8883834ec636779521dcd144e90d07dbc34d923dc7533699ba4d";
const SOURCE_TEXT =
  "[Empower] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: " +
  "(:rb_energy_1::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might:.\n" +
  "[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted. (When I die while " +
  "Empowered, get the effect.)";

const [empower, mightBonus, deathknellTrigger] = program.abilities;
const [channelInstruction] = deathknellTrigger.body;

test("ven-078-166 Baccai Witherclaw: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-078-166 Baccai Witherclaw: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /rb_rune_rainbow/);
  assert.match(program.judgeReason, /727\.1\.b\.3/);
  assert.match(program.judgeReason, /431\.2/);
  assert.match(program.judgeReason, /KeywordAbility\.params\.cost/);
  assert.ok(!/RIFT-82|RIFT-87/.test(program.judgeReason));
});

test("ven-078-166 Baccai Witherclaw: [Empower] is declared, never faked as an activated ability", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 印刷费 1 Energy + 两个任意域 Power 的支付形状已合入（butcher-of-the-sands 同形），
  // 但 KeywordAbility 没有逐实例费用参数，不自行伪造关键词展开。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-078-166 Baccai Witherclaw: the +2 Might half keeps its Empowered gate", () => {
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  assert.equal(mightBonus.condition.kind, "compare");
  assert.deepEqual(mightBonus.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-078-166 Baccai Witherclaw: the nested dependent Deathknell trigger keeps its kill filter", () => {
  assert.equal(deathknellTrigger.kind, "triggered");
  // 808.1.c / 808.1.d / 429.1.a.1.b：自身被消灭并送入 Trash 的封闭时点。
  assert.equal(deathknellTrigger.trigger.at, "object-killed");
  assert.deepEqual(deathknellTrigger.trigger.filter, {
    self: true,
    cause: "kill",
    destination: "trash"
  });
  assert.deepEqual(deathknellTrigger.trigger.condition, mightBonus.condition);
  assert.equal(deathknellTrigger.optional, false);
  assert.equal(deathknellTrigger.trigger.once, undefined);
  // [Empowered] 不作为独立关键词声明，否则会错误表达为“本牌始终拥有 Deathknell”。
  assert.equal(program.abilities.filter(ability => ability.kind === "keyword").length, 1);
});

test("ven-078-166 Baccai Witherclaw: body is the single 'Channel 2 runes exhausted' instruction", () => {
  assert.equal(deathknellTrigger.body.length, 1);
  assert.equal(channelInstruction.id, "baccai-witherclaw.channel-2-exhausted");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 2 });
  // 431.2 的进入规定：以横置状态进入符文区。
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.args.player, undefined);
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.picks, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
});

test("ven-078-166 golden: the Channel 2 half moves two runes off the controller's Rune Deck (431.1)", () => {
  const kernel = world().player("A").rune(["rune-1", "rune-2", "rune-3"]).build();
  const run = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 2);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 2);
  assert.equal(kernel.getObject("rune-1").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-2").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-3").zone, "rune-deck");
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
});

test("ven-078-166 golden: a short Rune Deck channels as many as possible without failing (431.3)", () => {
  const kernel = world().player("A").rune(["only-rune"]).build();
  const run = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("ven-078-166 golden: an empty Rune Deck channels zero and still succeeds (431.3)", () => {
  const kernel = world().player("A").build();
  const run = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test.todo(
  "ven-078-166 Baccai Witherclaw: bind printed 1 Energy plus two any-domain Power through KeywordAbility.params.cost and expandProgram (827.1.c.1)"
);
test.todo(
  "ven-078-166 Baccai Witherclaw: preserve the tested empowered gate at death and bind cause/destination/toZone through the actual killed-event path (727.1.b.3 / 727.1.c.1)"
);
test.todo(
  "ven-078-166 Baccai Witherclaw: honor channel-rune.exhausted when entering the rune zone (431.2)"
);

// The card remains judge-required: this binds only its supported static clause.
// State changes use real actions; the original static ability is never rewritten.
test("baccai-witherclaw: the dependent static follows live Empower and Disempower actions", () => {
  const { kernel, engine } = fixture({ cards: [{
    id: "host", cardId: program.canonicalCardId, types: ["unit"],
    might: 4, energy: null, power: null
  }] });
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("host"), to: "battlefield",
    location: { type: "battlefield", id: "bf-gate" }
  }).status, "done");
  const binding = createEngineStaticBinder(engine).bindStatic(mightBonus, kernel.getObject("host"));
  let snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.might, 4);
  assert.equal(snapshot.energy, null);
  assert.equal(snapshot.power, null);

  assert.equal(engine.commit({ type: "empower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 1);
  assert.equal(snapshot.might, 6);

  assert.equal(engine.commit({ type: "disempower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 0);
  assert.equal(snapshot.might, 4);
  assert.deepEqual(engine.pipeline.events.filter(event => event.timingPoint === "empowered-changed")
    .map(event => event.action.type), ["empower", "disempower"]);
  binding.unbind();
});

test("baccai-witherclaw: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});
