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
  judgeReason: "[Tank] 的 KeywordDef 与 continuous.combat 声明已合入，但战斗伤害分配没有消费方，815.1.b/815.1.c 的指派优先级仍不可执行。card-played 触发的 self/relative filter 不能由当前触发绑定器解析；effect.move 的 object-property 参数还要求运行时 ObjectRef，嵌套 optional body 也没有完整目标生命周期适配。Hold 的 effect.zone 只接受 target 或 pick，无法表达非目标 self 返回 owner hand（CR 355.10.d、383.4.d）。依赖：Tank 战斗消费者、触发/参数绑定与 effect.zone 的 self selector；整卡不近似执行。",
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
