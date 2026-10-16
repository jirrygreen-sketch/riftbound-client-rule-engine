import assert from "node:assert/strict";
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
});

test("ven-078-166 Baccai Witherclaw: [Empower] is declared, never faked as an activated ability", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 印刷费 1 Energy + 两个任意域 Power 无承载字段（六域封闭集合无法表达 [A]）。
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
    property: "empoweredCount"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-078-166 Baccai Witherclaw: the nested dependent Deathknell trigger keeps its kill filter", () => {
  assert.equal(deathknellTrigger.kind, "triggered");
  // 808.1.c / 808.1.d / 429.1.a.1.b：自身被消灭并送入 Trash 的封闭时点。
  assert.equal(deathknellTrigger.trigger.at, "object-killed");
  assert.deepEqual(deathknellTrigger.trigger.filter, {
    self: true,
    // 727.1.b.3：只有 Empowered 成立时该 Deathknell 才 Active（描述性门槛）。
    empowered: true,
    cause: "kill",
    destination: "trash"
  });
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
  "ven-078-166 Baccai Witherclaw: [Empower] expansion (827.1.c.1: 1 Energy plus two :rb_rune_rainbow: [A] Power, 'use only " +
    "if not Empowered') needs an Empower KeywordDef and a Domain representation for Universal Power (135.2.e.5.a / 163.2.b)"
);
test.todo(
  "ven-078-166 Baccai Witherclaw: the 727.1.b.3 nested gate ('active Deathknell exactly while Empowered') needs an " +
    "Empowered status predicate (442.1.a / 727.1.c.1; RIFT-87) and a card-side continuous.might registration (RIFT-91)"
);
test.todo(
  "ven-078-166 Baccai Witherclaw: the channelled runes must enter exhausted (431.2) — the merged channel-rune action " +
    "carries the stipulation but the reference kernel enters runes readied"
);

