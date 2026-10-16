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
 *   much as possible, no Burn Out). The primitive documents that a non-zero
 *   top look needs an upstream ordered pick provider, because `query()` does
 *   not guarantee zone order; the ordered set arrives through the declared
 *   PickSpec (RIFT-66 contract change) and the golden test supplies it.
 * - "You may banish a unit from among them": the looked-at card is in the
 *   Main Deck, which is not a public zone, so it is not Targeted (355.10.a,
 *   which uses the trash/hand contrast explicitly) — the selection is the
 *   non-target choice of effect.inspect (`choose` + `chooseCount`), not a
 *   TargetSpec.
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
 * Status: judge-required. The look / banish / recycle halves are merged and
 * are executed by the golden test, but the cost reduction cannot be declared
 * or executed: there is no `cost.modify` primitive under
 * effects/instructions/, and effect.play requires its `cost` argument to
 * already be a FinalizedCostPlan computed by the cost system (it never derives
 * printed costs and never implements an ignored/discounted cost rule). Without
 * it, playing the banished card would either pay the full printed cost or do
 * nothing — both wrong, so the play instruction carries the intended cost
 * descriptor and resolves negated instead of approximating.
 */
const reinforce = {
  canonicalCardId: "card.hash-c2c17a54e193d86678b7e7bb36f02bf0db8c677c91f7ac73a0fa57cb2acc8be5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "减费无法表达或执行：「play it, reducing its cost by :rb_energy_5:」需要按 CR 356.1.c/356.6 在打出该牌时改写其印刷基础费用" +
    "（能源费 -5，且不得低于 0）；effects/instructions/ 下没有 cost.modify 原语，冻结的 CostSpec 也只有 kind/payments/energy/power/discard" +
    "（cost/plan-values.ts 的 readCost），无法声明减费；已合入的 effect.play 明确要求 cost 参数是费用系统产出、已 Finalize 的" +
    " FinalizedCostPlan（它不推导印刷费用、也不实现减费/忽略费用规则），因此“从放逐区打出并减 5 费”没有可执行路径。" +
    "依赖：RIFT-89（batch3 cost-plan 的 cost.modify/减费入口）。" +
    "Look at top 5（effect.inspect 的 top 作用域，需上游有序 picksSpecId，RIFT-66）、banish 所选牌（effect.banish）与" +
    "Recycle the remaining（effect.recycle）都已合入并由 golden 真实执行；整卡仍按缺减费依赖保持 judge-required，不近似实现。",
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
          // "Look at the top 5 cards of your Main Deck. You may banish a unit
          // from among them" — one private look (128.3-128.4) whose selection
          // is a non-target pick (355.10.a), 0 or 1 cards.
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
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            choiceId: { kind: "constant", value: "reinforce.pick-unit" },
            linkedKey: { kind: "constant", value: "looked" },
            pickedKey: { kind: "constant", value: "lookedCards" },
            choosePicksKey: { kind: "constant", value: "selectedCard" }
          },
          picks: [
            {
              id: "reinforce.top-five",
              // Ordered option set supplied by the engine (deck top to bottom,
              // contract 3.6 zoneSlice); the placeholder marks the runtime
              // provider instead of a static list.
              options: ["runtime:main-deck-top-five"],
              // 432.1.c: a short deck is still looked at as far as possible.
              min: 0,
              max: 5,
              selection: "up-to",
              zone: "deck",
              owner: "controller"
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
                    objects: { kind: "constant", value: { linked: "selectedCard" } },
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
