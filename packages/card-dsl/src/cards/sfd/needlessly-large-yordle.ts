import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Needlessly Large Yordle (sfd-055-221) — Unit, Calm, Yordle/Bandle City.
 * energy 10, power 3 (Calm), Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-055-221，逐字）:
 *   "[Shield 5] (+5 :rb_might: while I'm a defender.)\n"
 *   "[Tank] (I must be assigned combat damage first.)\n"
 *   "I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn."
 *
 * 规则依据（CR v1.5）:
 * - [Shield 5]（814.1.b/814.1.c）：被动能力关键词，X=5 是印刷数值；功能上等价于
 *   「我作为防守者时 +5 [M]」，由 effects/keywords/Shield.ts 展开为 arithmetic 层的
 *   static continuous.might，条件依赖 Defender designation（814.1.d/814.1.d.1）。卡只声明
 *   keyword 与数值（契约 3.7、README 第 5 节）。
 * - [Tank]（815）：被动能力关键词，815.1.b 功能上等价于「在我被分配致命伤害之前，
 *   同一控制者下没有 [Tank] 的其他单位都不能被分配伤害」；815.1.c.1/.c.2 规定多条 Tank 的
 *   分配顺序，815.3 说明它是单位特征。
 * - "I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn"：
 *   356.1（Apply base cost modifications）与 356.4（Apply discounts）的减费；
 *   "you scored from holding this turn" 指本回合通过 471.2 的 Hold 获得的分数，471/472
 *   限定每个 battlefield 每回合只能 Score 一次，473.2.b 是该次 Scoring 的 Hold 触发口径。
 *   因此减费量是本回合 Hold 得分次数（点数）的函数：每 1 点减 2 Energy 与 1 Calm Power。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（实测复核 2026-10-17）。
 * - [Shield 5] 的展开已合入（effects/keywords/Shield.ts），但其 static continuous.might 的
 *   条件读 "designation"：对象快照只有 combatRole（effects/contract.ts），
 *   默认求值器对 designation 报 Unavailable characteristic，layers/engine.ts 的
 *   conditionMatches 也不求值 compare 条件（effects/interpreter/expr-ext 的
 *   designation 求值器尚未接入默认 dispatch/图层），因此该 +5 Might 恒不生效
 *   （实测 combatRole 为 defender 时
 *   Might 仍保持印刷值 4）。
 * - [Tank] 的 KeywordDef 已合入，programs/statics.ts 也能把它登记进 ability 图层，
 *   但 continuous.combat 没有图层分支（layers/ops/index.ts 记为 persisted-only），
 *   combat/base-combat-allocation.ts 只接受 keywordPriority: "proven-none"，
 *   815.1.c.1/.c.2 因此无法执行。
 * - 减费需要两件未合入的支撑：(1) 把卡牌 static 减费效果接进 Finalize 费用计划的消费者
 *   （programs/statics.ts 的 layerFor 对 continuous.cost-modification 抛
 *   ProgramBindingError；cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts
 *   时应用折扣，接不到卡声明）；(2) 「本回合 Hold 得分的点数」这一历史计数：
 *   冻结的 Expr 词汇只按对象集合求值，layers/engine.ts 的 valueOf 无 count 分支
 *   （constant/object-property/object-ref/add-subtract-multiply 之外一律原样返回），
 *   而 HistoryQuery 只经 condition.history 指令使用，静态费用效果引用不到它。
 * 不近似实现（不把 Tank 写成数值修正，不把减费写成固定 2 点，也不把「每点」近似为常数）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "shield", value: 5 },
  { kind: "keyword", keyword: "tank" },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      // "I cost [2][Calm] less for each point you scored from holding this turn"：
      // 每 1 点 Hold 得分减 2 Energy 与 1 Calm Power（356.1 / 356.4）。
      reductions: [
        { resource: "energy", amount: -2, per: "point-scored-from-holding-this-turn" },
        { resource: "power", domain: "Calm", amount: -1, per: "point-scored-from-holding-this-turn" }
      ]
    }
  }
];

const program = {
  canonicalCardId: "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "实测（2026-10-17）三处当前缺口：(1)[Shield 5] 的展开（effects/keywords/Shield.ts 的 static continuous.might，814.1.c）已合入，" +
    "但条件读 \"designation\"（814.1.d/814.1.d.1），对象快照只有 combatRole，" +
    "且 layers/engine.ts 的 conditionMatches 不求值 compare，绑定后 Might 恒不增加。" +
    "(2)[Tank] 的 KeywordDef 已合入且 static 绑定能登记 continuous.combat，" +
    "但该 kind 没有图层分支（layers/ops/index.ts 记为 persisted-only），" +
    "combat/base-combat-allocation.ts 只接受 keywordPriority: \"proven-none\"，" +
    "815.1.c.1/.c.2 无法执行。" +
    "(3)「I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn」需要：" +
    "把卡牌 static 减费效果接进 Finalize 费用计划的消费者（programs/statics.ts 的 layerFor 对 " +
    "continuous.cost-modification 抛 ProgramBindingError；cost/cost-plan.ts 只在调用方显式传入 " +
    "CostPlanInput.discounts 时应用折扣）；以及「本回合 Hold 得分的点数」这一历史计数——" +
    "冻结的 Expr 词汇只按对象集合求值，layers/engine.ts 的 valueOf 无 count 分支，" +
    "读不到本回合 score/hold 的事件次数（HistoryQuery 只经 condition.history 指令使用，静态费用效果引用不到）。" +
    "不近似实现。",
  abilities,
  sourceText:
    "[Shield 5] (+5 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn."
} satisfies CardProgram;

export default program;
