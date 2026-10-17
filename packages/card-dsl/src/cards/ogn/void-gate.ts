import type { CardProgram } from "../../ir/index.js";

/**
 * Void Gate — CR v1.5 053.3, 418.4, 713–715, especially 715.4.a.
 * effect.damage consumes Bonus Damage, but a static grant over Deal actions
 * still needs a producer, action scope, and value-based here matching. Static
 * lifecycle registration itself is merged; the remaining gaps are the
 * Deal-action consumer, the action-target binding, and LocationRef matching.
 */
export default {
  canonicalCardId: "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 418.4/713、714、715.2、715.4/715.4.a 的 Bonus Damage 授予仍缺 Deal 动作的生产计算入口：effect.damage 只消费显式 bonus 参数，尚无 continuous.bonus-damage 的图层/动作消费者汇总本战场授予并注入每次 Deal。" +
    "当前 programs/statics.ts 的 staticTarget 也会拒绝 appliesTo:deal-actions，因而该 static 能力尚不能注册；即使补上动作绑定，layers/filter.matchesObjectFilter 对结构化 LocationRef 仍未按 Battlefield id 或 Base player 做值比较，053.3 的 here 作用域会在快照复制位置对象后失配。已有的 bonus 原语、静态声明与全额防止测试只证明已合入的消费/声明部分，不证明战场授予端。",
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
