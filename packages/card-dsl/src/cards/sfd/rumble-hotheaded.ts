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
 * Current status: judge-required. The production leading-choice adapter lifts
 * the recycle choice into Finalize and the real trigger pipeline selects the
 * correct non-target friendly Unit. Two production links remain blocked:
 * (1) cost/payment.ts:92-94 limits a `recycle` cost to an owned card in Trash
 * or a Rune in the Rune Zone, while CR 417 permits recycling this specified
 * Board Unit; (2) after the adapter removes the paid instruction from Resolve,
 * effects/interpreter.ts:207-210 still requires cost.modify's `linkedTo` to
 * name an earlier instruction in the current body, so the Finalize receipt is
 * not reachable and the trigger is removed as unperformable. The selected
 * Unit's pre-move Might/LKI must travel with that receipt so the same
 * Finalize transaction can build the discounted play cost. Moving recycle to
 * Resolve would be the wrong timing. The conquer payload and primitive
 * cost/play operations themselves are covered by production regressions.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，不近似实现（复核 2026-10-21）：「When I conquer, you may recycle another friendly unit to play a Mech from your trash. " +
    "Reduce its Energy cost by the Might of the unit you recycled」的开头是触发能力的可选指令内基础费用。" +
    "卡牌已按 204.1.c / 383.3.a / 383.3.b.1 / 404.1.b.1 写成 leading choice.optional + cost.pay；" +
    "recycle 依 355.10.c.1 是非目标费用选择。真实 TurnFlow Conquer 后，Finalize 正确提供并选择另一名友方单位，" +
    "但 cost/payment.ts:92-94 把 recycle 费用限制为 Trash 中的拥有者卡牌或 Rune Zone 中的 Rune，" +
    "因此 Board 上的该单位被 cannot-pay-cost 拒绝，触发以 unperformable-trigger 移除并原子回滚。" +
    "另外，adapter 已把费用指令从 Resolve body 移除，但 effects/interpreter.ts:207-210 仍要求 cost.modify 的 linkedTo " +
    "指向当前 body 的前序指令，实测抛 \"Unknown or forward instruction link: rumble.recycle-cost\"；" +
    "支付检查通过后，还必须在单位离开 Board 前保留其 Might/LKI，在同一 Finalize 计划中生成减费后的 effect.play cost。" +
    "conquer 的 object/source/it payload 已由 turn/flow.ts:159-163 " +
    "发出并被 pipeline-match.ts:95-96 消费；continuous.grant-keyword 与 Assault re-expander 已存在，独立 attacker Might 正例可执行。" +
    "剩余缺的是 Board recycle 费用支付、leading cost receipt 的 Resolve link 与非目标费用对象的 pre-move Might/LKI 绑定，而非 CostPlan 形状或 conquer payload。",
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
