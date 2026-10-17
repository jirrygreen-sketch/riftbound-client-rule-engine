import type { CardProgram } from "../../ir/index.js";

/**
 * Caitlyn, Patrolling (ogn-068-298).
 * CR v1.5 826: the unbracketed combat-last sentence is Backline.
 * CR 381.1: an activated ability without a speed permission uses normal action timing.
 * CR 415.4-415.5: exhaustion is a cost, never an effect in the body.
 * CR 355.10.b / 418: the unit is targeted; its battlefield is a location restriction.
 * Damage reads source Might at resolution, and can target either player's unit.
 */
const program = {
  canonicalCardId: "card.hash-46870901290d1c4082f78830943ec1e847b51ec8c511a04a60ad3c97410429df",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Backline 展开后的 continuous.combat 末位战斗伤害分配消费方（CR 826）；当前原语只记录持续战斗效果，" +
    "战斗流程没有读取它来约束分配。activated restriction 的 at-battlefield 形态也没有绑定适配器，" +
    "程序绑定只接受 Condition 代数。effect.damage 的动态 Might、exhaust 费用和 battlefield 目标本身已有执行证据，" +
    "但上述两个整卡缺口仍不能把卡标为 executable。",
  abilities: [
    {
      kind: "keyword",
      keyword: "backline"
    },
    {
      kind: "activated",
      cost: {
        payments: [
          {
            kind: "exhaust",
            object: "self"
          }
        ]
      },
      timing: "action",
      restriction: {
        kind: "at-battlefield",
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "objects",
            filter: {
              object: "self",
              zone: "battlefield"
            }
          },
          operator: "gte",
          right: {
            kind: "constant",
            value: 1
          }
        }
      },
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
              value: "battlefield-unit"
            }
          },
          targets: [
            {
              id: "battlefield-unit",
              filter: {
                type: "unit",
                zone: "battlefield"
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
  sourceText: "I must be assigned combat damage last.\n:rb_exhaust:: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield."
} satisfies CardProgram;

export default program;
