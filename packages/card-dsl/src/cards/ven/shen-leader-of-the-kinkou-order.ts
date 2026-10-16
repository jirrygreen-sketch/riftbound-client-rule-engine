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
 * status = judge-required：Shield 半段可展开，但 Hold Effects 的触发条件与计分
 * 事件没有可执行路径——“hold” 时点在 events/timing-points.ts 内，但 events/
 * trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有 held/hold 判别值（validateTriggerSpec
 * 会拒绝 event: "hold"），事件载荷也没有“本卡所在战场被固守”的过滤维度；
 * scoring/scoring.ts 的 Hold 判定与触发收集只服务 M1 的 duel 路径，没有把卡牌程序的
 * 触发注册进该流程的接线（RIFT-120 的链/事件单管线）。condition 里的
 * sameLocationAs/exclude 与 denominator 计数形状已按契约写出，可在依赖落地后复核。
 * 依赖 RIFT-120（链与事件单管线）与 Hold 触发注册接线；不近似实现。
 */
export default {
  canonicalCardId: "card.hash-66a1a38d0f80c94dd99d8c34671b92d3e97ad609edb9693e7c2f2f31a8e70aa5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hold Effects 不可执行：(1) events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有 held/hold 判别值，" +
    "validateTriggerSpec 会以 invalid-event-type 拒绝 event: \"hold\"（golden 已断言），" +
    "events/timing-points.ts 里虽定义了 " +
    "\"hold\" 时点（315.2.b.2、471.2、473.2.b），但没有把卡牌程序注册进该计分流程的接线；" +
    "(2) scoring/scoring.ts 的固守判定与触发收集当前只服务 M1 duel 路径，没有 RIFT-120 链/事件单管线的" +
    "卡牌触发注册路径。[Shield] 关键词展开（814.1.c）与“score 1 point” 的 effect.score 已合入，" +
    "hold 触发的 body 结构（count + sameLocationAs + exclude 的“恰好一个你控制的其它单位”）已按契约" +
    "写出，可在依存落地后复核。依赖 RIFT-120 与 Hold 触发注册接线；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 471.2/473.2.b：本卡所在战场被固守时触发；过滤里的 `here` 是描述性的
        // Hold 载荷记录（严格触发器校验拒绝 event: "hold"，见 judgeReason）。
        filter: { event: "hold", here: true, player: "controller" }
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
