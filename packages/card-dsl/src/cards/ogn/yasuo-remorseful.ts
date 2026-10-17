import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Remorseful (ogn-076-298).
 * CR v1.5 383.4.e.1-383.4.e.2.a: first attacker designation per combat.
 * CR 418 / 740.1.b: damage uses the source's current Might and targets one enemy here.
 * No printed-Might constant, manual damage action, or single-card resolver is used.
 * The dynamic amount and once-per-combat trigger are consumed by the merged
 * interpreter and program trigger binding; the remaining location/attack
 * producer gaps stay judge-required below.
 */
const program = {
  canonicalCardId: "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.damage 的动态来源 Might、attack-declared 订阅与 once: per-combat 绑定均已有合入执行路径；" +
    "整卡仍不可执行：TargetSpec 的 sameLocationAs: source 位置锚点尚不能通过 programs/filters.ts 的生产绑定，" +
    "且当前 combat flow 没有把单位首次取得攻击身份的 CR 383.4.e 事件接入该卡的真实触发链。" +
    "依赖：RIFT-357（运行时位置锚点/选择绑定）与 attack-declared 生产方。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          object: "self"
        },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "deal-might",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: "source",
              property: "might"
            },
            target: {
              kind: "constant",
              value: "enemy-here"
            }
          },
          targets: [
            {
              id: "enemy-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "source"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;

export default program;
