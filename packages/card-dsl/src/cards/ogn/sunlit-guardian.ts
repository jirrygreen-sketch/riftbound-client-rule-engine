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
 * of ObjectSnapshot.combatRole. The canonical derived-might service can derive
 * defenders, but does not bind that role into the EffectIR keyword condition.
 * Tank still lacks the combat assignment-priority consumer. Keep both printed
 * keyword declarations and fail closed until their full semantics are wired.
 */
export default {
  canonicalCardId: "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Shield（814.1.b.3/814.1.c/814.1.d.1）的 KeywordDef 条件仍读取 designation，需与 ObjectSnapshot.combatRole 及真实战斗生命周期对接；" +
    "combat/derived-might.ts 已能从 canonical 战斗推导 defender，但没有向本卡 EffectIR 静态条件提供该特征。" +
    "Tank（815.1.b/815.1.c.2）的 continuous.combat damage-assignment/priority first 尚缺战斗分配消费方；" +
    "combat/base-combat-allocation.ts 只接受已证明无关键词优先级的基本分配。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
