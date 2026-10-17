import type { CardProgram } from "../../ir/index.js";

/**
 * Karthus, Eternal (ogn-236-298), CR v1.5 808.1-808.2 / 383.4.g.2.
 * "Trigger an additional time" changes trigger collection, not body repetition.
 * programs/ already binds statics and keyword triggers, but no registration or
 * layer query applies continuous.trigger-multiplicity during EventPipeline.scan.
 * Deathknell's shared expansion also retains a trigger.leave body placeholder
 * rather than binding the card's printed Deathknell effect to the collected hit.
 */
const karthusEternal = {
  canonicalCardId: "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺触发收集倍率：continuous.trigger-multiplicity 尚无图层映射/规则查询，EventPipeline.scan 不读取 additional 次数；" +
    "CR 808.1/808.2、383.4.g.2 的额外 Deathknell 触发不能用结算期 repeat 替代。" +
    "Deathknell 展开仍需把卡牌效果正文接到死亡触发，当前 body 的 trigger.leave 只是未实现的占位。",
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
