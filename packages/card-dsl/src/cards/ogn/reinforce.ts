import type { CardProgram } from "../../ir/index.js";

/**
 * Reinforce (ogn-062-298) — Spell, 5 energy, Calm.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-062-298):
 *   Look at the top 5 cards of your Main Deck. You may banish a unit from
 *   among them, then play it, reducing its cost by :rb_energy_5:. Recycle the
 *   remaining cards.
 *
 * No [Action]/[Reaction] keyword is printed, so the spell keeps default spell
 * timing (159.2.a / 308.1.a) and no speed keyword is declared. No printed cost
 * is declared: a spell's printed base cost is bound from the catalog at
 * Finalize (`cost.printed`, contract 3.1 / CR 356.1.c).
 *
 * Modeling notes (Core Rules v1.5):
 * - "Look at the top 5 cards of your Main Deck" is effect.inspect in top
 *   scope (CR 128.3-128.4: look is private to the looking player; 432.1.c: as
 *   much as possible, no Burn Out). A set query does not guarantee zone order,
 *   so the look declares a merged ordered zoneSlice pick source (RIFT-66
 *   contract change, landed with the RIFT-358 Finalize lifecycle): the chain
 *   locks the actual top five refs during Finalize
 *   (chain/picks/plan.ts finalizeOrderedPickPlans; a short deck locks only the
 *   cards that exist) and effect.inspect reads them at Resolve.
 * - "You may banish a unit from among them": the looked-at card is in the
 *   Main Deck, which is not a public zone, so it is not Targeted (355.10.a,
 *   which uses the trash/hand contrast explicitly). The selection is the
 *   non-target choose owned by effect.banish; its ObjectFilter anchors the
 *   candidate query to the ordered looked-at pick and filters it to units.
 * - "then play it" plays that same card out of Banishment as a Limited Action
 *   (420.3/420.3.a, contract 3.6 GameAction `play`); the printed "then" is a
 *   result reference, so the play instruction is linked to the banish
 *   (359.3.e.14) and reads the banished card's fresh reference from the
 *   banish receipt instead of guessing an identity.
 * - "reducing its cost by [5]" is a base-cost modification applied while
 *   playing the card (356.1.c: effects that refer to the Base Cost use the
 *   printed cost; 356.6: Energy costs cannot be reduced below 0).
 * - "Recycle the remaining cards" is effect.recycle over the looked list
 *   (417.1.a Main Deck cards recycle to their owner's Main Deck bottom;
 *   417.4 as many as possible). The played card already left the deck, so its
 *   old reference is stale and drops out, which is exactly "the remaining".
 * - "you" in effect.inspect's required `player` argument: the merged
 *   primitive's argument schema validates `player` with an object-property
 *   branch that requires a runtime `ObjectRef`, so the contract 3.6 symbolic
 *   selector `"source"` is rejected there. The controller is therefore bound
 *   once with `condition.value` (a data-only value node) and read back as a
 *   linked value; no semantics are invented — the bound value is the ability
 *   controller (190.6.d). See the contract change request in this task's
 *   reply.
 *
 * Status: judge-required. The look / unit-filtered banish / recycle halves are
 * merged and are executed by the golden test, but one gap remains:
 * - `cost.modify` is merged, but no card-program/Finalize producer reads the
 *   selected card's catalog printed cost, applies the Energy -5 discount, and
 *   supplies the resulting FinalizedCostPlan required by effect.play. The play
 *   instruction therefore keeps the intended unfinalized descriptor as
 *   reviewable data. The required "unit from among them" restriction is
 *   enforced by effect.banish's merged choose + ObjectFilter path
 *   (`object: { pick: "reinforce.top-five" }`).
 */
const reinforce = {
  canonicalCardId: "card.hash-c2c17a54e193d86678b7e7bb36f02bf0db8c677c91f7ac73a0fa57cb2acc8be5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "一处缺口：减费仍不可表达或执行——「play it, reducing its cost by :rb_energy_5:」需要按 CR 356.1.c/356.6 " +
    "在打出该牌时改写其印刷基础费用（能源费 -5，不得低于 0）；cost.modify 原语与费用计划已合入，但没有卡牌程序/Finalize 生产者读取被选牌的目录印刷费用并" +
    "把折扣后的 FinalizedCostPlan 提供给要求已 Finalize 费用的 effect.play。" +
    "有序 zoneSlice pick 来源（RIFT-66 契约变更随 RIFT-358 落地，Finalize 经 chain/picks/plan.ts 真实锁定牌库顶序、短牌库按实际数量锁定）" +
    "已合入并被本卡声明；effect.banish 的非目标 choose + ObjectFilter 已按 { object: { pick: \"reinforce.top-five\" }, type: \"unit\" } " +
    "约束候选，golden 真实验证排除法术及范围外的牌。look/banish/recycle 三段只用已合入原语并已由 golden 真实执行；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // Data-only binding of "you" (the ability controller, 190.6.d) for
          // effect.inspect's required player argument; see the file header.
          id: "reinforce.bind-controller",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "controller"
            },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          // "Look at the top 5 cards of your Main Deck" — one private look
          // (128.3-128.4); the later banish instruction owns the non-target
          // unit choice (355.10.a).
          id: "reinforce.look-top-five",
          op: "effect.inspect",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "reinforce.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 5 },
            picksSpecId: { kind: "constant", value: "reinforce.top-five" },
            linkedKey: { kind: "constant", value: "looked" },
            pickedKey: { kind: "constant", value: "lookedCards" }
          },
          picks: [
            {
              id: "reinforce.top-five",
              // Merged ordered source (RIFT-66 / RIFT-358): the chain locks
              // the actual deck-top incarnation refs in its Finalize step
              // (chain/picks/plan.ts) and effect.inspect consumes them at
              // Resolve. options stays empty; the ordered source itself
              // carries no filter or bounds.
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: {
                zone: "deck",
                from: "top",
                // 432.1.c: a short deck is still looked at as far as possible.
                count: { kind: "constant", value: 5 }
              }
            }
          ]
        },
        {
          // "You may banish a unit from among them, then play it" — the may
          // wraps the banish-plus-play pair in its body (contract 3.9).
          id: "reinforce.may-banish-and-play",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Banish a unit from among them and play it?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "reinforce.banish-chosen-unit",
                  op: "effect.banish",
                  args: {
                    objects: {
                      kind: "constant",
                      value: {
                        choose: "reinforce.pick-unit",
                        filter: {
                          object: { pick: "reinforce.top-five" },
                          type: "unit"
                        },
                        visibility: "chooser-only"
                      }
                    },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "banished" }
                  }
                },
                {
                  // "then play it, reducing its cost by [5]" (420.3,
                  // 356.1.c/356.6). The cost argument records the required
                  // finalization: the printed base cost of the banished card
                  // minus 5 Energy, never below 0. effect.play requires an
                  // already-finalized plan, so this descriptor negates until
                  // the cost-plan discount producer lands (see judgeReason).
                  id: "reinforce.play-it",
                  op: "effect.play",
                  linkedTo: "reinforce.banish-chosen-unit",
                  args: {
                    object: {
                      kind: "linked-value",
                      instructionId: "reinforce.banish-chosen-unit",
                      key: "banishedObject"
                    },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost.modify",
                        base: "printed",
                        discount: { resource: "energy", amount: 5, minimum: 0 },
                        finalized: false
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        {
          // "Recycle the remaining cards" (417.1.a / 417.4); the banished
          // card's old reference is stale and therefore not recycled.
          id: "reinforce.recycle-remaining",
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "reinforce.look-top-five",
              key: "lookedCards"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Look at the top 5 cards of your Main Deck. You may banish a unit from among them, " +
    "then play it, reducing its cost by :rb_energy_5:. Recycle the remaining cards."
} satisfies CardProgram;

export default reinforce;
