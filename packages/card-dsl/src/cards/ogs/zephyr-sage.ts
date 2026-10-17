import type { CardProgram } from "../../ir/index.js";

/**
 * Zephyr Sage (ogs-005-024).
 * CR v1.5 814.1.b.3: omitted Shield value defaults to 1; 814.1.c/814.1.d.1:
 * the bonus applies only while maintaining the Defender designation.
 * The card declares only the keyword, with summed stacking per 814.2.
 * Shield expansion still reads designation, whereas combat snapshots expose
 * combatRole. No mapping supplies the condition, so keep judge-required and
 * retain production-static-binding evidence of the unresolved mismatch.
 */
const zephyrSage = {
  canonicalCardId:
    "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Shield 静态条件仍缺战斗字段适配：effects/keywords/Shield.ts 比较 object-property(self, designation) == defender，但生产 ObjectSnapshot 提供 combatRole。programs/statics.ts 的条件环境及解释器均未映射 combatRole → designation，防守单位无法获得 CR 814.1.c/814.1.d.1 的 +1 Might。依赖：Shield 关键词条件与生产战斗快照字段对齐（契约变更请求）。",
  abilities: [{ kind: "keyword", keyword: "shield" }],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default zephyrSage;
