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
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - 牌库顶有序 picks 已由 RIFT-358 的生产链路承载：look 的 PickSpec 直接声明
 *   zoneSlice { zone: "deck", from: "top", count: 3 }，chain/engine.ts 的 Finalize 用
 *   zoneSlice 锁定保序引用（chain/picks/plan.ts，query 顺序绝不采用），Resolve 时
 *   effect.inspect 的 scope "top" 读取同一份锁定列表。golden 用真实 ChainEngine 执行。
 * - “Recycle the rest” 已可用已合入语义表达：draw it 走 effect.zone 换区后旧引用失效（124），
 *   不再出现在 ctx.object 查询里；因此 effect.recycle 直接回收 effect.inspect 写出的整份
 *   已看列表就等价于「看过集合 − 被选走的那张」。golden 在真实引擎里实证回收事件恰好
 *   是剩余张数，且未被抽走的那张留在手牌。
 * - 「a unit from among them」的非目标 pick 仍无生产消费方：PickSpec 的 options（含
 *   linked-value 形式）不会绑定成选择，chain/picks/plan.ts 的 checkSource 又拒绝给
 *   linked 来源带 filter；所以 effect.reveal 在生产链路取不到「对手牌里那一张」，
 *   实测传入未绑定 pick 时 effect.reveal 以 negated/impossible 关闭。
 * - 条件从句 “if you revealed a Bird, Cat, Dog, or Poro” 仍无可求值形态：合并的 Condition
 *   只有 eq/ne/lt/lte/gt/gte/in，in 只做标量成员判定（values.ts: right.includes(left)），
 *   无法判断「展示快照的 tags 与四个标签有交集」；effect.inspect/effect.reveal 也只链接
 *   引用列表，不落标签快照（那张牌此时已被 draw it 换区，引用失效）。程序保留
 *   compare(object-property(linked reveal, tags) in [...]) 的**保留形状**，在真实内核里
 *   恒为 false（跳过该 Buff 指令），不会把 Buff 无条件执行。
 *
 * 依赖：链接集合上的非目标 pick 消费方（含 printing filter）与展示快照的 tags 交集谓词。
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
      // “look at the top 3 cards of your Main Deck”：私下查看牌库顶 3 张。
      // 契约 3.6 / RIFT-358：显式有序来源 = options: []、ordered: true、selection: "all"，
      // Finalize 按 zoneSlice 锁定真实牌库顶三张并保序（chain/picks/plan.ts 是唯一顺序权威，
      // query 顺序绝不被采用）。choose: false —— 从看过的牌里挑哪张由下面的 reveal 负责，
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
      },
      picks: [
        {
          id: "ivern-nurturer.top-three",
          options: [],
          ordered: true,
          selection: "all",
          zoneSlice: {
            zone: "deck",
            from: "top",
            count: { kind: "constant", value: 3 }
          }
        }
      ]
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
      // “the rest” = 已看集合 − 被 draw it 换区的那张：124 规定换区后旧引用失效，
      // effect.recycle 只用 ctx.object 仍存在的引用（liveObjects），所以直接回收整份已看
      // 列表即等价于差集，不需要额外的集合运算（见 judgeReason）。
      id: "ivern-nurturer.recycle-rest",
      op: "effect.recycle",
      args: {
        objects: {
          kind: "linked-value",
          instructionId: "ivern-nurturer.look-top-three",
          key: LOOKED_CARDS
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
    // 封闭 EventPattern 词表把 hold 时点拼成 "held"（events/trigger-spec.ts 的
    // EVENT_PATTERN_TYPES + pipeline-match.ts 的 EVENT_NAMES 别名），"hold" 会被
    // validateTriggerSpec 以 invalid-event-type 拒绝，生产注册直接失败。
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
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
    "仍缺两处，均不近似实现：（1）「a unit from among them」的非目标 pick 没有生产消费方：" +
    "PickSpec 的 options（含 linked-value 形式）不会绑定成选择，chain/picks/plan.ts 的 checkSource 又拒绝给 linked 来源带 filter，" +
    "因此 effect.reveal 在生产链路取不到「看过的那三张里的一张」——实测传入未绑定 pick 时以 negated/impossible 关闭；" +
    "（2）条件从句 “Then if you revealed a Bird, Cat, Dog, or Poro” 无可求值形态——" +
    "合并的 Condition 只有 eq/ne/lt/lte/gt/gte/in，其中 in 只做标量成员判定（right.includes(left)），" +
    "无法判断「展示快照的 tags 与这四个标签有交集」，effect.inspect/effect.reveal 也只链接引用列表、不落标签快照；" +
    "程序把该判定写成 compare(tags in [...]) 的保留形状，在真实内核里恒为 false（跳过该 Buff 指令），不无条件执行。" +
    "依赖：链接集合上的非目标 pick 消费方（含 printing filter）与展示快照的 tags 交集谓词。" +
    "已合入并真实执行的部分：牌库顶有序 picks 由卡牌自己的 PickSpec zoneSlice 在生产链 Finalize 锁定（RIFT-358），" +
    "effect.inspect 的 top 作用域读取同一份保序列表；“Recycle the rest” 用“已看列表 − 换区失效引用”表达，" +
    "golden 在真实 ChainEngine 里断言回收事件恰好是剩余张数且被抽走的那张留在手牌；" +
    "effect.reveal、effect.zone（draw it）与 effect.buff 本体均已有执行证据。",
  abilities,
  sourceText:
    "When you play me or when I hold, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. " +
    "Recycle the rest. Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;
