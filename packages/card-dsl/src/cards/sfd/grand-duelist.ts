import type { CardProgram } from "../../ir/index.js";

const grandDuelist = {
  // Grand Duelist — Fiora's Champion Legend (Spiritforged, sfd-205-221).
  //
  // Rules evidence (Core Rules v1.5):
  // - 706–709: a unit "becomes Mighty" at the moment its Might changes from
  //   below 5 to 5 or greater; the "might-changed" timing point carries the
  //   before/after Might so the trigger filter can detect the threshold
  //   crossing.
  // - 431.2: "channel 1 rune exhausted" stipulates the rune enters exhausted.
  // - 430.2 / 430.2.a: triggered abilities that add resources (channeling)
  //   finalize immediately and do not pass priority.
  // - 428.1 / 428.2.a: "you may" makes the trigger optional; exhausting the
  //   legend is the cost-like condition paid as the trigger resolves.
  // - The optional-exhaust sequencing primitive (effect.exhaust is not merged
  //   yet) and the Mighty threshold predicate are still engine work, so only
  //   the effect.channel instruction is golden-executable today.
  canonicalCardId:
    "card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "might-changed",
        filter: {
          event: "might-changed",
          filter: {
            type: "unit",
            controller: "controller",
            becameMighty: true
          }
        }
      },
      optional: true,
      body: [
        {
          id: "exhaust-self",
          op: "effect.exhaust",
          args: { target: { kind: "constant", value: "source" } as const }
        },
        {
          id: "channel-rune",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          },
          linkedTo: "exhaust-self"
        }
      ]
    }
  ],
  sourceText:
    "When one of your units becomes [Mighty], you may exhaust me to channel 1 rune exhausted. (A unit is Mighty while it has 5+ :rb_might:.)"
};

export default grandDuelist;
