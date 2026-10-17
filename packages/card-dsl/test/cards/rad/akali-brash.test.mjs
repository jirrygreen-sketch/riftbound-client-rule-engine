import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/akali-brash.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const FIRST_MOVE = "akali-brash.add-first-move";
const SECOND_MOVE_BANISH = "akali-brash.banish-top";
const SECOND_MOVE_PERMISSION = "akali-brash.grant-play";

test("rad-015-167 Akali, Brash: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("self-moves-this-turn/history-record"));
  assert.ok(program.judgeReason.includes("move-location"));
  assert.equal(
    program.canonicalCardId,
    "card.hash-299400fea6fee0793728ed914b84549455937a2ee92f40540aa04c765818548e"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\n" +
      "The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)"
  );
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /condition\.history/);
  assert.match(program.judgeReason, /effect\.play-permission/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|261)/);
});

test("rad-015-167: first-move resource trigger and second-move banish trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [firstMove, secondMove] = program.abilities;

  assert.equal(firstMove.kind, "triggered");
  assert.equal(firstMove.trigger.at, "object-moved");
  assert.deepEqual(firstMove.trigger.filter, { self: true });
  // “The first time … each turn” = once per-turn（与 sfd-113-221 同一写法）。
  assert.equal(firstMove.trigger.once, "per-turn");
  assert.equal(firstMove.optional, false);
  assert.equal(firstMove.body.length, 1);
  const [gain] = firstMove.body;
  assert.equal(gain.id, FIRST_MOVE);
  assert.equal(gain.op, "effect.resources");
  assert.deepEqual(gain.args.energy, { kind: "constant", value: 1 });
  // [A] = Power of any Domain（135.2.e.5 / 163.2.b）：保留印刷写法供审查；
  // effect.resources 的六域封闭枚举不支持 [A]，不近似成任一域。
  assert.deepEqual(gain.args.power, { kind: "constant", value: ["rainbow"] });

  assert.equal(secondMove.kind, "triggered");
  assert.equal(secondMove.trigger.at, "object-moved");
  assert.deepEqual(secondMove.trigger.filter, { self: true });
  assert.equal(secondMove.trigger.once, undefined);
  assert.equal(secondMove.trigger.condition.kind, "compare");
  assert.deepEqual(secondMove.trigger.condition.left, {
    kind: "count",
    subject: "self-moves-this-turn",
    filter: { zone: "history-record" }
  });
  assert.equal(secondMove.trigger.condition.operator, "eq");
  assert.deepEqual(secondMove.trigger.condition.right, { kind: "constant", value: 2 });
  assert.deepEqual(secondMove.body.map(instruction => instruction.id), [
    SECOND_MOVE_BANISH,
    SECOND_MOVE_PERMISSION
  ]);
  assert.equal(secondMove.body[0].op, "effect.banish");
  assert.deepEqual(secondMove.body[0].args.objects, {
    kind: "constant",
    value: { zone: "deck", from: "top" }
  });
  assert.equal(secondMove.body[1].op, "effect.play-permission");
  assert.equal(secondMove.body[1].linkedTo, SECOND_MOVE_BANISH);
});

test("rad-015-167: [Add] gains 1 Energy through the real effect.resources primitive", () => {
  const kernel = world().player("A", { energy: 0 }).build();
  const [gain] = program.abilities[0].body;
  // 只执行六域可表达的能量部分；[A] 的 Universal Power 表示缺口记在 judgeReason 与
  // 下面的 TODO 里，不锁定合并原语对 [A] 的否定结果（依赖落地后断言会失效）。
  const energyOnly = resolveChainBody([{ ...gain, args: { energy: gain.args.energy } }], kernel);
  assert.equal(energyOnly.status, "executed");
  assert.equal(energyOnly.results[0].result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(energyOnly.linkedValues[`${FIRST_MOVE}.resources`].energy, 1);
  assert.deepEqual(energyOnly.linkedValues[`${FIRST_MOVE}.resources`].power, []);
});

test("rad-015-167: the second-move body banishes the deck top through real effect.banish", () => {
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const banish = program.abilities[1].body[0];
  const outcome = resolveChainBody([banish], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("top").zone, "banishment");
  assert.equal(kernel.getObject("second").zone, "deck");
  assert.equal(outcome.linkedValues[`${SECOND_MOVE_BANISH}.akaliBanishCount`], 1);
});

test.todo(
  "rad-015-167 Akali, Brash: Universal Power（[A]，135.2.e.5 / 163.2.b）无可执行表达——" +
    "契约 3.6 的 Domain 是六域封闭枚举，effect.resources 明确不可用任一域近似"
);
test.todo(
  "rad-015-167 Akali, Brash: the object-moved timing point must join EVENT_PATTERN_TYPES " +
    "(events/trigger-spec.ts) before registerProgramTriggers can subscribe the two move triggers"
);
test.todo(
  "rad-015-167 Akali, Brash: “The second time I move each turn” 的序数条件需要按对象范围的历史序数谓词" +
    "（condition.history 目前只给动作计数，即便它已消费契约 3.8 的 exclude/objectFilter）"
);
test.todo(
  "rad-015-167 Akali, Brash: “Until your next Ending Phase, you may play that card.” 的期限化" +
    "打出许可原语 effect.play-permission 缺失（未注册）"
);
