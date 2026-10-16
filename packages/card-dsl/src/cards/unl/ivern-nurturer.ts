import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Ivern, Nurturer (unl-051-219) — Unit, 5 Energy + 1 Calm Power, Might 4，
 * Calm，tag Ivern/Ionia/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-051-219，逐字）：
 *   When you play me or when I hold, look at the top 3 cards of your Main Deck.
 *   You may reveal a unit from among them and draw it. Recycle the rest. Then if
 *   you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit.
 *   (Give it a +1 :rb_might: buff if it doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.1 / 383.4.d.1：打印文本是同一个效果挂在两个触发条件上（“When you play me”
 *   与 “When I hold”），因此写成两个独立 triggered 能力（rad/pillaged-armory 同型），
 *   时点分别为 card-played（自身）与 hold（自身）。
 * - 128.4 / 128.6：看牌库顶 3 张是私下查看；契约 3.6 规定读牌库顶必须来自按区域真实
 *   顺序的上游 picks（query 不保证牌库顺序），由已合入的 effect.inspect 的 scope "top" +
 *   上游 picksSpecId 形状承载（与 keywords/Vision.ts 的 Predict 同一写法）。
 * - 425.1 / 425.1.a.2：“You may reveal a unit from among them” 把所选那张公开且不改变区域；
 *   从已看过的牌中选择属非目标 pick（355.7 / 355.10.a：手牌是非公开区域，牌库更不是
 *   目标区域），公开由 effect.reveal 提交。
 * - 414.1 / 414.1.a：“draw it” 是把那一张加入手牌（不是从牌库顶抽一张的动作），因此用
 *   effect.zone 的 to: "hand" 移动被公开的那张引用（sfd/apprentice-smith 的 “draw it”
 *   同一写法）。
 * - 417.1 / 417.1.a：“Recycle the rest” 把余下的牌回收到拥有者主牌库底；“the rest”
 *   是「看过集合 − 被选走的牌」的差集，本程序用链接值键 rest 记录该集合（见 judgeReason）。
 * - 702.2.a / 702.3.a：“[Buff] a friendly unit” 是 Buff 游戏动作（给一个你控制的单位放置
 *   一个 Buff counter；已有 Buff 的单位不再放置），由已合入的 effect.buff 的 mode "buff"
 *   执行；括号内是同一动作的释义（135.2.d.1/d.3：提醒文字不影响规则），不另写指令。
 * - 383.2.a.1：“Then if you revealed a Bird, Cat, Dog, or Poro” 是后续条件从句；它读的是
 *   展示那一刻的牌面特征（契约 3.4 的 Show Off 快照口径），见 judgeReason。
 *
 * status = judge-required（缺口不近似实现）：
 * - 条件从句 “if you revealed a Bird, Cat, Dog, or Poro” 无可求值形态：合并的 Condition
 *   只有 eq/ne/lt/lte/gt/gte/in，其中 in 只做标量成员判定（`right.includes(left)`），
 *   无法判断「展示快照的 tags 与四个标签有交集」；effect.inspect/effect.reveal 也只链接
 *   引用列表，不落标签快照。程序把该判定写成 compare(tags in [...]) 的**保留形状**，
 *   在真实内核里恒为 false（忽略该 Buff 指令），不会把 Buff 无条件执行。
 * - “Recycle the rest” 需要「看过集合减去被选走的牌」的差集，合并 IR 没有集合运算；
 *   程序用链接值键 rest 记录该集合，没有任何已合入指令写出该键（缺信息 → 该指令
 *   被忽略，不会回收错误的牌）。
 * - 选择“a unit from among them”的非目标 pick 带 filter { type: "unit" }（printing 限制），
 *   但已合入的 pick 解析（目标计划 / RIFT-90）只按 TargetPlan 的 Finalize 选项集锁定，
 *   不消费作用于链接集合的 filter 谓词；程序保留 filter 形状，不写成无过滤选择。
 * - 生产链路的「有序牌库顶 picks」提供方（RIFT-66 契约的 zoneSlice 语义接入查看指令）
 *   仍未接线，属调用方义务；golden 用参考内核按真实顺序绑定 picks 后执行。
 *
 * 依赖：RIFT-90（pick 的 Finalize 选项集与 filter 谓词）、RIFT-66 后续（有序牌库顶
 * 提供方）、展示快照条件与集合差表达式；不近似实现。
 */

/** 已看过 3 张的链接键（effect.inspect 写入）。 */
const LOOKED_CARDS = "ivern-nurturer.looked-cards";
/** 从已看过的牌中选出的那张 unit（非目标 pick）。 */
const REVEALED_UNIT = "ivern-nurturer.revealed-unit";

/** 383.4.a.1 / 383.4.d.1：两个触发共享同一段印刷效果。 */
function lookEffect(): readonly Instruction[] {
  return [
    {
      // 契约 3.6：“your Main Deck”的查看者是能力控制者（190.6.d）。已合入的
      // effect.inspect 的 player 参数需要 PlayerId 值，这里按 reinforce /
      // ogn/the-candlelit-sanctum 的写法先用 condition.value 从来源快照读出控制者，
      // 再经 linked-value 传入，避免在卡数据里写死座位。
      id: "ivern-nurturer.bind-controller",
      op: "condition.value",
      args: {
        value: { kind: "object-property", object: "source", property: "controller" },
        key: { kind: "constant", value: "controller" }
      }
    },
    {
      // “look at the top 3 cards of your Main Deck”：私下查看牌库顶 3 张；
      // scope "top" 按契约要求由上游提供有序 picksSpecId（见 judgeReason），
      // 这里 choose: false —— 从看过的牌里挑哪张由下面的 reveal 步骤负责，
      // 不在 inspect 内做选择（inspect 的 choose 没有 type filter）。
      id: "ivern-nurturer.look-top-three",
      op: "effect.inspect",
      linkedTo: "ivern-nurturer.bind-controller",
      args: {
        player: {
          kind: "linked-value",
          instructionId: "ivern-nurturer.bind-controller",
          key: "controller"
        },
        zone: { kind: "constant", value: "deck" },
        scope: { kind: "constant", value: "top" },
        amount: { kind: "constant", value: 3 },
        picksSpecId: { kind: "constant", value: "ivern-nurturer.top-three" },
        choose: { kind: "constant", value: false },
        linkedKey: { kind: "constant", value: "looked" },
        pickedKey: { kind: "constant", value: LOOKED_CARDS }
      }
    },
    {
      // 383.3.a.3：“You may reveal a unit from among them” 不在效果最开头，是结算时的
      // 可选决定；契约 3.9 要求把被选指令包进 choice.optional 的 body。
      id: "ivern-nurturer.reveal-unit-opt",
      op: "choice.optional",
      linkedTo: "ivern-nurturer.look-top-three",
      args: {
        prompt: { kind: "constant", value: "Reveal a unit from among them and draw it?" },
        body: {
          kind: "constant",
          value: [
            {
              // 425.1 / 425.1.a.2：公开所选的那张 unit，牌仍在原区域。
              id: "ivern-nurturer.reveal-unit",
              op: "effect.reveal",
              args: { pick: { kind: "constant", value: REVEALED_UNIT } },
              picks: [
                {
                  id: REVEALED_UNIT,
                  options: [
                    {
                      kind: "linked-value",
                      instructionId: "ivern-nurturer.look-top-three",
                      key: LOOKED_CARDS
                    }
                  ],
                  // “a unit from among them”：printing 限制；作用于链接集合的 filter
                  // 尚无消费方（见 judgeReason）。
                  filter: { type: "unit", zone: "deck" },
                  min: 1,
                  max: 1,
                  selection: "one"
                }
              ]
            },
            {
              // 414.1：“draw it” 把刚公开的那一张加入手牌（sfd/apprentice-smith 同型）。
              id: "ivern-nurturer.draw-revealed-unit",
              op: "effect.zone",
              linkedTo: "ivern-nurturer.reveal-unit",
              args: {
                pick: { kind: "constant", value: REVEALED_UNIT },
                to: { kind: "constant", value: "hand" },
                amount: { kind: "constant", value: 1 }
              },
              picks: [
                {
                  id: REVEALED_UNIT,
                  options: [
                    {
                      kind: "linked-value",
                      instructionId: "ivern-nurturer.look-top-three",
                      key: LOOKED_CARDS
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      // 417.1：“Recycle the rest” 把看过集合里没被选走的部分放回拥有者主牌库底。
      // 键 rest（差集）没有任何已合入指令写出（见 judgeReason），因此该指令在真实
      // 内核里因缺信息被忽略，而不是回收错误的牌。
      id: "ivern-nurturer.recycle-rest",
      op: "effect.recycle",
      args: {
        objects: {
          kind: "linked-value",
          instructionId: "ivern-nurturer.look-top-three",
          key: "rest"
        }
      }
    },
    {
      // 383.2.a.1 / 契约 3.4：“Then if you revealed a Bird, Cat, Dog, or Poro” 是后续
      // 条件从句，读的是展示时刻锁定的 tags 快照。保留形状（见 judgeReason）：
      // 合并的 compare 只做标量 in 判定，读 tags 数组时恒为 false → 该 effect.buff
      // 被跳过而不是无条件执行。
      id: "ivern-nurturer.buff-if-revealed-trait",
      op: "effect.buff",
      args: {
        mode: { kind: "constant", value: "buff" },
        target: { kind: "constant", value: "ivern-nurturer.friendly-unit" }
      },
      targets: [
        {
          id: "ivern-nurturer.friendly-unit",
          // 702.2.a：“a friendly unit” 是一个由你控制的 Board 单位（目标）。
          filter: { type: "unit", zone: "board", controller: "controller" },
          min: 1,
          max: 1,
          selection: "one"
        }
      ],
      condition: {
        kind: "compare",
        left: {
          kind: "object-property",
          object: { linked: "ivern-nurturer.reveal-unit" },
          property: "tags"
        },
        operator: "in",
        right: { kind: "constant", value: ["Bird", "Cat", "Dog", "Poro"] }
      }
    }
  ];
}

const abilities: Ability[] = [
  // 383.4.a.1：“When you play me” 是 Play Effect（时点 card-played，filter 指向自身）。
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: lookEffect()
  },
  // 383.4.d.1：“when I hold” 是 Hold Effect（时点 hold，filter 指向自身）。
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: lookEffect()
  }
];

export default {
  canonicalCardId:
    "card.hash-d16fb2648e7e67bb98e89d79ce7ab8da7d8444eb3e9111b6847cabe2620a2187",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）条件从句 “Then if you revealed a Bird, Cat, Dog, or Poro” 无可求值形态——" +
    "合并的 Condition 只有 eq/ne/lt/lte/gt/gte/in，其中 in 只做标量成员判定（right.includes(left)），" +
    "无法判断「展示快照的 tags 与这四个标签有交集」，effect.inspect/effect.reveal 也只链接引用列表、不落标签快照；" +
    "程序把该判定写成 compare(tags in [...]) 的保留形状，在真实内核里恒为 false（跳过该 Buff 指令），不无条件执行。" +
    "（2）“Recycle the rest” 需要「看过集合 − 被选走的牌」的差集，合并 IR 没有集合运算；程序用链接值键 rest 记录该集合，" +
    "没有任何已合入指令写出该键，该指令会因缺信息被忽略，而不是回收错误的牌。" +
    "（3）“a unit from among them” 的非目标 pick 带 filter { type: \"unit\" }（印刷限制），" +
    "但已合入的 pick 解析（目标计划）不消费作用于链接集合的 filter 谓词，只按 Finalize 锁定选项集；" +
    "另外生产链路的「有序牌库顶 picks」提供方（RIFT-66 契约的 zoneSlice 语义接入查看指令）仍未接线。" +
    "依赖：RIFT-90（pick 的 Finalize 选项集与 filter 谓词）、RIFT-66 后续（有序牌库顶提供方）、展示快照条件与集合差表达式。" +
    "effect.inspect（含上游有序 picks）、effect.reveal、effect.zone（draw it）与 effect.buff 本体均已合入，" +
    "golden 用解释器 + 参考内核真实执行这些部分。",
  abilities,
  sourceText:
    "When you play me or when I hold, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. " +
    "Recycle the rest. Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;
