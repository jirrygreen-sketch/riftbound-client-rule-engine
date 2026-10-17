import type { CardProgram } from "../../ir/index.js";

/**
 * Fiora, Victorious — CR v1.5 708/710, 809, 810 and 814.
 * Static program binding and object-property comparisons are merged.
 * Conditional granted keywords still need their live behavior expansion:
 * Deflect into target costs, Ganking into movement permissions, and Shield
 * into defender Might, refreshed as effective Might changes.
 */
const fioraVictorious = {
  canonicalCardId: "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺条件性关键词授予后的实时行为消费：continuous.grant-keyword 的图层关键词尚未展开为 Ganking 的移动许可与 Shield 的 defender Might 效果（CR 810.1.b/144.4.c.1、814.1.c）；Deflect 的 target.tax 尚未从关键词展开接入对手目标选择的 Finalize 附加费用（CR 809.1.c）。Shield KeywordDef 还读取 designation，而 ObjectSnapshot 的战斗指定字段为 combatRole；条件授予也须随有效 Might 动态重验（CR 708/710）。",
  sourceText:
    "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield]. (I'm Mighty while I have 5+ :rb_might:.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        appliesTo: "self",
        keywords: [
          // 809.1.b.3 / 814.1.b.3：未写数值时按 1 处理；Ganking 不带数值（810）。
          { id: "Deflect", value: 1 },
          { id: "Ganking" },
          { id: "Shield", value: 1 }
        ]
      },
      // 708/710：Mighty = 场上有效 Might >= 5。
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "might" },
        operator: "gte",
        right: { kind: "constant", value: 5 }
      }
    }
  ]
} satisfies CardProgram;

export default fioraVictorious;
