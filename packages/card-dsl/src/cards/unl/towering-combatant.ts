import type { CardProgram } from "../../ir/index.js";

/**
 * Towering Combatant (unl-099-219) — Unit, Body, Shurima; energy 4, Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-099-219, verbatim):
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * Both abilities are keyword declarations only (contract 3.1 / 3.7 and README
 * §5): the reminder text belongs to the printed keyword, it is not a second
 * instruction to author here.
 *
 * Status: judge-required (2026-10-17 re-check against the merged code). Merged
 * and exercised by the golden:
 * - both KeywordDefs are registered (Shield since RIFT-81, Tank since RIFT-264);
 * - the CardProgram -> layers registration path is merged (RIFT-349:
 *   programs/statics.ts createEngineStaticBinder + programs/lifecycle.ts, with
 *   keyword expansion through programs/keywords.ts expandProgram), so the earlier
 *   "no binder exists / statics.ts ships only a noop hook" claim is stale. The
 *   golden registers both expansions through the production binder on one real
 *   board unit.
 *
 * Still missing (each pinned by a real execution in the golden, not approximated):
 * - [Shield 2] (814.1.c / 814.1.d / 814.1.d.1) expands to a static
 *   continuous.might ability gated on the Defender designation. The gate reads
 *   object-property "designation"; the merged ObjectSnapshot exposes only
 *   combatRole (contract 3.8), so the interpreter raises MissingInformation, the
 *   binder wrapper catches it and the condition is always false. The golden
 *   registers the expansion and shows a genuinely defending unit (combatRole
 *   "defender") still evaluates at its printed Might 3: 814.1.c never grants the
 *   +2. The mismatch is produced by keywords/Shield.ts, outside this card scope.
 * - [Tank] (815.1.b / 815.1.c.1 / 815.1.c.2) expands to a static
 *   continuous.combat damage-assignment requirement. The production binder does
 *   register it in the ability layer (the golden asserts the registered layer and
 *   the mode/priority/damage payload), but nothing consumes it:
 *   combat/base-combat-allocation.ts binds no assignment-priority requirement and
 *   no merged query returns it (the golden shows 0 restrictions and 0
 *   requirements for the damage action), so the printed assignment order is not
 *   enforced.
 * Neither keyword is rewritten as static numbers or instructions.
 */
export default {
  canonicalCardId: "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) [Shield 2]（814.1.c/814.1.d.1）展开为以 compare(object-property self \"designation\" eq " +
    "\"defender\") 为门控的 static continuous.might；卡牌 → layers 的注册路径（RIFT-349 的 createEngineStaticBinder/attachProgramLifecycle，经 " +
    "programs/keywords.ts 展开）已合入，旧「statics.ts 只有 noop binder」的结论过时，但判别式读的是快照里不存在的 designation：" +
    "合并的 ObjectSnapshot 只有契约 3.8 的 combatRole，解释器求值抛 MissingInformation、binder 包装后恒为 false，" +
    "golden 实测一个真实 combatRole=\"defender\" 的单位仍按印刷 Might 3 求值，814.1.c 的 +2 永不生效（判别式在 keywords/Shield.ts，属本卡范围外）。" +
    "(2) [Tank]（815.1.b/815.1.c.1/815.1.c.2）展开为 static continuous.combat 的伤害分配优先要求；生产 binder 确实把它注册进 ability 图层" +
    "（golden 断言注册的 layer 与 mode/priority/damage 载荷），但没有消费方：combat/base-combat-allocation.ts 明确未绑定 " +
    "assignment-priority，也没有任何合并查询返回该要求（golden 实测 damage 动作的 restrictions 与 requirements 都是 0），" +
    "815.1.b/815.1.c.2 的指派顺序不生效。依赖：keywords/Shield.ts 的 designation/combatRole 判别式修正与 designation 产生方（RIFT-359 条件谓词工作），" +
    "以及 continuous.combat 的战斗伤害分配消费方（RIFT-258 交接/战斗工作流）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield", value: 2 },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
