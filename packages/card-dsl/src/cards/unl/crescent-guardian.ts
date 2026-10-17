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
 * Status: judge-required. Re-checked 2026-10-17 (RIFT-677) against merged source:
 * condition.history really counts committed play actions by card type (golden
 * verified), the replacement binder drives the entry-orientation rewrite
 * for the host's own Board entry, and the condition.result predicate added with
 * the condition-predicate batch reads a finalized optional-cost receipt. Still
 * missing: (1) the static cost.additional declaration has no production
 * consumer — programs/play.ts never inspects static abilities and the static
 * binder's layerFor refuses the kind — so Finalize never charges the 1 Chaos
 * Power or returns the paid/declined receipt; (2) because no receipt reaches the
 * replacement, its authored gate cannot distinguish paid from declined, and
 * replacement/bind.ts matches the entry action before evaluating the condition;
 * (3) the printed "If you've played a spell this turn" applicability is a
 * history query, and no static-cost condition reads history.
 * RIFT-677 corrected the payment spelling to the merged cost vocabulary:
 * cost/plan-values.ts reads a Power payment's domain list from `allowedDomains`
 * and blocks any other field ("Unsupported payment field: domain"), so the
 * printed 1 Chaos Power is declared as allowedDomains: ["Chaos"], matching the
 * merged frostcoat-cub / akshan-mischievous / blast-corps-cadet declarations.
 */
const abilities: Ability[] = [
  {
    kind: "static",
    // 356.2.b.1：Optional Additional Cost = "may" + "as an additional cost"；
    // 204.2 的附加费用在 356.2 加费阶段结算。印刷的 power: null 不是 0，这份
    // 1 点 Chaos Power 是独立的附加费用组件。
    effect: {
      kind: "cost.additional",
      id: "crescent-guardian.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      // 163.2 / 204.2：1 点 Chaos Power；cost/plan-values.ts 只读 allowedDomains，
      // 写 domain 会被 blocked("Unsupported payment field: domain")，因此按合并词汇声明。
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Chaos"] }]
    },
    // 356.2.b.1：该可选费用的适用条件是“你本回合打过法术”。按卡类型区分的历史
    // 查询已由 condition.history 支持，但没有读取 condition.history 的静态费用
    // 条件，因此这里声明具名的历史结果依赖；未接线时缺读数必须阻塞，不能用非空字符串冒充 true。
    condition: {
      kind: "result",
      result: "crescent-guardian.spell-history",
      key: "count",
      operator: "gte",
      right: { kind: "constant", value: 1 }
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
    // 356.4.f.1 的“If you do”应以支付决定为准。condition.result 已能读费用回执，
    // 当前仍缺 static cost.additional → 回执 → replacement 的传递。
    // 使用现有 result 谓词精确引用这笔费用，缺回执时不得把字符串占位当成 true。
    condition: {
      kind: "result",
      result: "cost.additional",
      id: "crescent-guardian.additional-cost"
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
    "仍缺三段接线（2026-10-17 复核，均不近似实现）：" +
    "(1) 静态 cost.additional → Finalize optionalAdditional 与支付回执（CR 356.2.b/356.2.b.1）：programs/play.ts 只翻译 play 能力的 cost，" +
    "不会读取 static 能力；programs/statics.ts 的 layerFor 也拒绝 cost.additional（\"Static ability kind cost.additional has no layer mapping\"），" +
    "因此 1 点 Chaos Power 追加费不会被收取，也没有回执产生；" +
    "(2) 入场重写的开闸（CR 356.4.f.1/359.2.c/369.3/805.6.a）：replacement/bind.ts 的 entry 路径在匹配入场动作时先返回、" +
    "不评估 ability.condition（实测 never 条件仍把横置入场改成就绪），所以即使将来有回执，本卡的门控也不会被消费；" +
    "(3) 适用条件“If you've played a spell this turn”：condition.history 已能按 action=play 与 objectFilter.type=spell 统计，" +
    "但没有把该历史查询接到静态费用适用条件的消费者；卡内用 result 声明 crescent-guardian.spell-history.count 读数依赖，缺少历史结果生产方与静态费用消费者。" +
    "已修：支付门控改用 condition.result，明确引用 crescent-guardian.additional-cost，缺回执不再按非空字符串判真。" +
    "已修（RIFT-677）：附加费用组件原写作 domain: \"Chaos\"，而 cost/plan-values.ts 的 readCost 只认 allowedDomains 并对其余字段 blocked（\"Unsupported payment field: domain\"），" +
    "现按合并词汇写作 allowedDomains: [\"Chaos\"]（同 sfd/frostcoat-cub、sfd/akshan-mischievous、sfd/blast-corps-cadet）。" +
    "执行证据：test/cards/templates/static-replacement-effect-ready-677.test.mjs；整卡费用与条件边界保持阻塞。" +
    "已合入并可执行：replacement 的入场朝向重写本体（effect.ready）与 condition.result 的费用回执谓词。",
  abilities,
  sourceText:
    "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
    "If you do, I enter ready."
} satisfies CardProgram;
