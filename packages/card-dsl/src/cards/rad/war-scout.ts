import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * War Scout (rad-008-167) — Unit, Fury, 3 energy / 2 Might.
 *
 * 原文（deck-catalog rad-008-167，逐字）：
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have
 *    me enter ready.)\nWhen you play me, give a unit +2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）按契约 3.1 声明为 keyword 能力；其展开（805.1.b 可选附加费
 *   [1][Fury] + 805.6 入场替代）由 effects/keywords/Accelerate.ts 负责，卡牌不重复展开；
 * - "When you play me" 是 Play Effect（383.4.a）→ 时点 card-played、filter 自身；
 * - "give a unit +2 :rb_might: this turn" 是带“本回合”期限的临时 Might 修正，属于
 *   layers 的 continuous.might（effect.buff 文件明确 Buff counter 不是临时 Might 修改）。
 *
 * status: judge-required（不近似实现）：
 * - Accelerate 展开依赖尚未合入的 cost.additional / cost.pay 与 replacement.enter 管线
 *   （Accelerate.ts 文件头 dependency 注明，RIFT-89~91）；
 * - 临时 Might 修正没有已注册原语（continuous.might 无实现；effect.buff 不覆盖），依赖
 *   RIFT-91（layers-continuous）。
 *
 * golden 测试执行 body 时依赖未注册的 continuous.might，故只做结构与负面证据（未注册
 * opcode）+ TODO；不把 +2 Might 改写成 Buff counter 来“通过”。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "war-scout.give-plus-2-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "war-scout.unit",
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-d81d427199a8fc8e3fb295ca97af6524da92927058f329c1bb53fd0c95837bfa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个缺口：(1) [Accelerate] 展开依赖尚未合入的 cost.additional / cost.pay 与" +
    "replacement.enter 管线（805.1.b 附加费 [1][Fury]、805.6 入场就绪替代；Accelerate.ts " +
    "文件头 dependency 注明 RIFT-89~91）；(2) “give a unit +2 :rb_might: this turn” 需要带" +
    "本回合期限的 continuous.might 持续效果，当前没有已注册的 continuous.might 实现" +
    "（RIFT-91 layers-continuous），effect.buff 只覆盖 Buff counter 且不能替代（702/703）。" +
    "不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "When you play me, give a unit +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
