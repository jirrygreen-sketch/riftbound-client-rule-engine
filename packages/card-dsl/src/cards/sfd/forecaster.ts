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
 * continuous.grant-keyword 本体都已经可执行并有 golden 证据。仍缺的是运行时获得的
 * Vision：layers 只把它记录为关键词特征，expandProgram 只展开印刷/声明关键词，
 * 没有消费方把获得的每个 Vision 实例展开成 817.1.b 的 Predict 触发，也没有把
 * Vision 展开中的占位控制者和有序牌库顶 picks 绑定到真实对象。不能把授予关键词本身
 * 当作 Predict 已执行。
 */
export default {
  canonicalCardId: "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有一处当前缺口：运行时获得的 Vision 只作为 ability 层关键词特征登记，" +
    "expandProgram 没有消费运行时关键词，因此不能把每个获得的 Vision 实例展开成 817.1.b 的 Predict 触发；" +
    "Vision 展开中的控制者仍是占位值，牌库顶 picks 也没有装配层按真实控制者和有序牌库绑定。" +
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
