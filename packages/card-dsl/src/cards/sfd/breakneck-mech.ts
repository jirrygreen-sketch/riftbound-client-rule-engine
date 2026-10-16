import type { CardProgram } from "../../ir/index.js";

/**
 * Breakneck Mech (sfd-071-221) — rumble-sfd (RIFT-95).
 *
 * "Your Mechs have [Deflect] and [Ganking]. (Opponents must pay [rainbow]
 *  to choose us with a spell or ability. We can move from battlefield to
 *  battlefield.)
 *  I enter ready if you control another Mech."
 *
 * Ability 1 is a static layer effect granting Deflect (CR 809) and Ganking
 * (CR 810) to friendly Mechs. Ability 2 is a replacement on board entry that
 * switches exhausted entry to ready entry when the controller controls
 * another Mech (replacement.enter family).
 */
export default {
  canonicalCardId: "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Depends on the unmerged Deflect and Ganking KeywordDef files (contract 3.7; keywords registry is empty) and on the layers engine consuming static grant-keyword continuous effects; the enter-ready replacement additionally depends on the board-entry replacement primitive (replacement.enter family). Not approximated per the judge-required rule.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        filter: { tag: "Mech", controller: "controller", zone: "board" },
        keywords: ["Deflect", "Ganking"]
      }
    },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { source: "self" }
      },
      with: [
        {
          id: "enter-ready",
          op: "effect.ready",
          args: {}
        }
      ],
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            tag: "Mech",
            controller: "controller",
            zone: "board",
            other: true
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose us with a spell or ability. We can move from battlefield to battlefield.)\nI enter ready if you control another Mech."
} satisfies CardProgram;
