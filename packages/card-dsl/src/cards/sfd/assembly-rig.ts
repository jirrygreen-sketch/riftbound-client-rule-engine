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
 * no abilities). "Play" is effect.token's mode "play": the token is created
 * on the Chain and that exact ObjectRef is handed to the ordinary Play
 * process (CR 350.2, 440.2.c, 185.2.a, 354). The concrete destination is the
 * controller's Base; resolving that selector there avoids treating the
 * symbolic "controller" as a player id. The Unit enters exhausted under CR
 * 143.4 / 185.2.d. No abilities are invented for the token.
 *
 * RIFT-1038 closed the former production gap. During the parent activation's
 * Resolve, the played Mech is created on the Chain and becomes its own Pending
 * item. CR 354.3 pauses that nested Play until the parent Resolve completes;
 * the same FEPR pass then Finalizes the child and immediately Resolves the Unit
 * under CR 337.1-337.2. Unit entry is exhausted under CR 143.4 / 185.2.d, at
 * the requested Base, with the printed 3 Might / Mech characteristics and
 * absent printed costs preserved. The full effect is therefore executable.
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
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
