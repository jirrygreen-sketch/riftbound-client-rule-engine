import type { CardProgram } from "../../ir/index.js";

/**
 * encore — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
export default {
  canonicalCardId: "card.hash-3812004b1ace905a5750f12683fd2ae066128769b8d39d3a460ea8a2bce04b99",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 355.3：programs/play.ts 的 validateSurface 与 chain/engine.ts 的 assertFinalizationSurface " +
    "都未绑定 choice.mode，缺 Finalize 模式计划及所选模式内目标生命周期；orderedPickSpecs 也未遍历模式体，" +
    "缺把模式内 zoneSlice 绑定到该计划。CR 355.2.a/187.1：Recruit 的 LocationSelector.choose.filter " +
    "已能经 condition.value 与 linked-value 传给 effect.token.location，但仍缺将该地点选择纳入模式的 Finalize。" +
    "查看模式的有序来源已迁移为 zoneSlice，独立模式可执行 inspect→draw→recycle（414.1.a/432.1.c），" +
    "damage 与临时 Might 亦可执行；这些局部证据不构成整卡模式绑定。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "encore.choose-two",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 2 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "encore.deal-two-mode",
                  body: [
                    {
                      id: "encore.deal-two",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 2 },
                        target: { kind: "constant", value: "encore.damaged-unit" }
                      },
                      targets: [
                        {
                          id: "encore.damaged-unit",
                          filter: { type: "unit" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "encore.recruit-tokens-mode",
                  body: [
                    {
                      id: "encore.choose-recruit-location",
                      op: "condition.value",
                      args: {
                        value: {
                          kind: "location",
                          value: {
                            kind: "choose",
                            id: "encore.recruit-location",
                            filter: { type: "any", controller: "controller" }
                          }
                        },
                        key: { kind: "constant", value: "location" }
                      }
                    },
                    {
                      // "Play two 1 Might Recruit unit tokens" — Recruit is CR
                      // 187.1. The selected LocationRef is consumed by the
                      // merged create-on-chain + play path.
                      id: "encore.recruit-tokens",
                      op: "effect.token",
                      linkedTo: "encore.choose-recruit-location",
                      args: {
                        token: { kind: "constant", value: "recruit" },
                        amount: { kind: "constant", value: 2 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "linked-value",
                          instructionId: "encore.choose-recruit-location",
                          key: "location"
                        },
                        linkKey: { kind: "constant", value: "encore.recruits" }
                      }
                    }
                  ]
                },
                {
                  id: "encore.grant-might-mode",
                  body: [
                    {
                      // "Give up to two units each +1 Might this turn" —
                      // arithmetic-layer temporary Might (contract 3.4/3.6),
                      // registered by the merged continuous.might instruction.
                      // The objects descriptor stays symbolic so the
                      // Finalize-locked TargetSpec is read at resolution
                      // (355.13 allows choosing zero units).
                      id: "encore.grant-might",
                      op: "continuous.might",
                      args: {
                        amount: { kind: "constant", value: 1 },
                        duration: { kind: "constant", value: "end-of-turn" },
                        objects: {
                          kind: "constant",
                          value: { kind: "target", id: "encore.buffed-units" }
                        }
                      },
                      targets: [
                        {
                          id: "encore.buffed-units",
                          filter: { type: "unit" },
                          min: 0,
                          max: 2,
                          selection: "up-to"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "encore.look-and-recycle-mode",
                  body: [
                    {
                      id: "encore.look-controller",
                      op: "condition.value",
                      args: {
                        value: { kind: "object-property", object: "source", property: "controller" },
                        key: { kind: "constant", value: "controller" }
                      }
                    },
                    {
                      // CR 432.1.c: capture the ordered source through the
                      // chain's zoneSlice binding, including short decks.
                      id: "encore.look-top-two",
                      op: "effect.inspect",
                      linkedTo: "encore.look-controller",
                      args: {
                        player: { kind: "linked-value", instructionId: "encore.look-controller", key: "controller" },
                        zone: { kind: "constant", value: "deck" },
                        scope: { kind: "constant", value: "top" },
                        amount: { kind: "constant", value: 2 },
                        picksSpecId: { kind: "constant", value: "encore.top-two" },
                        choiceId: { kind: "constant", value: "encore.look-top-two" }
                      },
                      picks: [
                        {
                          id: "encore.top-two",
                          options: [],
                          ordered: true,
                          selection: "all",
                          zoneSlice: {
                            zone: "deck",
                            from: "top",
                            count: { kind: "constant", value: 2 }
                          }
                        }
                      ]
                    },
                    {
                      id: "encore.draw-one",
                      op: "effect.draw",
                      args: { amount: { kind: "constant", value: 1 } },
                      // CR 414.1.a: draw the top card, with no selection.
                      // CR 432.1.c.1: an empty looked-at set cannot cause Burn Out.
                      condition: {
                        kind: "compare",
                        left: { kind: "linked-value", instructionId: "encore.look-top-two", key: "inspected" },
                        operator: "gte",
                        right: { kind: "constant", value: 1 }
                      }
                    },
                    {
                      // The drawn card has left the deck and its old identity
                      // is stale (CR 124). Recycling the live inspected set
                      // therefore affects only the other card (417.1).
                      id: "encore.recycle-other",
                      op: "effect.recycle",
                      linkedTo: "encore.look-top-two",
                      args: {
                        objects: {
                          kind: "linked-value",
                          instructionId: "encore.look-top-two",
                          key: "inspected-picked"
                        }
                      },
                      condition: {
                        kind: "compare",
                        left: { kind: "linked-value", instructionId: "encore.look-top-two", key: "inspected" },
                        operator: "gte",
                        right: { kind: "constant", value: 2 }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose two —\n" +
    "Deal 2 to a unit.Play two 1 :rb_might: Recruit unit tokens." +
    "Give up to two units each +1 :rb_might: this turn." +
    "Look at the top 2 cards of your Main Deck, draw 1 and recycle the other."
} satisfies CardProgram;
