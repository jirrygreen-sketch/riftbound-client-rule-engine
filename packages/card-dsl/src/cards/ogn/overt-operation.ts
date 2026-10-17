import type { CardProgram } from "../../ir/index.js";

/**
 * Overt Operation (ogn-153-298) — Spell, 5 energy + 2 Body power.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   For each friendly unit, you may spend its buff to ready it. Then buff all
 *   friendly units. (Each one that doesn't have a buff gets a +1 :rb_might:
 *   buff.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "For each friendly unit, you may spend its buff to ready it" is a
 *   per-object optional iteration: each friendly unit gets its own decision
 *   (the "any number" pattern of 355.13), the buff spend is 702.2.b and legal
 *   only for units the spender controls (702.2.b.1 / 702.2.b.2), and "ready
 *   it" is 416.1. The merged repeat control repeats one body and by default
 *   re-asks for targets each iteration (the same unit may be chosen twice
 *   instead of each unit being visited once) and has no per-object iteration
 *   binding; the chain layer additionally blocks nested targets until the
 *   interpreter target-selection lifecycle adapter exists (chain/README.md,
 *   contract change request 2). The intended shape is recorded below and must
 *   not be treated as executable semantics.
 * - "Then buff all friendly units" is a programmatic, non-target set
 *   (355.10.d / 355.10.d.1: no player ever chooses the members). The merged
 *   effect.buff only reads a Finalize-locked TargetSpec id; declaring one for
 *   "all friendly units" would wrongly make each of them a target (355.7,
 *   754). effect.ready and effect.heal already accept the
 *   { kind: "query", filter } descriptor for such sets; effect.buff does not.
 *   The reminder text's +1 Might per buff is 703 (Buff), i.e. counter
 *   bookkeeping owned by the layers/object model; nothing here is approximated
 *   with direct Might math.
 * - The printed cost is 5 Energy + 2 Body Power and is represented as a printed
 *   cost; complete cast/payment binding remains in the cost and CardProgram
 *   pipelines.
 */
const overtOperation = {
  canonicalCardId: "card.hash-2a0e259ebeb4ceb04dc1f72b99b0174e76881f50e0d426f34c74b36057fffb88",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条依赖未合入：(1)「For each friendly unit, you may spend its buff to ready it.」需要逐对象绑定、每个友方单位各一次" +
    "的可选迭代（702.2.b 消耗 + 416.1 重置）；已合入的 repeat 只重复同一 body 且默认每轮重新选目标（同一单位可被重复选中，" +
    "没有 per-object 绑定），链层还会对嵌套目标抛 ChainContractBlockedError，等待解释器目标生命周期适配器" +
    "（chain/README.md 契约变更请求 2）。(2)「Then buff all friendly units.」是按特征程序化的非目标集合" +
    "（355.10.d/355.10.d.1），effect.buff 只读 Finalize 锁定的 TargetSpec，没有 effect.ready / effect.heal 的 " +
    "{kind:'query'} 形态；写成 TargetSpec 会错误触发成为目标（355.7、754）。printed cost 与 Action 关键词的 " +
    "程序绑定已可记录；提醒文字的 +1 Might 是 703 的 Buff 计数，不写成临时 Might 修正。依赖：解释器目标生命周期、" +
    "effect.buff 的非目标集合形态。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "overt-operation.per-unit-choice",
          op: "repeat",
          args: {
            count: {
              kind: "count",
              subject: "unit",
              filter: { type: "unit", controller: "controller", zone: "board" }
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "overt-operation.may-spend-and-ready",
                  op: "choice.optional",
                  args: {
                    prompt: {
                      kind: "constant",
                      value: "Spend this unit's buff to ready it?"
                    },
                    body: {
                      kind: "constant",
                      value: [
                        {
                          id: "overt-operation.spend-buff",
                          op: "effect.buff",
                          args: {
                            mode: { kind: "constant", value: "spend" },
                            target: {
                              kind: "constant",
                              value: "overt-operation.friendly-unit"
                            }
                          },
                          targets: [
                            {
                              id: "overt-operation.friendly-unit",
                              filter: { type: "unit", controller: "controller", zone: "board" },
                              min: 1,
                              max: 1,
                              selection: "one"
                            }
                          ]
                        },
                        {
                          id: "overt-operation.ready-unit",
                          op: "effect.ready",
                          args: {
                            objects: {
                              kind: "constant",
                              value: { kind: "target", id: "overt-operation.friendly-unit" }
                            },
                            amount: { kind: "constant", value: 1 }
                          },
                          // "spend its buff to ready it": the ready belongs to a
                          // successful spend (702.2.b), which effect.buff
                          // reports through "spentCount" (427.1.c per-unit
                          // results). A plain linkedTo would still attempt the
                          // ready after a negated spend.
                          condition: {
                            kind: "compare",
                            left: {
                              kind: "linked-value",
                              instructionId: "overt-operation.spend-buff",
                              key: "spentCount"
                            },
                            operator: "gte",
                            right: { kind: "constant", value: 1 }
                          },
                          targets: [
                            {
                              id: "overt-operation.friendly-unit",
                              filter: { type: "unit", controller: "controller", zone: "board" },
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
            }
          }
        },
        {
          id: "overt-operation.buff-all",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            // Non-target programmatic set (355.10.d), described with the same
            // descriptor shape the merged effect.ready / effect.heal use for
            // query selections.
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", controller: "controller", zone: "board" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "For each friendly unit, you may spend its buff to ready it. Then buff all friendly units. " +
    "(Each one that doesn't have a buff gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default overtOperation;

