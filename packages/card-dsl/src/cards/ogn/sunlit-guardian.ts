import type { CardProgram } from "../../ir/index.js";

/**
 * Sunlit Guardian (ogn-054-298) — Unit, 3 energy, Might 3, Calm, Shurima.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-054-298):
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * Both abilities are keyword declarations (contract 3.1 / 3.7): the card only
 * names shield and tank, and the reminder text is the printed explanation of
 * the keyword, not a separate instruction.
 *
 * Status: judge-required.
 * Shield/Tank expansion, static registration and compare-condition evaluation
 * are merged. Shield still reads the unsupported designation property instead
 * of ObjectSnapshot.combatRole; combat does not publish the defender role.
 * Tank still lacks the combat assignment-priority consumer. Keep both printed
 * keyword declarations and fail closed until their full semantics are wired.
 */
export default {
  canonicalCardId: "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield] 与 [Tank] 的 KeywordDef、CardProgram 关键词展开和静态注册均已合入，programs/statics.ts 会实际求值 " +
    "compare 条件。仍缺：(1) Shield（814.1.b.3/814.1.c/814.1.d.1）的展开读取 object-property designation，" +
    "而已合入的 ObjectSnapshot 字段是 combatRole；战斗流程尚未发布防守者角色，故无法实现仅作为 defender 时 +1 Might。(2) " +
    "Tank（815）展开并登记 continuous.combat 的 damage-assignment/priority first，但 " +
    "combat/base-combat-allocation.ts 未消费分配优先级，815.1.b/815.1.c.2 不可执行。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
