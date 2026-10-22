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
