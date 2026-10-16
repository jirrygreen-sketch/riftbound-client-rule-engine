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
 * status = judge-required（README 第 2 节），缺口逐条列出且不近似实现：
 * (1) This enters exhausted. 需要入场替代原语 replacement.enter 与卡牌 IR 到替代管线的接线
 *     （契约 3.4 / 3.5；同 ogn/iron-ballista）。
 * (2) [Predict 2] 的「看牌库顶 2 张」必须由上游按区域真实顺序提供 picks（契约 3.6 的
 *     zoneSlice 语义），而 effect.inspect 仍拒绝用无序 query 近似；该保序注入路径尚未进入
 *     契约（同 ven/apprentice-mage、rad/rakelstake 记录）。
 * (3) effect.inspect 的 argsSchema 仍要求 object-property 的 object 是运行时 ObjectRef，
 *     未同步契约 3.6 的符号选择器，因此查看者写成
 *     { kind: "object-property", object: "source", property: "controller" }（190.6.d 的能力
 *     控制者）在静态校验通过、原语执行时会被拒绝（RIFT-102 校验器收口）。
 * 已合入部分（inspect / recycle / order / draw / xp）在 golden 里用解释器真实执行：按本文件
 * 记录的两处缺口补上查看者与保序 picks 后运行程序原始 body。
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
        id: "scryers-bloom.predict-look",
        op: "effect.inspect",
        args: {
          // your Main Deck：查看者是能力控制者（190.6.d）。
          player: {
            kind: "object-property",
            object: "source",
            property: "controller"
          },
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
        // 437.1.a：其余按任意顺序放回牌库顶；张数 = 2 减去实际回收张数（不写死）。
        id: "scryers-bloom.predict-put-back",
        op: "effect.order",
        linkedTo: "scryers-bloom.predict-recycle",
        args: {
          destination: { kind: "constant", value: "top" },
          count: {
            kind: "arithmetic",
            operator: "sub",
            operands: [
              { kind: "constant", value: 2 },
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
    "三处依赖未合入，均不近似实现：(1)「This enters exhausted.」需要入场状态改写原语 replacement.enter 与卡牌 IR 到替代管线的接线" +
    "（契约 3.4 / 3.5；149.1 / 359.2.d 的 Gear 默认就绪进场，effect.exhaust 事后执行不是等价物，同 ogn/iron-ballista）。" +
    "(2)「[Predict 2]」的看牌库顶 2 张必须由上游按区域真实顺序提供有序 picks（契约 3.6 的 zoneSlice 语义），" +
    "effect.inspect 明确拒绝用无序 query 近似（同 ven/apprentice-mage、rad/rakelstake）。" +
    "(3) effect.inspect 的 argsSchema 仍要求 object-property 的 object 是运行时 ObjectRef，未同步契约 3.6 的符号选择器，" +
    "因此查看者（190.6.d 的能力控制者）只能按符号选择器书写并在执行层被拒绝（RIFT-102 校验器收口）。" +
    "已合入的 inspect / recycle / order / draw / xp 在 golden 里按这两处缺口补上绑定后真实执行；不近似实现入场状态与查看范围来源。",
  abilities,
  sourceText:
    "This enters exhausted.\n" +
    "Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.  " +
    "(To Predict 2, look at the top two cards of your Main Deck. Recycle any of them and put the rest back in any order.)"
} satisfies CardProgram;
