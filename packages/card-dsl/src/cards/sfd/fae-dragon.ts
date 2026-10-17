import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Fae Dragon (sfd-101-221) — Unit, 7 energy + 1 Body power, Might 7，
 * 领域 Body，标签 Fae / Dragon / Bandle City。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-101-221，逐字）：
 *   "When you play me, buff up to four friendly units. (Give each a +1 :rb_might:
 *    buff if it doesn't have one.)
 *    When you spend a buff, play a Gold gear token exhausted."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 420.4.a："When you play me" 是 Play Effect（时点 card-played，filter 指向自身）。
 * - 355.7 / 355.9.b："up to four friendly units" 是由玩家选定具体对象的集合（"up to" 允许 0…4，
 *   355.13），因此是 TargetSpec（selection "up-to"、min 0、max 4），不是 pick。印刷没有 "other"，
 *   所以自身也在合法集合内。
 * - 702.2.a / 702.3 / 702.3.a："buff" 放置一个 Buff，已有 Buff 的单位仍可被选但不放置第二个；
 *   括号是 reminder（703 的 +1 Might 由图层从 Buff 计数派生），不是独立指令。
 * - 702.2.b / 705："When you spend a buff" 是花费 Buff 时触发的能力，封闭时点用
 *   events/timing-points.ts 的 "buff-spent"（events/action-adapter.ts 把 spend-buff 动作映射到
 *   该时点）；"you" 指能力控制者（190.6.d），故 filter 的 player 用 "self"。
 * - "play a Gold gear token exhausted"：440.2.c / 185.2.a / 350.2 / 354（被"打出"的 token 先在
 *   链上创建再由 play 接手）、184.1 / 185.2.d（入场状态改写）、187.5（Gold 的印刷定义）。
 *
 * Status: judge-required. The first triggered body's buff primitive executes.
 * The second still needs the Gold definition (187.5), exhausted entry
 * (184.1/185.2.d), a buff-spent event-pattern registration, and a relative
 * controller-base token destination. timing-points.ts/action-adapter.ts already
 * define/produce buff-spent, but EVENT_PATTERN_TYPES cannot subscribe to it.
 * The create-on-chain/play handoff (440.2.c/185.2.a) is already merged.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "fae-dragon.buff-up-to-four",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "fae-dragon.friendly-units" }
        },
        targets: [
          {
            id: "fae-dragon.friendly-units",
            // 355.13："up to four" = 0…4；"friendly" 是能力控制者的单位（"controller" 占位符由
            // 目标管线在 Finalize 解析，与已合入 ogn/kinkou-monk、ogn/blind-monk 同型）。
            filter: { type: "unit", zone: "board", controller: "controller" },
            min: 0,
            max: 4,
            selection: "up-to"
          }
        ]
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "buff-spent",
      // 702.2.b / 705：你花费 Buff 时触发；花费者即事件玩家（190.6.d 的 "you"）。
      filter: { event: "buff-spent", player: "self" }
    },
    optional: false,
    body: [
      {
        id: "fae-dragon.play-gold-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被「打出」的 token 先在链上创建。
          mode: { kind: "constant", value: "play" },
          // 记号目的地：Gear token 在控制者 Base 生成（440.2.b.1 的永久物默认）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          // 184.1/185.2.d exhausted entry is blocked; TokenArgs has no entry
          // override. Do not invent an argument or append effect.exhaust.
          linkKey: { kind: "constant", value: "goldToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-25827836268ab76ff935741b947b08a906c9a719348a2c911526d1b8321ecce9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "第二条能力仍受阻：(1) Gold（187.5，自带 [Reaction][>] Kill this, [E]: [Add] [A]）不在 effect.token 的可执行定义中；(2) exhausted 是入场规定（184.1/185.2.d），当前 TokenArgs/创建与打出动作没有该入口，事后 effect.exhaust 会产生额外横置事件，不能替代（143.4）；(3) buff-spent 虽在 timing-points.ts/action-adapter.ts 中，但不在 EVENT_PATTERN_TYPES，事件管线不能注册此订阅（702.2.b/705）；(4) effect.token 的 LocationRef 需要实际 PlayerId，没有相对 controller-base 的目的地记法。链上创建/play 路径（440.2.c/185.2.a）与第一条 effect.buff 的 0…4 目标均已合入，后者有真实执行测试。程序绑定本身已存在；仅这些具体缺口保持 judge-required。",
  abilities,
  sourceText:
    "When you play me, buff up to four friendly units. (Give each a +1 :rb_might: buff if it doesn't have one.)\n" +
    "When you spend a buff, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
