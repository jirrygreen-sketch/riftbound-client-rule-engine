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
 * status 判定（cards/README.md 第 2 节）：judge-required —— 第二条能力整体受阻，不近似实现：
 * - Gold gear token（187.5：自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）不在 effect.token 的冻结
 *   定义表里（该文件记录「需要其他能力的定义，含 Gold，保持 blocked/judge-required」）。
 * - 打出新 token 需要 create-token 的链上创建 + play 接手（440.2.c / 185.2.a），冻结的
 *   create-token 只在场上创建。
 * - "exhausted" 是入场规定（184.1 / 185.2.d），创建/打出动作不支持入场状态改写；effect.exhaust
 *   文件头明确事后横置不等价（会多一次「成为横置」事件并错过 143.4）。
 * 第一条能力（card-played 触发 + effect.buff 的 0…4 目标）本身只用已合入原语，golden 真实执行；
 * 但整卡状态按 README 第 2 节以未完成的第二条为准，不做局部宣称。
 * 依赖：Gold 定义与链上创建/入场状态（token 原语任务，RIFT-62 后续）。
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
          // 184.1 / 185.2.d：入场状态规定，绝不是事后横置（143.4）。
          entersExhausted: { kind: "constant", value: true },
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
    "第二条能力「When you spend a buff, play a Gold gear token exhausted.」整体受阻，均不近似实现：" +
    "(1) Gold gear token（187.5，自带 \"[Reaction][>] Kill this, [E]: [Add] [A]\"）不在 effect.token 的冻结定义表里——" +
    "该文件明确把需要其他能力的定义（含 Gold）保持 blocked/judge-required；(2) 「play a … token」要求按 " +
    "440.2.c/185.2.a/350.2/354 先在链上创建再由 play 接手，冻结的 create-token 只在场上创建；" +
    "(3) 「exhausted」是入场规定（184.1/185.2.d），创建与打出动作不支持入场状态改写，effect.exhaust 文件头" +
    "明确事后横置不等价（会多一次「成为横置」事件并错过 143.4）。" +
    "第一条能力「buff up to four friendly units」只用已合入的 effect.buff（702.2.a/702.3.a，0…4 的 up-to 目标，355.13）" +
    "并在 golden 中真实执行；第二条的 buff-spent 时点（events/timing-points.ts，702.2.b/705）订阅形状也已声明，" +
    "但整卡状态以未完成部分为准。依赖：Gold 定义与链上创建/入场状态（token 原语任务，RIFT-62 后续）。",
  abilities,
  sourceText:
    "When you play me, buff up to four friendly units. (Give each a +1 :rb_might: buff if it doesn't have one.)\n" +
    "When you spend a buff, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
