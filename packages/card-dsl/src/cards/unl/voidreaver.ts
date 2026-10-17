import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Voidreaver (unl-201-219) — Legend, Body/Chaos, tag Kha'Zix.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-201-219，逐字）：
 *   When you win a combat, gain 1 XP.
 *   Spend 1 XP, :rb_exhaust:: [Buff] a unit.
 *   Spend 2 XP, :rb_exhaust:: Move an exhausted friendly unit from a battlefield
 *   to its base.
 *
 * 规则依据（CR v1.5）：
 * - 468.3.a / 468.3.b：玩家在战斗结果判定步骤「赢得战斗」；时点用封闭表的
 *   combat-result（events/timing-points.ts，payloadFields 含 winnerId/loserId/
 *   unitResults/noResult，refs 468.3.a-468.4），filter 用 EventPattern.player 的
 *   PlayerSelector "self" 表达「你是赢家」。触发式能力进链后结算（383.3）。
 * - 728 / 730.1 / 733：「gain 1 XP」是增加玩家已标记的 XP，无上限，用 effect.xp
 *   （amount 1，获得者缺省为能力控制者，190.6.d）。
 * - 404.1.a / 415.5：启动能力的费用在「:」之前；本卡第二、三段分别是
 *   「Spend 1 XP, :rb_exhaust:」与「Spend 2 XP, :rb_exhaust:」，由合并费用管线
 *   （cost/plan-values.ts 的 payments: [{ kind: "xp", amount }, { kind: "exhaust" }]
 *   与 cost/payment.ts 的 spend-xp 支付）承载；174.8 / 376：传奇可以有启动能力。
 * - 「[Buff] a unit」按 702.2.a / 427.1 放置一个 Buff 计数（703 的 +1 Might 由图层
 *   从计数派生），用 effect.buff 的 mode "buff"；「a unit」是单个由你选择的单位
 *   （355.9 / 355.10），因此是选目标，不是 pick。
 * - 「Move an exhausted friendly unit from a battlefield to its base」是一个由文本
 *   指名的单位（355.9 / 355.10），属选目标；「from a battlefield」是目标合法性的
 *   位置限制（355.9.b / 355.10.b），「to its base」是该单位控制者的 Base（107.1.c），
 *   由 effect.move 的 "controller-base" 目的地在结算时按对象解析（448.1 / 451）。
 *   该 Move 是效果式移动（不是 144 的标准移动），不追加横置费用与 Main Phase 限制
 *   （effect.move 文件头的边界说明）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 「when you win a combat」有两层缺口，均实测：
 *   （a）EventPattern 的封闭事件词表仍不含 combat-result：把本卡的 filter 交给
 *   pipeline.registerTrigger，validateTriggerSpec 以 invalid-event-type 拒绝（列出的事件名只有
 *   zone-entered…conquered/held/scored/final-point），战斗胜负触发无法注册；
 *   （b）即使有词表也没有生产者：combat/flow.ts 只发 control-established / control-lost /
 *   contested-applied，start-combat 与伤害分配仍以 TurnCombatBlockedError 保持 blocked
 *   （"combat-start-transaction"、"simultaneous-damage-transaction"），
 *   duel/engagement-executor-v2.ts 的 settleCombatResult 只在 duel 分支内部判定结果，
 *   没有任何模块 emit combat-result（468.3.a / 468.3.b）。
 * - 「Spend 1 XP / 2 XP, :rb_exhaust:」的两条启动能力只差费用，费用形状、目标与
 *   正文原语均已按现契约编码（cost/payment.ts 的 spend-xp 支付与 effect.buff / effect.move 都在
 *   合并原语中），但整卡因为战斗胜负触发不可执行而保持 judge-required；
 *   golden 对两条启动能力分别用真实费用计划与参考内核执行。
 * - 「me」是 Legend Zone 中的传奇（CR 107.4.a / 107.4.c）：契约 ZoneId 没有
 *   legend-zone，cost/payment.ts 的 exhaust 支付只接受 board / rune-zone 的对象
 *   （与其他传奇的既有口径一致）。
 *
 * 依赖：combat-result 的 EventPattern 词汇与战斗结果事件生产接线、契约补充 legend-zone。
 */
const buffUnit: Instruction = {
  id: "voidreaver-1.buff-unit",
  op: "effect.buff",
  args: {
    // 427.1 / 702.2.a：放置一个 Buff 计数（703 的 +1 Might 由图层派生）。
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "voidreaver-1.unit" }
  },
  targets: [
    {
      // 355.9 / 355.10：「a unit」是单个由能力控制者选择的单位；未写「friendly」
      // 即为任意单位（双方棋盘上的单位都是合法选择）。
      id: "voidreaver-1.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const moveUnit: Instruction = {
  id: "voidreaver-2.move-unit",
  op: "effect.move",
  args: {
    // 355.9 / 355.10：「an exhausted friendly unit」是文本指名的对象，属选目标。
    objects: {
      kind: "constant",
      value: { target: "voidreaver-2.exhausted-friendly-unit" }
    },
    // 「to its base」= 该单位控制者的 Base（107.1.c），由目的地在结算时按对象解析；
    // 这是效果式 Move（448.1 / 451），不是 144 的标准移动。
    to: { kind: "constant", value: "controller-base" },
    amount: { kind: "constant", value: 1 }
  },
  targets: [
    {
      id: "voidreaver-2.exhausted-friendly-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        // 「from a battlefield」是目标合法性的位置限制（355.9.b）；「exhausted」
        // 是状态限制（415.2 可被条件读取）。
        location: "battlefield",
        states: "exhausted"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const voidreaver = {
  canonicalCardId:
    "card.hash-26b216537a1ea75534e8ac12dce51fb874287be073f54ce04f788aa43ab7c64e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发侧有两层缺口：「When you win a combat」的时点 combat-result 虽在 timing-points.ts 定义，但 EventPattern 的封闭词表不接受该事件名" +
    "（实测把本卡 filter 交给 pipeline.registerTrigger 时 validateTriggerSpec 以 invalid-event-type 拒绝）；" +
    "同时没有发射方把结果接入事件管线（CR 468.3.a / 468.3.b，payloadFields 含 winnerId/loserId）——" +
    "combat/flow.ts 只发 control-established / control-lost / contested-applied，" +
    "start-combat 与伤害分配仍以 TurnCombatBlockedError 保持 blocked（combat-start-transaction、simultaneous-damage-transaction），" +
    "duel/engagement-executor-v2.ts 的 settleCombatResult 只在 duel 分支内部判定结果；没有任何模块 emit combat-result，触发无法进链。" +
    "另「me」是 Legend Zone 中的传奇（CR 107.4.a / 107.4.c），契约 ZoneId 没有 legend-zone，cost/payment.ts 的 exhaust 支付只接受 board / rune-zone 的对象。" +
    "两条启动能力的费用（cost/plan-values.ts 的 xp + exhaust 支付）、effect.buff 与 effect.move 正文原语都已合入，golden 用真实费用计划与参考内核执行。" +
    "依赖：combat-result 的 EventPattern 词汇与战斗结果事件生产接线，以及契约补充 legend-zone。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-result",
        // 468.3.a/468.3.b：「you win a combat」——你获得 attacker 或 defender
        // designation 且是结算时唯一还剩单位的玩家；EventPattern.player 的
        // "self" 即能力控制者/赢家。
        filter: { event: "combat-result", player: "self" }
      },
      optional: false,
      body: [
        {
          // 728 / 730.1 / 733：「gain 1 XP」——获得者缺省为能力控制者（190.6.d）。
          id: "voidreaver.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    },
    {
      kind: "activated",
      // 404.1.a：印刷的「Spend 1 XP, :rb_exhaust:」是费用；没有 [Reaction]，
      // 默认 Action 时机（376 / 338.1.a.1）。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          { kind: "xp", amount: { kind: "constant", value: 1 } },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [buffUnit]
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          { kind: "xp", amount: { kind: "constant", value: 2 } },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [moveUnit]
    }
  ],
  sourceText:
    "When you win a combat, gain 1 XP.\n" +
    "Spend 1 XP, :rb_exhaust:: [Buff] a unit.\n" +
    "Spend 2 XP, :rb_exhaust:: Move an exhausted friendly unit from a battlefield to its base."
} satisfies CardProgram;

export default voidreaver;
