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
 * 1. 可选附加费用仍没有收取与回执路径：cost/cost-plan.ts 只消费调用方传入的
 *    optionalAdditional，没有代码把卡牌程序声明的费用接进费用计划；cost.additional / cost.pay
 *    原语和 XP/Power 费用计划已合入，但 CardProgram → Finalize 的接线仍缺（RIFT-349 后续）。
 *    "If you do" 需要 356.4.f.1 的支付决定回执，冻结 IR 没有费用结果绑定（调研记为
 *    condition.result）；RIFT-260 的 replacement/bind.ts 只在 apply 时用 testCondition 求值，
 *    本卡 condition 的 constant 字符串永远为真，无法承担这个闸门。
 * 2. "I enter ready" 的入场替代形状已可绑定（RIFT-260 的 replacement.enter / 静态自指
 *    effect.ready 会绑定成 entry declaration，同 Accelerate 的写法），但费用未付时无法抑制
 *    它：绑定面没有费用回执可供判断（同上一点），因此“先横置再就绪”“无条件就绪”这两条
 *    近似都违反 359.2.c / 369.3 / 805.6.a；effect.ready 原语文件头也明确它不参与入场替代。
 * 3. 适用条件「you've played a spell this turn」需要按卡类型区分本回合打出的法术：
 *    解释器的 history 只统计已提交的 GameAction（且 card-played 是 Finalize 结果，不是
 *    GameAction），没有按卡类型区分的求值路径。
 * 本卡没有已合入的指令原语，因此没有执行类 golden 用例；golden 只做校验、身份与结构断言。
 *
 * 契约变更请求：无。若要完成本卡，需要为可选附加费用的支付决定增加卡牌可见的
 * 回执/结果绑定形状（调研中的 condition.result），使 356.4.f.1 的 "If you do" 可以在 IR 里求值。
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
    "三处缺口：(1) 可选附加费用（356.2.b/356.2.b.1；204.2）仍没有收取与回执路径：cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，" +
    "没有代码把卡牌程序声明的费用接进费用计划；cost.additional / cost.pay 原语和费用计划已合入，但 CardProgram → Finalize 的接线仍缺（RIFT-349 后续）；" +
    "356.4.f.1 的「If you do」以“玩家决定支付”为凭证（与实际数额无关），冻结 IR 没有费用结果绑定（调研记为 condition.result）。" +
    "(2)「I enter ready」的入场替代形状已能绑定（replacement.enter / 静态自指 effect.ready 会绑定成 entry declaration，同 Accelerate），" +
    "但 replacement/bind.ts 只在 apply 时用 testCondition 求值，本卡 condition 的 constant 字符串恒为真，费用未付时无法抑制就绪入场，" +
    "因此不能用“先横置再就绪”或“无条件就绪”近似（359.2.c、369.3；805.6.a 明确不是先横置再就绪，也不触发成为就绪类能力）。" +
    "(3) 适用条件「you've played a spell this turn」需要按卡类型区分本回合打出法术的历史计数，已合入的 history 求值只覆盖效果动作范围，尚无该维度。" +
    "依赖：RIFT-349 后续（可选附加费用与支付回执接线）以及按卡类型的 played-spell 历史谓词。不近似实现。",
  abilities,
  sourceText:
    "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
    "If you do, I enter ready."
} satisfies CardProgram;
