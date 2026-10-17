import type { CardProgram } from "../../ir/index.js";

/**
 * Blitzcrank, Impassive (ogn-067-298).
 * CR v1.5 815: Tank is declared as a keyword and expanded by engine-core.
 * CR 355.4 / 383.4.a: the battlefield play trigger wraps the may instruction in choice.optional.
 * CR 383.4.d: self Hold is mandatory; return-to-hand routes to the owner.
 * The effect.zone objects operand is BLOCKED pending a non-target self selector;
 * its current schema only accepts target/pick. Do not invent a self target to bypass it.
 */
const program = {
  canonicalCardId: "card.hash-bee1f175cdca184a24a8807736a261b1b06bcc189438914248f9b1fba6eade3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "缺 Tank 的 continuous.combat 致死优先指派消费者（CR 815.1.b/c）。card-played/hold 的 object:'self' 触发过滤仍无符号适配，打出触发还需保留 battlefield 条件；effect.move 所处的 choice.optional 嵌套目标仍缺 Finalize/Resolve 生命周期适配。Hold 的 effect.zone 只接受 target 或 pick，无法非目标地返回 self 至 owner hand（355.10.d、383.4.d）；turn/flow 的 player/battlefieldId Hold 事件仍缺绑定到该战场在场单位的触发过滤。整卡不近似执行。",
  abilities: [
    {
      kind: "keyword",
      keyword: "tank"
    },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          object: "self",
          zone: "battlefield"
        }
      },
      optional: false,
      body: [
        {
          id: "may-move",
          op: "choice.optional",
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "move-enemy",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: {
                        target: "enemy-unit"
                      }
                    },
                    to: {
                      kind: "location",
                      value: "source-location"
                    },
                    amount: {
                      kind: "constant",
                      value: 1
                    }
                  },
                  targets: [
                    {
                      id: "enemy-unit",
                      filter: {
                        type: "unit",
                        zone: "board",
                        controller: "opponent"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: {
          object: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "return-self",
          op: "effect.zone",
          args: {
            objects: {
              kind: "constant",
              value: "self"
            },
            to: {
              kind: "constant",
              value: "hand"
            }
          }
        }
      ]
    }
  ],
  sourceText: "[Tank] (I must be assigned combat damage first.)\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand."
} satisfies CardProgram;

export default program;
