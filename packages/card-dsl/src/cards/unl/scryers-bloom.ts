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
 * status = executable（2026-10-17 按合并源码逐项复核）：
 * - Predict 2 的有序范围由已合入的 RIFT-358 生命周期承担：PickSpec 写显式有序来源
 *   （options: []、ordered: true、selection: "all"、zoneSlice { zone: "deck", from: "top",
 *   count: 2 }），chain Finalize 调 chain/picks/plan.ts 的 finalizeOrderedPickPlans，
 *   用 ctx.zoneSlice 读真实牌库顶并保序（该文件是唯一顺序权威，ring/query 从不推断顺序），
 *   结算期 effect.inspect 经 ResolveContext.picks 读回锁定集合。
 * - 入场横置改写（149.1 / 359.2.d）由 replacement.enter 与卡牌替代绑定承担；
 *   费用（1 Energy + exhaust 自身 + kill 自身）由已合入的费用计划支付；
 *   查看→回收→排序→抽 1→+1 XP 五步都走已合入原语。
 * 各能力对应的执行证据见 test/cards/unl/scryers-bloom.test.mjs。
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
          // 437.1.a：牌库顶 2 张的保序来源——由本卡的 PickSpec 声明，Finalize 锁定。
          picksSpecId: { kind: "constant", value: "scryers-bloom.predict-top-2" },
          amount: { kind: "constant", value: 2 },
          choose: { kind: "constant", value: true },
          chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
          choiceId: { kind: "constant", value: "scryers-bloom.predict" },
          pickedKey: { kind: "constant", value: "predict-looked-at" },
          choosePicksKey: { kind: "constant", value: "predict-recycle" }
        },
        picks: [
          {
            id: "scryers-bloom.predict-top-2",
            // 契约 3.6 / RIFT-358：显式有序来源 = options: []、ordered: true、
            // selection: "all"；Finalize 用 ctx.zoneSlice 锁定真实牌库顶并保序，
            // query 顺序绝不被采用（缺有序来源时 effect.inspect 按 impossible 阻断）。
            options: [],
            ordered: true,
            selection: "all",
            zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
          }
        ]
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
  status: "executable",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    "Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.  " +
    "(To Predict 2, look at the top two cards of your Main Deck. Recycle any of them and put the rest back in any order.)"
} satisfies CardProgram;
