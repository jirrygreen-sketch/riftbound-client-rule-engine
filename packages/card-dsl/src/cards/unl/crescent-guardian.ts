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
 * Status: judge-required. Current source audit:
 * condition.history already supports committed play actions with a spell
 * objectFilter. Static cost applicability still has no history-expression
 * adapter or optional-payment receipt. Entry-ready is a replacement, never
 * an exhausted entry followed by a ready action.
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
    // 查询已由 condition.history 支持，但静态费用条件还没有历史表达式接线。
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
    "缺 programs/play.ts 将静态 cost.additional 接入 Finalize optionalAdditional 和支付决定回执（CR 356.2.b/356.4.f.1），以及把 condition.history 的 play/objectFilter.type=spell 查询接到静态费用适用条件的消费者。condition.history 已能按卡类型查询真实 play 动作，但静态 Condition 仍不能直接读取该历史。replacement.enter 的入场重写（359.2.c/369.3/805.6.a）还需以支付回执开闸；当前 constant 字符串恒真，不能区分支付与拒绝。",
  abilities,
  sourceText:
    "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
    "If you do, I enter ready."
} satisfies CardProgram;
