import type { CardProgram } from "../../ir/index.js";

/**
 * Laurent Duelist (sfd-156-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-156-221):
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)
 *
 * [Assault 2] 按契约 3.1 表示为带数值的 keyword 能力（807：攻击时 +2 [M]）。
 * 关键词展开（continuous.might 静态效果 + “我是攻击者”条件）由
 * effects/keywords/assault.ts 负责，该文件尚未实现，故保持 judge-required。
 */
const laurentDuelist = {
  canonicalCardId: "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Assault keyword expansion (keywords/assault.ts) is not implemented yet: it needs the " +
    "continuous.might static effect with an 'I am an attacker' predicate (condition.predicate), " +
    "which the engine layers system does not yet provide.",
  abilities: [{ kind: "keyword", keyword: "assault", value: 2 }],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default laurentDuelist;
