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
    "都拒绝 choice.mode，静态打出仍缺 Finalize 模式计划及所选模式内目标生命周期（解释器可执行模式不等于生产绑定可执行）。" +
    "CR 355.2.a/187.1：RIFT-357 已合入；现有 LocationSelector.choose.filter 以 type:any + controller:controller " +
    "动态枚举控制者基地与其控制的战场，condition.value 在结算时锁定一个 LocationRef，linked-value 再由 effect.token.location 消费，" +
    "两种目的地均已用真实 Recruit 打出执行测试覆盖。CR 355.10/432.1.c：查看牌库顶两张需要有序动态 picks（RIFT-358 进行中），" +
    "effect.inspect 缺该上游来源时会明确阻断；draw 1 与 recycle the other 的绑定随 RIFT-358 落地后还需收尾。" +
    "effect.damage 与 continuous.might 均已可执行。",
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
                      // "Look at the top 2 cards of your Main Deck" — the
                      // ordered top selection is the open part (see judgeReason).
                      id: "encore.look-top-two",
                      op: "effect.inspect",
                      args: {
                        player: { kind: "constant", value: "controller" },
                        zone: {
                          kind: "constant",
                          value: { owner: "controller", zone: "deck" }
                        },
                        scope: { kind: "constant", value: "top" },
                        amount: { kind: "constant", value: 2 },
                        picksSpecId: { kind: "constant", value: "encore.top-two" },
                        choiceId: { kind: "constant", value: "encore.look-top-two" }
                      },
                      picks: [
                        {
                          id: "encore.top-two",
                          options: ["dynamic:top-2-of-main-deck"],
                          min: 2,
                          max: 2,
                          selection: "all"
                        }
                      ]
                    },
                    {
                      id: "encore.draw-one",
                      op: "effect.draw",
                      args: { amount: { kind: "constant", value: 1 } }
                    },
                    {
                      // "and recycle the other" — the complement of the drawn
                      // card; effect.recycle has no complement selection, so the
                      // linked inspected set cannot name "the other" (see
                      // judgeReason). The objects list stays as an auditable
                      // shape, never as an approximation of the complement.
                      id: "encore.recycle-other",
                      op: "effect.recycle",
                      linkedTo: "encore.look-top-two",
                      args: {
                        objects: {
                          kind: "linked-value",
                          instructionId: "encore.look-top-two",
                          key: "inspected-picked"
                        }
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
