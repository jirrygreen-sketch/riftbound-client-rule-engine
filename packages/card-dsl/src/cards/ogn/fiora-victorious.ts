import type { CardProgram } from "../../ir/index.js";

/**
 * Fiora, Victorious — CR v1.5 708/710, 809, 810 and 814.
 * Static program binding and object-property comparisons are merged, but the
 * bound condition does not recheck the effective-Might threshold correctly.
 * Conditional granted keywords also need their live behavior expansion:
 * Deflect into target costs, Ganking into movement permissions, and Shield
 * into defender Might.
 */
const fioraVictorious = {
  canonicalCardId: "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺图层授予关键词后的行为消费：Ganking 未转为 Standard Move 许可、Shield 未转为 defender Might，Shield KeywordDef 还读取 designation 而 ObjectSnapshot 使用 combatRole（CR 810.1.b/144.4.c.1、814.1.c）。Deflect 的 target.tax 未从授予关键词接入 Finalize，现有 Chain tax 汇总还使用 Energy 而非所需任意域 Power（CR 809.1.c/809.1.c.1）。createEngineStaticBinder 的条件回调未使用图层当前正在求值的对象快照：经 Chain continuous.might 改变有效 Might 后，4→5 仍不授予、5→4 仍不撤销三关键词，尚缺实际静态绑定路径的阈值重验（CR 478.3/478.4）。",
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
