import type { CardProgram } from "../../ir/index.js";

/** CR v1.5 206/206.1、383.3.a/b、416。两个事件各自订阅；横置属于 Finalize 费用，不写进结算 body。 */
const curatorOfTheSands = {
  canonicalCardId: "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两条语义：(1) 206/206.1 的 Energy cost >= 7 需要读取事件所指 unit/gear 的印刷费用或 activated ability 的 base cost；触发条件未绑定事件对象/能力费用读取，energyCostAtLeast 仅为描述（RIFT-359）。(2) 383.3.b/383.3.b.1 要求把 exhaust me 作为触发能力的基础费用在 Finalize 支付，但 TriggeredAbility 没有 cost 字段、programs/triggers 不生成该费用计划。不能把横置费用当作结算期效果。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: {
            types: [
              "unit",
              "gear"
            ],
            player: "self",
            energyCostAtLeast: 7
          }
        }
      },
      optional: true,
      body: [
        {
          id: "curator-of-the-sands.ready-runes",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "target",
                id: "curator-of-the-sands.runes"
              }
            },
            amount: {
              kind: "constant",
              value: 2
            }
          },
          // 355.13：合法选择零个时不执行该动作，避免把空集合当失效目标。
          condition: {
            kind: "compare",
            left: { kind: "count", subject: "objects", filter: { object: { target: "curator-of-the-sands.runes" } } },
            operator: "gt", right: { kind: "constant", value: 0 }
          },
          targets: [
            {
              id: "curator-of-the-sands.runes",
              filter: {
                type: "rune",
                zone: "rune-zone"
              },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "ability-activated",
        filter: {
          event: "ability-activated",
          filter: {
            player: "self",
            energyCostAtLeast: 7
          }
        }
      },
      optional: true,
      body: [
        {
          id: "curator-of-the-sands.activation-ready-runes",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "target",
                id: "curator-of-the-sands.runes"
              }
            },
            amount: {
              kind: "constant",
              value: 2
            }
          },
          // 355.13：合法选择零个时不执行该动作，避免把空集合当失效目标。
          condition: {
            kind: "compare",
            left: { kind: "count", subject: "objects", filter: { object: { target: "curator-of-the-sands.runes" } } },
            operator: "gt", right: { kind: "constant", value: 0 }
          },
          targets: [
            {
              id: "curator-of-the-sands.runes",
              filter: {
                type: "rune",
                zone: "rune-zone"
              },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play a unit, gear, or activated ability with Energy cost :rb_energy_7: or more, " +
    "you may exhaust me to ready up to 2 runes."
} satisfies CardProgram;

export default curatorOfTheSands;
