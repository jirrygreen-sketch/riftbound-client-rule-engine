import type { CardProgram } from "../../ir/index.js";

/**
 * Dangerous Duo (ogn-016-298) — Rumble SFD precon unit.
 *
 * [Legion] — When you play me, give a unit +2 [M] this turn.
 * (Get the effect if you've played another card this turn.)
 *
 * Core Rules v1.5 812.1.b.1 defines Legion as "If you have played another
 * card this turn, this card gains [Text]", and 812.1.c fixes the history time
 * at a successful Finalize by the same player earlier this turn. The program
 * expresses that trigger condition with the closed cards-finalized-this-turn
 * count and the 3.6 exclude:self selector. ProgramBinding converts this exact
 * shape to TriggerSpec.conditionHistory, which reads ChainEngine's turn-scoped
 * Finalize records and preserves a different physical same-name card.
 *
 * "When you play me" is the Play Effect from 383.4.a; "a unit" is one Board
 * target (355.7/355.9.a.1) locked when the triggered item finalizes. At
 * Resolve, +2 Might this turn is an arithmetic-layer continuous.might effect
 * that lasts through Ending Step FEPR and expires in the Expiration Step
 * (479.4.f, 317.2.c).
 *
 * Status executable: the production ChainEngine golden verifies the printed
 * cost, card-played trigger, Finalize-time history and target lock, Resolve,
 * Might change, turn-end expiration, and next-turn history reset.
 */
export default {
  canonicalCardId: "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "dangerous-duo.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "dangerous-duo.unit" }
          },
          targets: [
            {
              id: "dangerous-duo.unit",
              filter: { zone: "board", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Legion] — When you play me, give a unit +2 :rb_might: this turn. (Get the effect if you've played another card this turn.)"
} satisfies CardProgram;
