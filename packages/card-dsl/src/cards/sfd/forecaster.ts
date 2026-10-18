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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * 卡牌 static → layers 的绑定、controller: "controller" 的相对玩家归一化、以及
 * continuous.grant-keyword 本体都已经可执行并有 golden 证据。
 *
 * 实测状态（re-checked 2026-10-18）：
 * - keywordDefinitionsById.get("Vision").expand({host}) 产出完整 817.1.b triggered 体
 *   （effect.inspect + effect.recycle），且该展开体在参考内核上真实执行成功：
 *   设置有序 deck-top picks 与可选回答后，look + recycle 事件真实发生、牌库重排。
 * - 但生产消费路径仍然 fail-closed：KeywordGrantLayerEngine.staticEffects 对运行时
 *   Vision 实例抛 judge-required "Dynamic triggered keyword abilities need a lifecycle
 *   binder"（keyword-grants.ts:236），production attachProgramLifecycle 也不消费
 *   keywordAbilities()，所以动态 triggered 能力仍未注册到真实链上。
 * - 展开体没有 zoneSlice picks 声明（body[0].picks === undefined，设计上留给装配层），
 *   因此放进生产 ChainEngine 时 orderedPickSpecs 收集不到、pickPlans 为空、inspect
 *   静默查 0 张；手工补 picks 后生产 ChainEngine 全链真实执行。player 仍是 constant("A")
 *   占位。zoneSlice 锁定机制本身已合入并有他卡执行证据；这里缺的是装配层把展开体按
 *   真实控制者与牌库顶绑定，以及 lifecycle binder。
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口是运行时获得的 Vision 的生产消费路径：KeywordGrantLayerEngine.staticEffects 对运行时 Vision 实例" +
    "抛 judge-required（原文 \"Dynamic triggered keyword abilities need a lifecycle binder\"，keyword-grants.ts:236），" +
    "production lifecycle（attachProgramLifecycle）也不消费 keywordAbilities()，所以 Vision 展开的 817.1.b triggered Predict 能力" +
    "没有被注册到真实链上。展开体本身有参考内核真实执行证据（补上有序 deck-top picks 与可选回答后 " +
    "look+recycle 真实发生、牌库重排），但展开体没有 zoneSlice picks 声明，放进生产 ChainEngine 时 " +
    "orderedPickSpecs 收集不到、inspect 静默查 0 张；player 仍是 constant(\"A\") 占位。装配层需要按真实控制者与" +
    "牌库顶绑定展开体并提供 lifecycle binder；zoneSlice 锁定机制本身已合入并有他卡执行证据，此处不列为机制缺口。" +
    "static binder、controller: \"controller\" 的相对玩家归一化和 continuous.grant-keyword 本体已有真实执行证据，" +
    "但这些证据不等价于 Predict 已在生产链执行，不近似实现。",
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
