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
 * status = judge-required。continuous.might 指令的 arithmetic 层注册与 CardProgram 的
 * static ↔ 图层接线均已合入。
 *
 * 仍缺一处（不近似实现）：
 * - 条件侧缺可求值的"本回合为一个法术实际支付的 Energy ≥ 4"：合并的 Condition 代数只能
 *   读对象特征、链接值与对象计数（contracts 3.6 的 HistoryQuery 与 condition.history
 *   都是次数维度），没有金额维度，也没有费用计划的实际支付回执（cost/payment.ts 产生
 *   回执但不进入 ResolveContext）。生产 binder 会用解释器求值本卡的 compare，但左值
 *   被当成对象计数，所以 4 个法术对象（任意区域/任意玩家）就会点亮 +4；该过度生效在
 *   test/cards/templates/static-644.test.mjs 中固定为缺口证据。
 *
 * 依赖：费用计划的实际支付回执 / Energy 读取入口。
 */
export default {
  canonicalCardId:
    "card.hash-c745e78b66006751f13b0d22fe0e99f6be02c370c981380ca0ec714e076b0d3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核后的真实缺口，不近似实现：(1) 打印条件「If you've spent :rb_energy_4: or more to play a spell this turn」没有求值路径——" +
    "条件表达式只能读对象特征、链接值与对象计数：interpreter/expr.ts 的 count 分支只做集合查询（queryObjects(expr.filter)），" +
    "subject \"energy-spent-on-spells-this-turn\" 完全不参与求值；契约 3.6 的 HistoryQuery（含已合入的 condition.history）只有 " +
    "{ scope, action, timingPoint, player, object } 的次数维度、对额外字段直接抛错，cost/payment.ts 的支付回执也不进入 ResolveContext，" +
    "因此“本回合为法术实际支付了多少 Energy”读不到。与 ogn/loose-cannon、unl/virtuoso 同一缺口口径：不把金额条件近似成对象计数或恒真。" +
    "(2) 效果侧的门控确实会被求值，但求值成错误的量：生产 binder（programs/statics.ts bindStaticToLayers → abilityEnvironment）用 " +
    "interpreter 的 evaluateCondition 包装本卡的 compare，解释器把左值当成对象计数，于是“4 个法术对象存在（任意区域/任意玩家）”就成立。" +
    "实测 0 能量、Trash 中有 4 张法术时 +4 仍然生效（golden 固定该行为为缺口证据，不是印刷语义；印刷期望保留为 test.todo）。" +
    "依赖：费用计划的实际支付回执 / Energy 读取入口。",
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
