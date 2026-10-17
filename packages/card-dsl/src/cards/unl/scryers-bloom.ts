import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scryer's Bloom (unl-136-219) — Gear, Chaos。
 * energy 1、power null（无印刷 Power）、might null（无印刷 Might）、tags []。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-136-219，逐字）：
 *   This enters exhausted.
 *   Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.
 *   (To Predict 2, look at the top two cards of your Main Deck. Recycle any of
 *   them and put the rest back in any order.)
 *
 * 规则依据（CR v1.5）：
 * - 149.1 / 359.2.d：非单位 Gear 默认就绪进场；This enters exhausted. 是入场状态改写
 *   （替代族，契约 3.4 / 3.5），不是一次横置动作——effect.exhaust 事后执行会多出一次
 *   「成为横置」事件并错过入场替代，因此不能近似（同 ogn/iron-ballista 记录）。
 * - 437.1 / 437.1.a / 437.3 / 437.4：Predict 2 = 看牌库顶 2 张、回收其中任意张、其余按
 *   任意顺序放回；不足时尽可能多看，不因 Predict 而 Burn Out。本体拆成已合入的
 *   effect.inspect（scope top，需上游提供保序 picksSpecId）→ effect.recycle（回收所选）
 *   → effect.order（把剩余按任意顺序放回顶部）。
 * - 414.3：then draw 1 是顺序词、不是 if you do，抽牌是独立指令；Gain 1 XP 是另一独立句。
 * - 357.2 / 415.4 / 415.5：:rb_exhaust: 是横置自身的费用；Kill this 也是费用。非标准费用
 *   可以任意顺序支付，但「先 kill 再 exhaust」会让本源引用失效、横置费用无法完成，因此程序
 *   按唯一可完成的顺序写 exhaust → kill。
 * - 151 / 151.2：Gear 启动能力默认在控制者 Main Phase 的 Open State 执行。
 *
 * status = judge-required：
 * 当前缺口是 Predict 2（CR 437.1.a/437.4）的有序范围绑定：effect.inspect 的 scope:top 只读取外部 picksSpecId，
 * programs/ 与 chain/ 没有从真实牌库 zoneSlice 自动提供这组 top-2 picks 的路径（RIFT-358），不能用无序 query 近似。
 * 149.1/359.2.d 的 replacement.enter 与卡牌替代绑定已合入；查看者已通过 condition.value 绑定来源控制者，
 * 再由 effect.inspect 读取 linked-value，避免其旧 argsSchema 对符号 object-property 的限制。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        // 149.1 / 359.2.d 的入场状态改写；消费方是入场替代管线（replacement.enter）。
        id: "scryers-bloom.enter-exhausted",
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "exhausted" },
          zone: { kind: "constant", value: "board" }
        }
      }
    ]
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      // 357.2：非标准费用任意顺序；exhaust 必须在 kill 之前才能完成（415.4）。
      payments: [{ kind: "exhaust" }, { kind: "kill" }]
    },
    body: [
      {
        // 先由解释器绑定能力控制者，再传给仍使用旧 Expr schema 的 effect.inspect。
        id: "scryers-bloom.viewer",
        op: "condition.value",
        args: {
          value: { kind: "object-property", object: "source", property: "controller" }
        }
      },
      {
        id: "scryers-bloom.predict-look",
        op: "effect.inspect",
        args: {
          // your Main Deck：查看者是能力控制者（190.6.d）。
          player: { kind: "linked-value", instructionId: "scryers-bloom.viewer", key: "value" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          // 437.1.a：牌库顶 2 张的保序来源由上游按该稳定 id 提供（契约 3.6）。
          picksSpecId: { kind: "constant", value: "scryers-bloom.predict-top-2" },
          amount: { kind: "constant", value: 2 },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "scryers-bloom.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        }
      },
      {
        // 417.1.b / 417.4：回收所选（选择 0 张是成功的 no-op）；读取查看步骤的选择结果。
        id: "scryers-bloom.predict-recycle",
        op: "effect.recycle",
        linkedTo: "scryers-bloom.predict-look",
        args: {
          objects: {
            kind: "linked",
            instructionId: "scryers-bloom.predict-look",
            key: "predict-recycle"
          }
        }
      },
      {
        // 437.1.a / 437.4：其余张数 = 实际查看张数减去实际回收张数。
        id: "scryers-bloom.predict-put-back",
        op: "effect.order",
        linkedTo: "scryers-bloom.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "linked-value", instructionId: "scryers-bloom.predict-look", key: "inspected" },
              {
                kind: "linked-value",
                instructionId: "scryers-bloom.predict-recycle",
                key: "recycledCount"
              }
            ]
          },
          chooseOrder: { kind: "constant", value: true }
        }
      },
      {
        // 414.3：then draw 1 是顺序词，抽牌独立结算（不链到 Predict 结果）。
        id: "scryers-bloom.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      },
      {
        // 730.1：Gain 1 XP 是另一独立句。
        id: "scryers-bloom.gain-xp",
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-12391b1b0c8fa259528e28974f6a47bd51892b5b66931b7c3529759298d8deb7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口是 Predict 2（CR 437.1.a/437.4）的有序范围绑定：effect.inspect 的 scope:top 只读取外部 picksSpecId，" +
    "programs/ 与 chain/ 没有从真实牌库 zoneSlice 自动提供这组 top-2 picks 的路径（RIFT-358），不能用无序 query 近似。" +
    "149.1/359.2.d 的 replacement.enter 与卡牌替代绑定已合入；查看者已通过 condition.value 绑定来源控制者，" +
    "再由 effect.inspect 读取 linked-value，避免其旧 argsSchema 对符号 object-property 的限制。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    "Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.  " +
    "(To Predict 2, look at the top two cards of your Main Deck. Recycle any of them and put the rest back in any order.)"
} satisfies CardProgram;
