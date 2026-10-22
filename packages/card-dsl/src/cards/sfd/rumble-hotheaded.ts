import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Hotheaded (sfd-026-221) — Rumble SFD precon unit (chosen champion).
 *
 * Your Mechs each have [Assault]. (+1 [M] while we're attackers.)
 * When I conquer, you may recycle another friendly unit to play a Mech from
 * your trash. Reduce its Energy cost by the Might of the unit you recycled.
 *
 * The permanent grant is a real ability-layer keyword grant (CR v1.5 807).
 * The conquer event is the source Unit's own event (383.4.c / 383.4.c.2.a).
 * The leading "you may recycle ... to play ..." is a triggered-ability base
 * cost within instructions, so it is represented by one leading
 * choice.optional whose first instruction is cost.pay (204.1.c, 383.3.a/b.1,
 * and 404.1.b.1). The recycle is a non-target cost choice, not a target
 * (355.10.c.1). Its selected unit's current Might feeds the discounted play
 * cost.
 *
 * Current status: judge-required after the 2026-10-22 production recheck.
 * RIFT-929 now permits the specified friendly Board Unit as a recycle cost;
 * the real TurnFlow Conquer path selects it at Finalize, recycles it to its
 * owner's Main Deck bottom, and supplies the play target. The remaining gap is
 * the Finalize-receipt bridge into Resolve. trigger-adapters/leading-choice.ts
 * removes the paid cost.pay instruction and its direct `linkedTo` gate, but
 * does not preserve that payment receipt under the removed instruction id.
 * Its dependency check misses the nested `object-property -> { linked }`
 * selector, so cost.modify reaches Resolve and its discount expression cannot
 * resolve `rumble.recycle-cost` through interpreter.ts. The Chain does pass
 * the plan/receipt as opaque `options.cost`, but its receipt-aware predicate
 * can only answer boolean `condition.result` checks. No ObjectSelector or
 * value Expr binds the matching receipt choice. A receipt is also only a list
 * of ObjectRefs (cost/plan-types.ts); it does not carry the chosen Unit's
 * pre-payment Might snapshot. The interpreter would therefore need an explicit
 * bridge that freezes that value before the recycle and exposes it to the
 * same Resolve body. Moving the recycle to Resolve would violate 383.3.b.1.
 *
 * Production currently proves the Conquer/Finalize half: the recycle is paid,
 * the source-like cost choice emits no became-target event, and the play target
 * does. Resolve then reports cost.modify as mistargeted and effect.play as
 * linked-ignored, leaving the chosen Mech in Trash. The card stays blocked
 * rather than treating that partial resolution as success.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡保持 judge-required（2026-10-22 生产复核）。RIFT-929 已闭合 Board recycle：cost/payment.ts:125-129 接受当前控制的友方 Board 对象，" +
    "真实 TurnFlow Conquer 的 Finalize 请求依次选择 Mech 目标与另一名友方单位，随后把该单位送到其拥有者主牌库底；" +
    "费用选择不成为 target，Mech 目标则真实发出 became-target（355.10.c.1）。" +
    "剩余缺口是 Finalize 收据进入 Resolve 的桥：programs/trigger-adapters/leading-choice.ts:29-44 只识别 linked/linked-value Expr，" +
    "漏掉 cost.modify 深层 object-property.object.linked，并在 :41-44 删除支付门禁后没有把被移除 cost.pay 的 receipt 以 " +
    "rumble.recycle-cost 暴露给当前 body；chain/engine.ts:1243-1249 虽把 plan/receipt 作为 options.cost 传入，" +
    "effects/interpreter/predicates/result.ts:5-8 的 condition.result 只能做布尔判断，没有把 choices[] 中的对象或 Might " +
    "绑定成 ObjectSelector / 数值 Expr 的路径，effects/interpreter.ts:173-180 的 linked 求值路径也不读取该 receipt。" +
    "实测生产注册 body 在 Resolve 得到 cost.modify=mistargeted、effect.play=linked-ignored，Mech 留在 Trash。" +
    "即使补上收据映射，cost/plan-types.ts:59-66 的 CostChoiceReceipt 只含 ObjectRef，不含支付前 Might；" +
    "对象已回主牌库后，effects/interpreter/selectors.ts:77-80 只有在 canLookBack 时读 lastKnown，而费用支付不经解释器 perform 登记该 look-back。" +
    "因此最小闭合需在 leading-cost Finalize 适配中按原 cost.pay instruction id 暴露 receipt，并在 recycle 离场前冻结/绑定所选单位的 Might，" +
    "供同一 body 的 cost.modify 与 effect.play 使用（CR 204.1.c / 204.3.a / 355.10.c.1 / 356.4.g / 383.3.a / 383.3.b.1 / 404.1.b.1 / 417.1.c）。" +
    "不把 recycle 延后到 Resolve，也不用手工 fixture 状态或 0 能源近似。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Assault",
        value: { kind: "constant", value: 1 },
        filter: {
          zone: "board",
          controller: "controller",
          tag: "Mech",
          type: "unit"
        }
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.a: this Unit's own Conquer Ability. objectId:self is the
        // engine-valid symbol the production trigger translator binds to the
        // exact source incarnation; the real Score wave carries object/source/it.
        filter: { event: "conquered", object: { objectId: "self" } }
      },
      // The decision belongs to Finalize (383.3.a), represented by the leading
      // choice.optional below rather than a scan-time optional registration.
      optional: false,
      body: [
        {
          id: "rumble.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Recycle another friendly unit to play a Mech from your trash?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "rumble.recycle-cost",
                  // 383.3.b.1: the first cost within instructions is the base
                  // cost and must be paid while finalizing the trigger.
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: [
                        {
                          kind: "recycle",
                          // 355.10.c.1: the recycled unit is a non-target cost
                          // choice. "another" is a relation to this source.
                          choice: {
                            id: "rumble.fodder",
                            options: [],
                            filter: {
                              zone: "board",
                              controller: "controller",
                              type: "unit",
                              relation: { relation: "other", object: "self" }
                            },
                            min: 1,
                            max: 1,
                            selection: "one"
                          }
                        }
                      ]
                    }
                  }
                },
                {
                  id: "rumble.mech-cost",
                  op: "cost.modify",
                  linkedTo: "rumble.recycle-cost",
                  args: {
                    id: { kind: "constant", value: "rumble.mech-cost" },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "explicit",
                        energy: {
                          kind: "object-property",
                          object: { target: "rumble.mech-in-trash" },
                          property: "energy"
                        }
                      }
                    },
                    modifier: {
                      kind: "constant",
                      value: {
                        kind: "reduce",
                        resource: "energy",
                        // This reads the selected recycle-cost object's LKI
                        // through the leading payment receipt. The current
                        // interpreter cannot resolve the removed linkedTo yet.
                        amount: {
                          kind: "object-property",
                          object: { linked: "rumble.recycle-cost" },
                          property: "might"
                        }
                      }
                    }
                  }
                },
                {
                  id: "rumble.play-mech",
                  op: "effect.play",
                  linkedTo: "rumble.mech-cost",
                  args: {
                    target: { kind: "constant", value: "rumble.mech-in-trash" },
                    cost: {
                      kind: "linked-value",
                      instructionId: "rumble.mech-cost",
                      key: "cost"
                    }
                  },
                  targets: [
                    {
                      id: "rumble.mech-in-trash",
                      filter: {
                        zone: "trash",
                        owner: "controller",
                        tag: "Mech",
                        type: "unit"
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
    }
  ],
  sourceText:
    "Your Mechs each have [Assault]. (+1 :rb_might: while we're attackers.)\n" +
    "When I conquer, you may recycle another friendly unit to play a Mech from your trash. " +
    "Reduce its Energy cost by the Might of the unit you recycled."
} satisfies CardProgram;
