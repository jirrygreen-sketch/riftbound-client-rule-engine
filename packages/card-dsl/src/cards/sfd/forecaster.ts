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
 * continuous.grant-keyword 本体都已经可执行并有 golden 证据。合入的
 * KeywordGrantLayerEngine 现在确实会重新读取运行时关键词，但它只接受能落到静态图层
 * 的 KeywordDef；Vision 展开的是 817.1.b 的 triggered Predict 能力，当前 re-expander
 * 会 fail-closed，生产 lifecycle 也仍未把这个动态能力注册到链上。Vision 展开中的控制者
 * 和有序牌库顶 picks 还没有装配层绑定到真实对象，不能把授予关键词本身当作 Predict 已执行。
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有一处当前缺口：运行时获得的 Vision 虽会被合入的 KeywordGrantLayerEngine 尝试消费，但它只接受能落到静态图层的 KeywordDef；" +
    "Vision 展开成 817.1.b 的 triggered Predict 能力，当前 re-expander 会 fail-closed，production lifecycle 也没有把" +
    "该动态能力注册到链上。Vision 展开中的控制者仍是占位值，牌库顶 picks 也没有装配层按真实控制者和有序牌库绑定。" +
    "通用测试台实测：打出被授予 Vision 的友方 Mech 只产生普通的进场/打出事件，没有任何 cards-looked-at；" +
    "static binder、controller: \"controller\" 的相对玩家归一化和 continuous.grant-keyword 本体已有真实执行证据，" +
    "但这些证据不等价于 Predict 已执行，不近似实现。",
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
