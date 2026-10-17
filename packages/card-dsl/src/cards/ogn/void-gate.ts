import type { CardProgram } from "../../ir/index.js";

/**
 * Void Gate — CR v1.5 053.3, 418.4, 713–715, especially 715.4.a.
 * effect.damage consumes Bonus Damage, but a static grant over Deal actions
 * still needs a producer, action scope, and value-based here matching. Static
 * lifecycle registration itself is merged and is no longer a missing dependency.
 */
export default {
  canonicalCardId: "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 418.4/713、714、715.2、715.4/715.4.a 的 Bonus Damage 授予仍缺 Deal 动作的生产计算入口：effect.damage 已消费 bonus 参数，但尚无消费者汇总本战场的 continuous.bonus-damage 并注入每次 Deal。" +
    "programs/statics.staticTarget 不接受 appliesTo:deal-actions；还需按动作是否影响此处单位确定作用域，且 layers/filter 的结构化 LocationRef 仍需值比较（053.3）。已有的 bonus 原语与全额防止测试只证明消费端，不证明战场授予端。",
  sourceText:
    "Spells and abilities affecting units here each deal 1 Bonus Damage. " +
    "(Each instance of damage the spell deals is increased by 1.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.bonus-damage",
        layer: "ability",
        amount: { kind: "constant", value: 1 },
        appliesTo: "deal-actions",
        // 053.3 + 715.1/715.2: the grant applies per Deal action whose targets
        // are units at this Battlefield; sameLocationAs carries that referent.
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
