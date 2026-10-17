import type { CardProgram } from "../../ir/index.js";

/**
 * Blitzcrank, Impassive (ogn-067-298).
 * CR v1.5 815: Tank is declared, never expanded in a card file.
 * CR 355.4 / 383.4.a: the battlefield play trigger wraps the may instruction in choice.optional.
 * CR 383.4.d: self Hold is mandatory; return-to-hand routes to the owner.
 * The effect.zone objects operand is BLOCKED pending a non-target self selector;
 * its current schema only accepts target/pick. Do not invent a self target to bypass it.
 */
const program = {
  canonicalCardId: "card.hash-bee1f175cdca184a24a8807736a261b1b06bcc189438914248f9b1fba6eade3b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "缺 Tank 关键词展开及 continuous.combat 指派优先级（CR 815；RIFT-91）。effect.move 已合入，但其 Expr 参数 schema 与解释器先求值的约定不一致；自身返手还缺 effect.zone 的 ObjectSelector 入参，不能把 me 伪装成目标或 pick（CR 355.10.d）。依赖 RIFT-1/67/120 的选择器、参数和触发绑定接线；整卡不近似执行。",
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
                      kind: "object-property",
                      object: "source",
                      property: "location"
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
