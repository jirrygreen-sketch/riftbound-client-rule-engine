import type { CardProgram } from "../../ir/index.js";

/**
 * Forecaster (sfd-065-221) — Rumble SFD precon unit, tags Mech.
 *
 * "Your Mechs have [Vision]. (When you play us, look at the top card of your
 * Main Deck. You may recycle it.)"
 *
 * 规则依据（CR v1.5）：478/478.1.a 的 ability 图层承载关键词获得；817.1.b 把
 * Vision 展开为进场触发 + Predict（effect.inspect → 可选回收）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处当前缺口：
 * - 没有生产消费方把卡牌 static 能力注册进图层：RIFT-257 的 createProgramBinding
 *   只提供 ProgramStaticBinder 回调钩子，默认 noopStaticBinder，没有任何已合入实现
 *   把 continuous.grant-keyword 的 ContinuousEffectSpec 写进 layers 注册表。
 * - 被授予的 Vision 不会按实例展开成 817.1.b 的 Predict：授予只在 ability 层留下
 *   { id: "Vision" }，没有消费方为获得关键词的对象展开触发并绑定真实控制者与牌库顶
 *   （Vision 展开内的 player 是占位，牌库顶 picks 需要装配层按 zoneSlice 绑定）。
 *   "Your Mechs" 的 controller: "controller" 同样需要 PlayerSelector 归一化
 *   （layers/filter.ts 只识别 self/opponent/{playerId}）。
 * 已合入并真实执行：continuous.grant-keyword 原语（RIFT-258）与 Vision KeywordDef
 * （RIFT-83）都已注册；golden 用生产链适配器 + 图层引擎真实执行该授予（只作用友方
 * Mech，到期语义由 duration 承载），但不构成整卡证据。
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) 没有生产消费方把卡牌 static 能力注册进图层——RIFT-257 的 createProgramBinding 只提供 " +
    "ProgramStaticBinder 回调钩子（默认 noopStaticBinder），没有任何已合入实现把 continuous.grant-keyword 的 " +
    "ContinuousEffectSpec 写进 layers 注册表。(2) 被授予的 Vision 不会按实例展开成 817.1.b 的 Predict：" +
    "授予只在 ability 层留下 { id: \"Vision\" }，没有消费方为获得关键词的对象展开触发并绑定真实控制者与牌库顶 " +
    "（Vision 展开内的 player 是占位；string 过滤器的 controller: \"controller\" 也需要 PlayerSelector 归一化）。" +
    "grant-keyword 原语（RIFT-258）与 Vision KeywordDef（RIFT-83）本身已合入，golden 已用生产链适配器 + 图层引擎" +
    "真实执行授予（只作用友方 Mech、duration 到期），但 static 绑定缺口未解决，不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Vision",
        filter: {
          zone: "board",
          controller: "controller",
          tag: "Mech",
          type: "unit"
        }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Vision]. (When you play us, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;
