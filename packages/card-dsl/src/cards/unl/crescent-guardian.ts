import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Crescent Guardian (unl-122-219) — Unit，能量 4，力量未印刷（power: null），Might 4，
 * 领域 Chaos，标签 Mount Targon。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-122-219，逐字）:
 *   "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
 *   "If you do, I enter ready."
 *
 * 规则依据（CR v1.5）:
 * - "If you've played a spell this turn" 是这条被动能力的适用条件（356.2.b.1：被打卡牌或
 *   其他卡牌的 Passive Ability 指定可选附加费用），本回合是否打过法术用事件历史计数
 *   （condition.predicate/history 的 cards-played-this-turn 家族）；"spell" 是 355.9 语境里
 *   的卡类型（主牌组的 Spell）。
 * - "you may pay [C] as an additional cost to play me"：356.2.b / 356.2.b.1 的
 *   Optional Additional Cost（"may" + "as an additional cost"）；204.2 的 Additional Cost
 *   在 356.2 加费阶段结算，费用是 1 点 Chaos Power。印刷的 power: null 表示没有印刷费
 *   （不是 0），这份 Power 是独立的附加费用组件。
 * - "If you do, I enter ready"：356.4.f.1 明确“可选附加费用只要玩家做了支付决定即视为
 *   已支付（与实际支付数额无关）”，所以闸门是支付决定/回执，不是资源变动；结果是把
 *   359.2.c 的“横置进场”替换成“就绪进场”。805.6.a（Accelerate 的同型规则）明确这种
 *   入场替代不是先横置再就绪、也不触发“成为就绪”类能力。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处缺口，均不近似实现：
 * 1. 可选附加费用的收取与回执没有已合入路径：cost/cost-plan.ts 只消费调用方传入的
 *    optionalAdditional，没有代码把卡牌程序声明的费用接进费用计划；effects/instructions/
 *    下也没有 cost.additional / cost.pay 文件（RIFT-89 batch3-cost-plan，同 ogn/clockwork-keeper、
 *    ogn/brazen-buccaneer）。"If you do" 需要 356.4.f.1 的支付决定回执，冻结 IR 没有
 *    费用结果绑定（调研记为 condition.result），条件性的入场替代无法判定。
 * 2. "I enter ready" 是入场替代（359.2.c / 369.3；805.6.a 明确不是先横置再就绪），需要
 *    replacement.enter 的接线与执行：契约 3.1 的 replacement 能力到事件管线替代注册
 *    还没有适配路径（同 sfd/dunebreaker、ogn/confront），effect.ready 原语的文件头也明确它
 *    不参与入场替代，不能拿来近似。
 * 3. "你本回合打过法术" 的历史计数只覆盖效果动作（解释器的 history 范围按
 *    GameAction/timingPoint/player/object 过滤），而“打出法术”是 card-played 时点上的
 *    Finalize 结果，需要按卡类型区分（本回合打出的法术数量）；该维度尚无已合入的求值路径。
 * 本卡没有已合入的指令原语，因此没有执行类 golden 用例；golden 只做校验、身份与结构断言。
 *
 * 契约变更请求：请为可选附加费用的支付决定增加卡牌可见的回执/结果绑定形状
 * （调研中的 condition.result），使 356.4.f.1 的 "If you do" 可以在 IR 里求值。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    // 356.2.b.1：Optional Additional Cost = "may" + "as an additional cost"；
    // 204.2 的附加费用在 356.2 加费阶段结算。印刷的 power: null 不是 0，这份
    // 1 点 Chaos Power 是独立的附加费用组件。
    effect: {
      kind: "cost.additional",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, domain: "Chaos" }]
    },
    // 356.2.b.1：该可选费用的适用条件是“你本回合打过法术”；按卡类型区分的历史
    // 计数尚无求值路径（见 judgeReason 第 3 点）。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "you-played-a-spell-this-turn" }
    }
  },
  {
    kind: "replacement",
    // 359.2.c 的横置进场被就绪进场替换（369.3 / 805.6.a）；闸门是上面的支付决定
    //（356.4.f.1 的回执），不是资源变动。
    replaces: {
      event: "object-enters-board",
      filter: { self: true, exhausted: true }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "crescent-guardian.additional-cost-was-paid" }
    },
    with: [
      {
        id: "crescent-guardian.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-62fb90bb0e876e500de763bb4ffad29e29022a5cbd31d536a7adf6619570bca6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 可选附加费用（356.2.b/356.2.b.1；204.2）没有收取与回执路径：cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，" +
    "没有代码把卡牌程序声明的费用接进费用计划，effects/instructions/ 下也没有 cost.additional / cost.pay 文件（RIFT-89；同 ogn/clockwork-keeper、ogn/brazen-buccaneer）；" +
    "356.4.f.1 的「If you do」以“玩家决定支付”为凭证（与实际数额无关），冻结 IR 没有费用结果绑定（调研记为 condition.result），条件性的入场替代无法判定。" +
    "(2)「I enter ready」是入场替代（359.2.c、369.3；805.6.a 明确不是先横置再就绪，也不触发成为就绪类能力），" +
    "需要 replacement.enter 的接线与执行，而契约 3.1 的 replacement 能力到事件管线替代注册尚无适配路径（同 sfd/dunebreaker、ogn/confront）；" +
    "effect.ready 文件头明确不参与入场替代，不能用来近似。" +
    "(3) 适用条件「you've played a spell this turn」需要按卡类型区分本回合打出法术的历史计数，已合入的 history 求值只覆盖效果动作范围，尚无该维度。" +
    "依赖：RIFT-89（可选附加费用与回执）、引擎批 4 的入场替代管线。不近似实现。",
  abilities,
  sourceText:
    "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
    "If you do, I enter ready."
} satisfies CardProgram;
