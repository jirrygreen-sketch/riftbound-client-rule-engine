import type { CardProgram } from "../../ir/index.js";

/**
 * Fiora, Victorious — CR v1.5 708/710, 809, 810 and 814.
 * Static binding and the conditional keyword grant are executable as a layer
 * registration. The granted characteristics still lack their live behavior
 * consumers, and the production threshold recheck remains a failing path.
 */
const fioraVictorious = {
  canonicalCardId: "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺动态授予关键词的生产消费：continuous.grant-keyword 目前只把 Deflect/Ganking/Shield 写入图层关键词特征，" +
    "当前分支没有把授予后的关键词重新展开并接到对应消费者；Ganking 的 Standard Move 许可、Shield 的 defender Might 都因此不可达。" +
    "Shield KeywordDef 仍读取 designation；expr-ext/evaluate.ts 虽能映射 combatRole，生产 static binder 未接入该扩展（CR 810.1.b/144.4.c.1、814.1.c）。" +
    "Deflect 的 target.tax 也未从该授予路径接入 Finalize：programs/statics.ts 没有 target.tax 的 layer/Finalize 绑定，" +
    "Chain Finalize 仍不会生成税额要求的任意域 Power 计划（CR 809.1.c/809.1.c.1）。" +
    "实际 continuous.might 链结算中的静态阈值回测仍失败：createEngineStaticBinder 绑定的条件在 4→5 时不授予、" +
    "5→4 时不撤销三关键词，尚缺 CR 478.3/478.4 要求的当前有效 Might 重验。",
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
