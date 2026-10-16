import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/nasus-guardian-of-knowledge.js";
import {
  matchesTriggerEvent,
  matchesTriggerObject
} from "../../../../engine-core/dist/events/pipeline-match.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [channelInstruction] = ability.body;

test("nasus-guardian-of-knowledge: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-356162b4f965ef0d8365391eaacb8f6ce7a5990f15529e553d4fd98f3e20bb89"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Once each turn, when an enemy unit here dies, channel 1 rune exhausted."
  );
});

test("nasus-guardian-of-knowledge: judgeReason names the unresolved 'here' filter and task ids", () => {
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /matchesTriggerEvent|matchesTriggerObject/);
  assert.match(program.judgeReason, /808\.1\.d\.3/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /effect\.channel/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("nasus-guardian-of-knowledge: 'once each turn' death trigger on an enemy unit here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.3.e.1 + 契约 3.5 的 TriggerSpec.once：每回合只执行一次。
  assert.equal(ability.trigger.once, "per-turn");
  // 808.1.d：死亡触发用 object-killed（429.1/429.2/808.1.d）。
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    filter: {
      type: "unit",
      controller: "opponent",
      zone: "board",
      sameLocationAs: "self"
    }
  });
  assert.equal(ability.trigger.condition, undefined);
});

test("nasus-guardian-of-knowledge: the enemy-unit filter matches only opposing units on the board", () => {
  const kernel = world()
    .base("nasus", { might: 6 })
    .unit("enemy-unit", { might: 3, controller: "B" })
    .unit("friendly-unit", { might: 3, controller: "A" })
    .hand("enemy-in-hand", { types: ["unit"], controller: "B" })
    .build();
  const filter = { type: "unit", controller: "opponent", zone: "board" };
  // 事件匹配器把 controller: "opponent" 解读为"与能力控制者不同"（170.x 的对手），
  // 这与 filter 一起构成 "an enemy unit ... on the board"。
  assert.equal(matchesTriggerObject(filter, kernel.getObject("enemy-unit"), "A"), true);
  assert.equal(matchesTriggerObject(filter, kernel.getObject("friendly-unit"), "A"), false);
  assert.equal(matchesTriggerObject(filter, kernel.getObject("enemy-in-hand"), "A"), false);
});

test("nasus-guardian-of-knowledge: the object-killed filter is accepted by the production EventPattern", () => {
  // 时点与事件类型都在封闭枚举内（808.1.d / 429.1），事件模式本身合法；
  // 缺口只在于 filter 的 sameLocationAs 锚点不被事件匹配器识别（见 judgeReason）。
  const pattern = ability.trigger.filter.filter;
  const killed = {
    kind: "object-killed",
    timingPoint: "object-killed",
    object: {
      ref: { id: "enemy-unit", zoneEntryId: 1 },
      cardId: "card:enemy-unit",
      name: "enemy-unit",
      types: ["unit"],
      tags: [],
      keywords: [],
      owner: "B",
      controller: "B",
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 3,
      energy: null,
      power: null,
      exhausted: false,
      damage: 3,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    }
  };
  assert.equal(matchesTriggerEvent({ ...pattern, sameLocationAs: undefined }, killed, "A"), true);
  // unresolved gap: the 'here' anchor is not applied by the merged matcher, so a death at a
  // DIFFERENT location also matches — that is exactly why the card is judge-required.
  const elsewhere = {
    ...killed,
    object: { ...killed.object, location: { type: "battlefield", id: "battlefield-2" } }
  };
  assert.equal(matchesTriggerEvent({ ...pattern, sameLocationAs: undefined }, elsewhere, "A"), true);
});

test("nasus-guardian-of-knowledge: body channels exactly 1 rune, exhausted", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(channelInstruction.id, "nasus-guardian-of-knowledge.channel");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
});

test("nasus-guardian-of-knowledge: the channel body really moves one rune and marks it exhausted", () => {
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const run = runInstruction(channel, {
    ...channelInstruction.args,
    // 原语 argsSchema 接受 boolean 或 Expr；解释器会先求值，这里给出等价字面量。
    exhausted: channelInstruction.args.exhausted.value
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.objectsInZone("A", "rune-zone").map(ref => ref.id).join(","), "top-rune");
});

test("nasus-guardian-of-knowledge: an exhausted rune is what 431.2 stipulates; the pool still counts it", () => {
  const kernel = world().rune(["only-rune"]).build();
  const run = runInstruction(channel, { amount: { kind: "constant", value: 1 }, exhausted: true }, {
    world: kernel
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test.todo(
  "nasus-guardian-of-knowledge: make the 'here' condition real once the trigger matcher applies " +
    "sameLocationAs (contract 3.6 anchor) against the event object's location and the source's " +
    "last-known location (808.1.d.3); the merged matchesTriggerEvent ignores it, so a death at a " +
    "different battlefield currently matches"
);
test.todo(
  "nasus-guardian-of-knowledge: subscribe once: 'per-turn' through the trigger pipeline and " +
    "assert the 383.3.e.1 single execution per turn (CardProgram -> trigger/chain adapter, " +
    "RIFT-120 follow-up)"
);
