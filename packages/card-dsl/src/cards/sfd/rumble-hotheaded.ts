import type { CardProgram } from "../../ir/index.js";

/**
 * Official effect-order evidence target: Core Rules v1.5 (Radiance), effective
 * 2026-10-16. The official Radiance notes and Spiritforged errata contain no
 * Rumble-specific entry, so this card follows the general rules below. The
 * current production result is recorded explicitly; a blocked Resolve stage is
 * evidence for judge-required status, not a proposed ordering rule.
 */
export const RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE = {
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulingStatus: "no-card-specific-ruling",
  sources: {
    coreRules: {
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
      patchNotesUrl: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
      sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    },
    radianceRulings: {
      published: "2026-10-09",
      effective: "2026-10-16",
      url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/"
    },
    spiritforgedErrata: {
      published: "2026-01-14",
      // The article states no separate effective date. Core Rules v1.5 is the
      // target version and takes precedence over conflicting older material.
      effective: null,
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/"
    },
    spiritforgedRules: {
      published: "2025-12-05",
      effective: "2025-12-12",
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/"
    }
  },
  interactions: [
    {
      id: "assault-grant",
      canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
      clauses: ["Your Mechs each have [Assault].", "(+1 [M] while we're attackers.)"],
      ruleRefs: ["801.3.a", "807.1", "807.1.c", "807.1.d", "807.1.d.1", "807.2"],
      timeline: [
        "Rumble is on the Board and its static ability registers the Assault grant.",
        "A friendly Mech gains the Attacker designation and re-expansion applies +1 Effective Might.",
        "When it no longer has the Attacker designation, the Assault Might contribution stops."
      ],
      priorityFocus: "Passive continuous effect: it creates no Chain item and does not consume or transfer Priority or Focus.",
      responseWindow: "No discretionary action or response window is created by Assault itself; layer evaluation is deterministic.",
      productionAssertion: "Rumble, Hotheaded golden: lifecycle grants Assault and attacker Might only to friendly Mechs"
    },
    {
      id: "conquer-leading-recycle-play",
      canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
      clauses: [
        "When I conquer, you may recycle another friendly unit to play a Mech from your trash.",
        "Reduce its Energy cost by the Might of the unit you recycled."
      ],
      ruleRefs: [
        "143.2.a", "204.1.c", "204.3.a", "303.2.a", "309.1", "309.1.a",
        "312.1", "312.1.b.1", "313.2", "337.1.a", "338", "339", "340.1",
        "355.10.c.1", "356.4.g", "359.3.e.13", "383.3.a", "383.3.b",
        "383.3.b.1", "383.3.c", "404.1.b.1", "405", "406", "407", "417.1.c"
      ],
      timeline: [
        "The non-combat Showdown opens for the player who applied Contested; that player gains Focus and Priority.",
        "Both players pass Focus in turn order and the Showdown closes; control and Conquer are established.",
        "The Conquer event carries this exact Rumble incarnation; the controller mandatorily adds its triggered ability as a Pending item.",
        "Finalize asks controller A whether to perform the leading may (383.3.a); unlike a later may, this decision is made before the trigger is Finalized.",
        "While deciding the relevant choices, A selects the Trash Mech target and a non-target cost choice for another controlled Board Unit.",
        "Finalize locks and atomically pays recycle; the chosen Unit moves to its owner's Main Deck bottom.  The Unit's pre-move Effective Might must be frozen for the discount.",
        "Current production path: with the Chain present the turn is Closed, A then B receive Priority in turn order, and both passes precede Resolve; Focus remains held by the Showdown player and grants no independent right to act.",
        "Required rulings (closed window): before either pass, A and then B each receive the opportunity to take a legally timed Reaction. A successful Finalize guarantees the payment itself cannot be responded to; the response opportunity follows it.",
        "After both players pass in sequence, the trigger Resolves from top to bottom; it may play the Trash Mech using the finalized reduced cost.",
        "Current production boundary: Finalize succeeds, but Resolve reports cost.modify=mistargeted and effect.play=linked-ignored, so the Mech remains in Trash."
      ],
      priorityFocus: "A controls the trigger and receives its Finalize decision. Priority is exclusive and sequential after Finalize; Focus belongs only to the preceding Showdown and does not by itself permit discretionary actions.",
      responseWindow: "A legal Closed-State response window exists after the trigger is finalized and before Resolve. Only Reaction-speed cards or abilities are legal. The production trace verifies the required ordering A Priority, B Priority, then Resolve; it does not invent a particular Reaction card.",
      productionAssertions: [
        "Rumble, Hotheaded production golden: accepting Conquer Finalize recycles the Board unit and prompts for the Mech target",
        "Rumble, Hotheaded: the registered Resolve body cannot bind the chosen object or Might from the Finalize receipt"
      ]
    }
  ]
} as const;

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
