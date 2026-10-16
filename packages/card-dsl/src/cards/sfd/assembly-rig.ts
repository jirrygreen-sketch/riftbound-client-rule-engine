import type { CardProgram } from "../../ir/index.js";

/**
 * Assembly Rig (sfd-019-221) — Rumble SFD Gear.
 *
 * Printed text: ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash,
 * :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
 *
 * One activated ability (action timing; Gear abilities default to action
 * speed). CostSpec is data-only per contract 3.1: energy 1 plus one Fury
 * power (RIFT-9 cost.pay), the "Recycle a unit from your trash" cost is the
 * targeted recycle form backed by effect.recycle (CR 417.6), and the exhaust
 * symbol is the exhaust payment kind. Cost payment is checked at Finalize by
 * the chain (contract 3.2 / 3.5).
 *
 * Body: the printed token is the frozen CR 187.4 Mech definition (3 Might,
 * no abilities), expressed as effect.token in its default create mode. The
 * destination is the controller's base (CR 440.2); effect.token's locations
 * + choiceId form asks the controller for the destination at resolution
 * (with a single printed option this is a fixed, replayable request), since
 * the frozen create-token action resolves "to your base" against the acting
 * player rather than against a placeholder string. effect.token freezes that
 * playing a NEW token through chain creation is blocked, so create-to-board
 * is the expressible form; no abilities are invented for the token.
 */
export default {
  canonicalCardId: "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      cost: {
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: ["Fury"] },
        payments: [
          {
            kind: "recycle",
            choice: {
              id: "recycled-unit",
              options: ["unit-in-controller-trash"],
              min: 1,
              max: 1,
              selection: "one",
              zone: "trash",
              type: "unit",
              owner: "controller"
            }
          },
          { kind: "exhaust" }
        ]
      },
      timing: "action",
      body: [
        {
          id: "create-mech-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 1 },
            locations: {
              kind: "constant",
              value: [{ type: "base", player: "controller" }]
            },
            choiceId: { kind: "constant", value: "token-base" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
