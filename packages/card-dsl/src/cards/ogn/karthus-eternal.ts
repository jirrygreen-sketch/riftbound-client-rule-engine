import type { CardProgram } from "../../ir/index.js";

/**
 * Karthus, Eternal (ogn-236-298), CR v1.5 808.1/808.2/808.3 / 383.4.g.2.
 * 当前复核：缺 Deathknell 触发收集倍率和按关键词/控制者识别实例的查询，
 * continuous.trigger-multiplicity 尚无图层/收集消费方；结算期 repeat 不等价。
 */
const karthusEternal = {
  canonicalCardId: "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Deathknell 触发收集倍率：continuous.trigger-multiplicity 没有图层映射或规则查询，" +
    "EventPipeline.scan 不读取 additional 次数；须在收集期生成额外的独立触发项（808.1/808.2、383.4.g.2），" +
    "不能用结算期 effect.repeat 替代。staticTarget 也拒绝按 deathknell 关键词、控制者与区域筛选的 appliesTo，" +
    "尚不能按当前关键词特征识别受影响实例（808.3）。Deathknell 展开体的 trigger.leave 未注册，" +
    "卡牌正文尚未接到死亡触发。",
  sourceText: "Your [Deathknell] effects trigger an additional time.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.trigger-multiplicity",
        mode: "additional",
        amount: { kind: "constant", value: 1 },
        appliesTo: {
          keyword: "deathknell",
          controller: "controller",
          zone: "board"
        }
      }
    }
  ]
} satisfies CardProgram;

export default karthusEternal;
