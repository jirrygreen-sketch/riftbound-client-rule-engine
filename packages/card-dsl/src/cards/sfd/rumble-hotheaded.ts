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
        "The payment receipt preserves the recycled unit's pre-move Might. The Play descriptor declares base: printed so Finalize can use the target's complete trusted printed Energy and Power; after A then B pass the Closed-State Priority window, Resolve reduces only the Energy component and Power remains payable. A production golden with Breakneck's complete printed metadata pays 5 Energy and 2 Mind Power.",
        "RIFT-985 resolves the selected target's canonicalCardId through an explicit ProgramBinding printedCatalog after Finalize targets lock and before the recycle leaves Board. The card IR therefore carries no fixed target projection, but the default server currently omits that catalog lookup and still fails closed."
      ],
      priorityFocus: "Focus belongs to the preceding Showdown. Finalize does not pass Priority; A then B receive Closed-State Priority in turn order, and both passes precede Resolve.",
      responseWindow: "After Finalize, the Closed-State window permits legally timed Reactions before Resolve. The production golden verifies the A-to-B Priority order and subsequent Resolve without inventing a Reaction card.",
      productionAssertions: [
        "Rumble, Hotheaded production component: Finalize recycles, preserves pre-move Might, and reaches the nested Play",
        "Rumble, Hotheaded production golden: binding catalog plays real Breakneck for 5 Energy plus 2 Mind Power",
        "Rumble, Hotheaded cost-plan boundary: missing numeric Power provenance fails closed",
        "Rumble, Hotheaded production boundary: missing binding catalog stays fail-closed",
        "Rumble, Hotheaded production boundary: default server binding has no printed catalog lookup"
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
 * Judge-required after the 2026-10-23 integration recheck. The real TurnFlow
 * Conquer path selects and pays the recycle at Finalize (RIFT-929), binds that
 * payment receipt to the same Resolve body, preserves the recycled Unit's
 * pre-move Might for the discount (RIFT-953), and RIFT-972 can start from a
 * target CardProgram's complete trusted printed cost while changing only its
 * Energy component. RIFT-985 resolves a selected card with no play CostSpec
 * through the ProgramBinding's trusted catalog lookup, keyed by its canonical
 * id, and freezes the complete printed cost before the recycle moves it. The
 * card IR carries no fixed target cost. The default server room/runtime does
 * not yet collect and pass that catalog, so a server-equivalent binding has no
 * lookup and remains fail-closed under CR 131.2, 131.3, 356.1.c, 356.4.c,
 * and 357.1.
 */
export default {
  canonicalCardId: "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡保持 judge-required（2026-10-23 默认 server 装配复核）。Assault、Conquer Pending/Finalize、Board recycle、" +
    "支付前 Might 的 LKI、Energy 组件折扣与 Power 保留；显式提供 ProgramBinding.printedCatalog 时，真实无 play 能力的 " +
    "Breakneck Mech 可从 Trash 打出并按 8 Energy + 2 Mind Power 冻结、折扣为 5 Energy + 2 Mind Power。" +
    "但默认 server 装配仍缺目录接线：apps/game-server/src/room.ts:252-276 只收集 CardProgram，没有从已验证 room catalog " +
    "构造按 canonicalCardId 索引的 Energy/Power 投影；apps/game-server/src/engine-runtime/runtime.ts:269-273 创建 " +
    "ProgramBinding 时只传 cardPrograms/staticBinder，没有传 printedCatalog。RIFT-985 的 effects/play/catalog.ts:51-78 " +
    "只通过 binding 的该 lookup 获取缺省投影；缺失时 effects/play/cost-plan.ts:646-649,706 fail-closed。" +
    "因此默认 server 中 Breakneck 等无 play CostSpec 的 Power Mech 无法完成 nested Play（CR 131.2 / 131.3 / 356.1.c / 356.4.c / 357.1）。" +
    "最小改法：room owner 将 room catalog 转换为 canonicalCardId→{id,cardType,domains,energy,power} 投影，并作为 " +
    "EngineRuntimeOptions 传入；runtime.ts 将其传给 createProgramBinding.printedCatalog，再以默认 MatchRuntime 灰盒验证。",
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
                  id: "rumble.play-mech",
                  op: "effect.play",
                  linkedTo: "rumble.recycle-cost",
                  args: {
                    target: { kind: "constant", value: "rumble.mech-in-trash" },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost.modify",
                        id: "rumble.mech-cost",
                        // RIFT-972: start from the selected card's complete
                        // trusted printed Energy + Power. The explicit Energy
                        // view keeps only this component target-aware; Power
                        // provenance must never be inferred from Domain count.
                        base: "printed",
                        cost: {
                          kind: "explicit",
                          energy: {
                            kind: "object-property",
                            object: { target: "rumble.mech-in-trash" },
                            property: "energy"
                          }
                        },
                        modifier: {
                          kind: "reduce",
                          resource: "energy",
                          // The leading payment receipt supplies the recycled
                          // Unit's pre-move Might as LKI to this Resolve body.
                          amount: {
                            kind: "object-property",
                            object: { linked: "rumble.recycle-cost" },
                            property: "might"
                          }
                        }
                      }
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
