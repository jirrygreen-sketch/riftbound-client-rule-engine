import type { CardProgram } from "../../ir/index.js";

/**
 * Prepared Neophyte (unl-004-219) — Unit, 3 Energy, Might 1, Fury, tag Shadow Isles.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-004-219，逐字）：
 *   "If you've spent :rb_energy_4: or more to play a spell this turn, I have
 *    +4 :rb_might:."
 *
 * 规则依据（CR v1.5）：
 * - 364.3 / 364.3.a：以 "if" 开头的陈述是 Conditional Passive Ability（条件被动能力），
 *   它不是一个触发时点，而是一个持续生效的条件性特征修正。
 * - 143.2.a / 475 / 477：+4 :rb_might: 是对 Effective Might 的算术修正（arithmetic
 *   图层），不是 702 的 Buff 计数器（effect.buff 文件头明确临时 Might 修正归 layers
 *   的 continuous.might）。
 * - 「you've spent :rb_energy_4: or more to play a spell this turn」：需要读取"本回合为
 *   打出法术实际支付的 Energy 总量"的历史事实。契约 3.6 的 HistoryQuery 只有
 *   { scope, action, timingPoint, player, object }，只按动作次数计数、不能表达金额；
 *   已合入的 condition.history 原语（effects/interpreter.ts 的 condition.history →
 *   interpreter/history.ts）也只支持这五个字段，额外字段会抛错。
 *   与 ogn/loose-cannon（"If you've spent [4] or more this turn"）、unl/virtuoso（"if you
 *   spent [4] or more"）同一口径：不把金额条件近似成对象计数或恒真。
 *
 * status = judge-required（缺口不近似实现）：
 * - 条件侧缺可求值的"本回合为一个法术实际支付的 Energy ≥ 4"：合并的 Condition 代数只能
 *   读对象特征、链接值与对象计数（contracts 3.6 的 HistoryQuery 与 condition.history
 *   都是次数维度），没有金额维度，也没有费用计划的实际支付回执（依赖 RIFT-89）。
 * - 效果侧缺卡牌可用的 continuous.might 注册入口（static 能力的条件求值与图层接线属
 *   RIFT-91；layers/engine.ts 的 registerContinuousEffect 当前没有调用方）。
 *
 * 依赖：RIFT-89（费用计划的实际支付回执 / Energy 读取）、RIFT-91
 * （layers-continuous 的条件求值与卡牌 static 能力注册）。
 */
export default {
  canonicalCardId:
    "card.hash-c745e78b66006751f13b0d22fe0e99f6be02c370c981380ca0ec714e076b0d3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 条件「If you've spent :rb_energy_4: or more to play a spell this turn」没有可求值路径——" +
    "契约 3.6 的 HistoryQuery 只有 { scope, action, timingPoint, player, object }，只按动作次数计数、不读金额，" +
    "已合入的 condition.history 原语（interpreter/history.ts）对额外字段直接抛错，" +
    "Condition/Expr 也没有“本回合为一张法术实际支付了多少 Energy”的读取入口（依赖 RIFT-89 的费用计划回执）。" +
    "与 ogn/loose-cannon、unl/virtuoso 的同一缺口口径一致：不把金额条件近似成对象计数或恒真。" +
    "(2) 效果侧「I have +4 :rb_might:」是对 Effective Might 的算术修正（143.2.a / 475 / 477），" +
    "属 layers 的 continuous.might（不是 702 的 Buff 计数器）；卡牌可用的 static ↔ 图层注册入口与条件求值未合入" +
    "（RIFT-91：layers/engine.ts 的 registerContinuousEffect 无调用方，conditionMatches 也只识别 " +
    "always/never/type/has-tag/has-keyword）。" +
    "依赖：RIFT-89（费用计划的实际支付回执 / Energy 读取）与 RIFT-91（layers-continuous 的条件求值与卡牌接线）。不近似实现。",
  abilities: [
    {
      kind: "static",
      // 364.3.a 的条件被动 + 143.2.a / 475 的算术图层修正：+4 Might。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: { kind: "constant", value: 4 }
      },
      condition: {
        // 保留有依据的条件形状："本回合为一个法术支付的 Energy ≥ 4"。
        // count 表达式只数对象、不读金额（合并 IR 没有金额维度），真实求值见 judgeReason。
        kind: "compare",
        left: {
          kind: "count",
          subject: "energy-spent-on-spells-this-turn",
          filter: { player: "controller", type: "spell" }
        },
        operator: "gte",
        right: { kind: "constant", value: 4 }
      }
    }
  ],
  sourceText:
    "If you've spent :rb_energy_4: or more to play a spell this turn, I have +4 :rb_might:."
} satisfies CardProgram;
