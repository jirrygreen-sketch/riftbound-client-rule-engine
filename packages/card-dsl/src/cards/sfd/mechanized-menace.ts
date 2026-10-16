import type { CardProgram } from "../../ir/index.js";

const mechanizedMenace = {
  // Mechanized Menace — Rumble's Champion Legend (Spiritforged, sfd-181-221).
  //
  // Rules evidence (Core Rules v1.5):
  // - 802.2: "Your Mechs have [Shield]" is a static ability that grants the
  //   Shield keyword to every Mech unit the legend's controller controls.
  // - 814.1.b.3 / 814.1.c: the granted Shield omits its value, so X is
  //   presumed to be 1, and it is functionally "while I am a defender, I
  //   have +1 [M]" — matching the reminder text in sourceText.
  // - 814.2: Shield granted from multiple sources stacks (values sum), which
  //   the "shield" KeywordDef owns (stacking: "sum").
  // - The layers system (P0 contract 3.4) owns the actual continuous grant;
  //   this program only describes it for the KeywordDef expansion to consume.
  canonicalCardId:
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        keyword: "shield",
        value: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          tag: "mech",
          controller: "controller",
          zone: "board"
        }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Shield]. (+1 :rb_might: while they're defenders.)"
};

export default mechanizedMenace;
