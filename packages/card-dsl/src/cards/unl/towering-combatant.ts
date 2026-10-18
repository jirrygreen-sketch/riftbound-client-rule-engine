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
 * - both KeywordDefs are registered (Shield, Tank) and the CardProgram -> layers
 *   registration path is merged: programs/statics.ts createEngineStaticBinder +
 *   programs/lifecycle.ts, with keyword expansion through programs/keywords.ts
 *   expandProgram. The golden registers both expansions through the production
 *   binder on one real board unit.
 * - the designation fact itself is merged: ObjectSnapshot carries combatRole
 *   (contract 3.8) and effects/interpreter/expr-ext/evaluate.ts maps both the
 *   object-designation expression and the "designation" property spelling onto
 *   it. The earlier "designation is not part of the snapshot" wording is stale.
 *
 * Still missing (each pinned by a real execution in the golden, not approximated):
 * - [Shield 2] (814.1.c / 814.1.d / 814.1.d.1) expands to a static
 *   continuous.might ability gated on the Defender designation. The gate is
 *   authored as compare(object-property self "designation" eq "defender"), but
 *   the merged default dispatch does not use the expr-ext evaluator:
 *   effects/interpreter/condition.ts evaluateCondition calls the base
 *   evaluateExpression, programs/statics.ts wraps the condition and swallows
 *   MissingInformation as false, and layers/engine.ts never calls
 *   resolveLayerEffectExpressions (expr-ext README "Integration boundary" steps
 *   1-3). The golden registers the expansion through the production binder on a
 *   unit whose combatRole really is "defender": the condition evaluates to false
 *   and the Might stays at the printed 3, so 814.1.c grants no +2.
 * - [Tank] (815.1.b / 815.1.c.1 / 815.1.c.2) expands to a static
 *   continuous.combat damage-assignment requirement. The production binder does
 *   register it in the ability layer (the golden asserts the registered layer and
 *   the mode/priority/damage payload), but nothing consumes it:
 *   combat/base-combat-allocation.ts requires an
 *   assignmentModifier: "proven-none" proof and no merged query returns the
 *   requirement (the golden shows 0 restrictions and 0 requirements for the
 *   damage action), so the printed assignment order is not enforced.
 * Neither keyword is rewritten as static numbers or instructions.
 */
export default {
  canonicalCardId: "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5，2026-10-17 实测）：(1) [Shield 2]（814.1.c/814.1.d.1）展开为以 " +
    "compare(object-property self \"designation\" eq \"defender\") 为门控的 static continuous.might；卡牌 → layers 的注册路径与 " +
    "designation 事实本身都已合入（programs/statics.ts 的 createEngineStaticBinder/attachProgramLifecycle、programs/keywords.ts 展开，" +
    "ObjectSnapshot.combatRole 由 effects/interpreter/expr-ext/evaluate.ts 读到），但默认求值链没接 expr-ext：" +
    "effects/interpreter/condition.ts 的 evaluateCondition 只走 evaluateExpression，programs/statics.ts 把条件包成 try/catch 并吞掉 " +
    "MissingInformation 变成 false，layers/engine.ts 也从不调用 resolveLayerEffectExpressions（expr-ext README 的 Integration boundary 1-3）。" +
    "golden 实测：一个真实 combatRole=\"defender\" 的单位经生产 binder 注册后条件求值为 false、Might 仍为印刷的 3，814.1.c 的 +2 不生效。" +
    "(2) [Tank]（815.1.b/815.1.c.1/815.1.c.2）展开为 static continuous.combat 的伤害分配优先要求；生产 binder 确实把它注册进 ability 图层" +
    "（golden 断言注册的 layer 与 mode/priority/damage 载荷），但没有消费方：combat/base-combat-allocation.ts 要求 " +
    "assignmentModifier: \"proven-none\" 证明、不读取该注册，layers/rules/query.ts 的 restrictions/requirements 对 damage 动作都返回空" +
    "（golden 实测都是 0），815.1.b/815.1.c.2 的指派顺序不生效。" +
    "依赖：默认条件/图层分派接入 expr-ext（condition.ts/statics.ts/layers/engine.ts），以及 continuous.combat 的战斗伤害分配消费方。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield", value: 2 },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
