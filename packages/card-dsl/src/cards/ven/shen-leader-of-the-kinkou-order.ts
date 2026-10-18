import type { CardProgram } from "../../ir/index.js";

/**
 * Shen, Leader of the Kinkou Order (ven-138-166) — Unit, 6 Energy + 2 Order
 * Power, 7 Might, Order, Shen/Ionia/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-138-166，逐字）：
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   When I hold, if there is exactly one other unit you control here, you score
 *   1 point.
 *
 * 规则依据（CR v1.5）：
 * - 814.1.c：[Shield] 功能等价于“当我是防守者时 +1 [M]”；关键词展开由已合入的
 *   keywords/Shield.ts 负责（814.1.b.3 无数值时按 1）。
 * - 383.4.d.1：“When I hold” 属 Hold Effects；471.2/473.2.b 规定固守触发在
 *   Beginning 的计分步骤、该战场被计分时触发；封闭时点 "hold"（315.2.b.2）。
 * - “if there is exactly one other unit you control here”：同地点、控制者为你的
 *   其它单位恰好 1 个（count + sameLocationAs + exclude，契约 3.6 的选择器形状）。
 * - “you score 1 point”：获得 1 点（470.1、473.1）；effect.score 已合入，与
 *   “战场被计分”是两回事（470.1–3），因此用 effect.score 而非 effect.win。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。Shield 半段可展开，hold 时点也已由
 * 合入的回合/计分流程发出（turn/flow.ts scheduleScore 的 Hold 计分步骤产生 'hold'
 * 发射并带 details.battlefieldId，engine-core/test/game/lifecycle.test.mjs 断言），
 * 卡牌程序绑定（src/programs/triggers.ts）也已能注册 CardProgram 的
 * triggered ability。仍未接通的是：
 * 1. 053.3 的 "here" 锚点——事件的战场身份只存在于 details.battlefieldId 载荷，
 *    静态 filter 读不到事件出的战场（pipeline-match.ts 的 details 匹配只接受写死的值），
 *    程序里的 here: true 也会被 programs/filters.ts 的 translateTriggerFilter
 *    以 judge-required 拒绝（fail closed）；
 * 2. 190.6 的战场能力控制者解析（hold 事件由战场上单位触发时如何取“你”）没有接线。
 * 依赖 053.3 here 锚点 / 190.6 战场能力绑定；不近似实现。
 */
export default {
  canonicalCardId: "card.hash-66a1a38d0f80c94dd99d8c34671b92d3e97ad609edb9693e7c2f2f31a8e70aa5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hold Effects 仍差两处接线（均不近似实现）：(1) 053.3 的「here」没有可求值锚点——hold 时点" +
    "（315.2.b.2、471.2、473.2.b）已由合入的回合/计分流程发出（turn/flow.ts scheduleScore 在 Beginning 的" +
    "Hold 计分步骤产生 'hold' 发射并带 details.battlefieldId，engine-core/test/game/lifecycle.test.mjs 断言），" +
    "卡牌程序绑定（src/programs/triggers.ts）也已能注册 CardProgram 的 triggered ability，" +
    "但事件的战场身份只存在于 details.battlefieldId 载荷，静态 filter 读不到事件出的战场" +
    "（pipeline-match.ts 的 details 匹配只接受写死的值），程序里的 here: true 也会被 " +
    "programs/filters.ts 的 translateTriggerFilter 以 judge-required 拒绝（fail closed，不静默放行）；" +
    "(2) 190.6 的战场能力控制者解析（单位固守时「you」如何绑定战场控制者）仍未接线。" +
    "[Shield] 关键词展开（814.1.c）与「score 1 point」的 effect.score 已合入，hold body 的" +
    "「恰好一个你控制的其它单位」条件（count + sameLocationAs + exclude）与 hold 事件发射均有真实执行证据。" +
    "依赖：053.3 here 锚点 / 190.6 战场能力绑定；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 471.2/473.2.b：本卡所在战场被固守时触发。封闭判别值是 "held"
        // （EVENT_NAMES 将其映射到 hold 时点）；过滤里的 `here` 仍是 053.3 的
        // 未绑定战场指代（见 judgeReason）。
        filter: { event: "held", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "shen.score-one",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } },
          // “if there is exactly one other unit you control here”：条件只作用于
          // 这条得分指令（契约 3.4 的条件从句作用范围）。
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "other-friendly-units-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                sameLocationAs: "self",
                exclude: "self"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I hold, if there is exactly one other unit you control here, you score 1 point."
} satisfies CardProgram;
