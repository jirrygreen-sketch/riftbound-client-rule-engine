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
 *   [1][Fury] + 805.6 入场替代）由 effects/keywords/Accelerate.ts 负责（已合入），
 *   卡牌不重复展开；
 * - "When you play me" 是 Play Effect（383.4.a；时点由 chain/engine.ts 产生）→ 时点
 *   card-played、filter 自身；
 * - "give a unit +2 :rb_might: this turn" 是带“本回合”期限的临时 Might 修正，属于
 *   layers 的 arithmetic 图层；已合入的 continuous.might 指令（RIFT-258）在结算时
 *   经 ResolveContext.addContinuous 注册 end-of-turn 期限的效果，effect.buff 只加
 *   Buff counter（702/703）不能代替。
 *
 * status: judge-required（不近似实现）：
 * - Accelerate 展开与 805.6 入场替代已合入并经 golden 核实；剩余缺口是
 *   accelerate.cost 的 Finalize optionalAdditional 消费：engine.ts 已读取
 *   selectedAdditional 中的 accelerate → ready，但没有任何打出流程把 805.1.b 的
 *   附加费 [1][Fury] 写进 selectedAdditional 并收取（805 附加费收取未接线）。
 * - “give a unit +2 :rb_might: this turn” 已用已合入的 continuous.might（RIFT-258）
 *   经解释器 + 图层内核真实执行。
 * golden 用解释器 + 参考内核真实执行 continuous.might 的 +2 与 end-of-turn 期限。
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
          duration: { kind: "constant", value: "this-turn" },
          // 作用对象经 TargetSpec 读取（continuous.might 的 target 参数按 ctx.targets(id) 解析）。
          target: { kind: "constant", value: "war-scout.unit" }
        },
        targets: [
          {
            id: "war-scout.unit",
            // “a unit” 是任意单位的目标选择（355.9 / 355.9.a.1），不限阵营与位置。
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
    "[Accelerate] 展开与 805.6 入场替代已合入；当前真实缺口是 805.1.b 的可选附加费 [1][Fury] 收取：" +
    "accelerate.cost 声明没有 Finalize optionalAdditional 消费方——chain/engine.ts（src/chain/engine.ts:431）已支持读取 " +
    "selectedAdditional 中的 accelerate 并让单位就绪，但没有任何打出流程把该附加费写入 " +
    "selectedAdditional 并收取（CR 805 的附加费收取未接线）。" +
    "“give a unit +2 :rb_might: this turn” 已用已合入的 continuous.might（RIFT-258）真实执行（golden 覆盖），" +
    "但不据此宣称整卡可执行。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "When you play me, give a unit +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
