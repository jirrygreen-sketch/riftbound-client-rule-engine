import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Veiled Temple (sfd-221-221) — Battlefield, Fiora precon.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-221-221):
 *   When you conquer here, you may ready a friendly gear. If it's an
 *   Equipment, you may detach it.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you conquer here" is the Conquer trigger (468.5.d / 471.1); the
 *   `conquer` timing point is emitted by the scoring flow (turn/flow.ts
 *   scheduleScore('conquer') with details.battlefieldId). The merged event
 *   contract now has the battlefield-relative `here` anchor: EventPattern
 *   accepts it (events/trigger-spec.ts:207-216), programs/filters.ts preserves
 *   it (201-281), and events/pipeline-match.ts compares the event battlefield
 *   identity with the live source location (89-94).
 * - "you may ready a friendly gear" is one optional decision (403.1 / contract
 *   3.9): the chosen gear is a target (355.7 / 355.9.a.1) and per 355.12 it is
 *   locked together with the may-action, so the TargetSpec sits on the
 *   choice.optional node. effect.ready performs the real readied state change
 *   (416.1) and links { count, objects } under its link key.
 * - "If it's an Equipment" is a tag test on the gear selected by the may
 *   action. An already-ready gear changes nothing (416.1.c), while the locked
 *   target remains the antecedent of "it". The merged Condition vocabulary can
 *   express the test at Resolve time with the contract 3.6 expression
 *   `{ kind: "compare", left: "Equipment", operator: "in", right: { kind:
 *   "object-property", object: { target: "veiled-temple.gear" }, property:
 *   "tags" } }` — the same shape the layer-anchored conditions already use. The
 *   golden executes both branches through the real interpreter.
 * - "you may detach it" is a non-target action whose named object is the exact
 *   gear selected for the first may action (436.3 / 355.12), so the pick reads
 *   the locked TargetPlan instead of the ready receipt. This preserves "it"
 *   when effect.ready produces an empty receipt because the gear was already
 *   Ready (416.1.c). effect.detach performs the real detach action (436.1) and
 *   does nothing when the selected Equipment was not attached (436.1.a.1).
 *
 * Status: executable. The production leading-choice adapter moves only the
 * outer may to Finalize (383.3.a), keeps the target on that decision (355.12),
 * marks the later may for Resolve (383.3.a.3), and exports the outer target to
 * the ChainEngine. There is no printed or optional additional cost.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 468.5.d / 471.1 and 053.3: "here" means the battlefield this ability is
      // printed on. The production translator preserves this anchor and the
      // pipeline compares it with details.battlefieldId; never widen to every
      // conquer.
      filter: { event: "conquer", here: true, player: "controller" }
    },
    optional: true,
    body: [
      {
        id: "veiled-temple.ready-opt",
        op: "choice.optional",
        // 403.1 / 355.7 / 355.12: the may-action chooses its friendly gear when
        // the action is locked, so the target lives on the choice node.
        targets: [
          {
            id: "veiled-temple.gear",
            filter: { type: "gear", zone: "board", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ],
        args: {
          prompt: { kind: "constant", value: "Ready a friendly gear?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "veiled-temple.ready-gear",
                op: "effect.ready",
                args: {
                  objects: { kind: "constant", value: { kind: "target", id: "veiled-temple.gear" } },
                  amount: { kind: "constant", value: 1 }
                }
              },
              {
                id: "veiled-temple.detach-opt",
                op: "choice.optional",
                linkedTo: "veiled-temple.ready-gear",
                // "If it's an Equipment": a real tag membership test on the gear
                // selected by the may action (contract 3.6 object anchor).
                condition: {
                  kind: "compare",
                  left: { kind: "constant", value: "Equipment" },
                  operator: "in",
                  right: {
                    kind: "object-property",
                    object: { target: "veiled-temple.gear" },
                    property: "tags"
                  }
                },
                args: {
                  prompt: { kind: "constant", value: "Detach that Equipment?" },
                  body: {
                    kind: "constant",
                    value: [
                      {
                        id: "veiled-temple.detach",
                        op: "effect.detach",
                        // 436.3: detaching a named card is not inherently a target.
                        // "it" is nevertheless the exact gear selected by the
                        // first may action (355.12), so bind it to the locked
                        // TargetPlan rather than the state-change receipt.
                        args: { pick: { kind: "constant", value: "veiled-temple.detached-gear" } },
                        picks: [
                          {
                            id: "veiled-temple.detached-gear",
                            options: [
                              { kind: "target", id: "veiled-temple.gear" }
                            ],
                            // Retest the same locked incarnation at Resolve
                            // without widening the source to every Board gear.
                            filter: { type: "gear", zone: "board" },
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
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it."
} satisfies CardProgram;

export default program;
