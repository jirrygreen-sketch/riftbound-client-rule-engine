import type { CardProgram } from "../../ir/index.js";

/**
 * Official effect-order evidence for Core Rules v1.5 (Radiance). The Radiance
 * and Spiritforged errata sources contain no Rumble-specific ruling; both
 * abilities therefore follow the cited general rules. The production goldens
 * in rumble-hotheaded.test.mjs exercise these timelines.
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
      url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
      involvesThisCard: false
    },
    spiritforgedErrata: {
      published: "2026-01-14",
      effective: null,
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
      involvesThisCard: false
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
      ruleRefs: ["475", "478", "479.3", "801.3.a", "807.1.c", "807.1.d", "807.1.d.1"],
      timeline: [
        "Continuous layer evaluation discovers the on-Board Rumble static ability.",
        "The controller-relative Mech filter grants Assault 1 only to a friendly Mech.",
        "Assault contributes +1 Might only while that Mech holds the attacker designation; a defender, non-Mech, or enemy Mech gains no contribution."
      ],
      priorityFocus: "Continuous effect; it creates no Chain item and neither consumes nor transfers Priority or Focus.",
      responseWindow: "No response window is created by a continuously applied static effect.",
      productionAssertion: "Rumble, Hotheaded production golden: attacker-only Assault Might for the controller's Mechs"
    },
    {
      id: "conquer-leading-recycle-play",
      canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
      clauses: [
        "When I conquer, you may recycle another friendly unit to play a Mech from your trash.",
        "Reduce its Energy cost by the Might of the unit you recycled."
      ],
      ruleRefs: [
        "131.2", "131.3", "204.1.c", "204.3.a", "303.2.a", "312.1", "313.2", "329", "334", "337.1.a", "338",
        "355.10.c.1", "356.1.c", "356.4.c", "356.4.g", "357.1", "359.3.e.13", "383.3.a", "383.3.b.1", "404.1.b.1", "417.1.c"
      ],
      timeline: [
        "Conquer establishes control and emits the real ownership/source payload for Rumble.",
        "Rumble's Triggered Ability becomes Pending; its leading may and recycle cost are decided during Finalize.",
        "Finalize selects the Trash Mech target and another friendly Board unit as a non-target cost choice, then atomically pays the recycle to its owner's Main Deck bottom.",
        "The payment receipt preserves the recycled unit's pre-move Might. After A then B pass the Closed-State Priority window, Resolve can reduce only the target's Energy component; its printed Power must remain payable.",
        "Current production gap: an explicit Energy-only descriptor discards the Trash Mech's printed Power, and the trusted play planner cannot acquire the complete displaced target's printing cost through this card body. The full card therefore remains judge-required."
      ],
      priorityFocus: "Focus belongs to the preceding Showdown. Finalize does not pass Priority; A then B receive Closed-State Priority in turn order, and both passes precede Resolve.",
      responseWindow: "After Finalize, the Closed-State window permits legally timed Reactions before Resolve. The production golden verifies the A-to-B Priority order and subsequent Resolve without inventing a Reaction card.",
      productionAssertions: [
        "Rumble, Hotheaded production component: Finalize recycles, the receipt preserves pre-move Might, and Resolve plays an Energy-only Mech",
        "Rumble, Hotheaded Power boundary: a real Breakneck Mech loses its 2 Mind Power requirement and the whole card remains judge-required"
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
 * Judge-required after the 2026-10-22 production recheck. The real TurnFlow
 * Conquer path selects and pays the recycle at Finalize (RIFT-929), binds that
 * payment receipt to the same Resolve body, preserves the recycled Unit's
 * pre-move Might for the discount (RIFT-953), and can play an Energy-only Mech
 * from Trash. The remaining gap is component completeness: the body builds an
 * explicit Energy-only descriptor because the target has left Trash, while
 * ObjectSnapshot.power is a Domain set rather than its printed Power count.
 * The trusted play planner therefore cannot reconstruct both the target's
 * complete printed Energy and Power after the recycle. This would undercharge
 * legal Power Mechs, contrary to CR 131.2, 131.3, 356.4.c, and 357.1.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡保持 judge-required（2026-10-22 生产复核）。Assault、Conquer Pending/Finalize、Board recycle、" +
    "支付前 Might 的 LKI 与 Energy 组件折扣均已通过真实 TurnFlow；剩余缺口是合法 Power Mech。" +
    "effects/interpreter/expr.ts:26-61 的 constant/object-property 只能重建 Energy；effects/instructions/cost.modify.ts:220-272 " +
    "原样传递该显式 CostSpec，无法在 recycle 已移出目标后捕获完整印刷费用；effects/play/cost-plan.ts:271-277,483-510 " +
    "只在目标仍可读取时从注册 CardProgram 取基础费，但对 Breakneck Mech 等目标没有权威 play-cost 元数据。" +
    "ObjectSnapshot.power（effects/contract.ts:44-60）是 Domain 集合，不是印刷 Power 数量；" +
    "cost/plan-values.ts:117-131 只能据它合成 1 Power，不能还原 2 Mind Power。" +
    "Breakneck Mech 的 8 Energy + 2 Mind Power 因此会被当作无 Power 费用（CR 131.2 / 131.3 / 356.4.c / 357.1）。" +
    "建议最小改法：production leading-cost Finalize 在 target 仍可读取时用 bindDuelPrintedCost（cost/printed-costs.ts:119）" +
    "冻结完整 trusted printed Energy/Power，将其作为 cost.modify 的 printed 输入，并只对 Energy 组件应用 Might 折扣；在此之前不标 executable。",
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
                        // through the leading payment receipt. RIFT-953 binds
                        // that receipt to this Resolve body before the payment
                        // instruction is removed.
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
