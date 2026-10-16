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
  judgeReason: "缺 Backline 关键词展开及 continuous.combat 末位指派（CR 826；RIFT-91）。effect.damage 的动态 Might 子效果可执行，但其 amount schema 仍要求 Expr，与解释器预求值不兼容；战场限制及相对控制者/地点过滤接线依赖 RIFT-1/120，不能仅凭伤害子测试宣称整卡可执行。",
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
