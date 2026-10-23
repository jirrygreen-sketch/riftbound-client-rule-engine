import type { CardProgram } from "../../ir/index.js";

const mechanizedMenace = {
  // Mechanized Menace — Rumble's Champion Legend (Spiritforged, sfd-181-221).
  //
  // Rules evidence (Core Rules v1.5):
  // - 801.3.a: "Your Mechs have [Shield]" is an effect granting the Shield
  //   keyword to every Mech unit the legend's controller controls.
  // - 814.1.b.3 / 814.1.c: the granted Shield omits its value, so X is
  //   presumed to be 1, and it is functionally "while I am a defender, I
  //   have +1 [M]" — matching the reminder text in sourceText.
  // - The program still writes `value: 1` instead of omitting the optional
  //   value: the current ContinuousEffect contract has no explicit printed-
  //   omission marker, while the authoritative Shield KeywordDef maps an
  //   omitted value to the same 1 (SHIELD_DEFAULT_VALUE). This preserves the
  //   mechanics and does not invent a different Shield Value.
  // - 814.2: Shield granted from multiple sources stacks (values sum), which
  //   the "shield" KeywordDef owns (stacking: "sum").
  // - The layers system (P0 contract 3.4) owns the actual continuous grant;
  //   this program only describes it for the KeywordDef expansion to consume.
  // - Tags match case-sensitively and the catalog / CR 187.4 Mech token spell
  //   the tag "Mech"; the earlier lowercase "mech" matched no real card
  //   (RIFT-889 probe).
  // - status = executable: RIFT-891 establishes the Champion Legend in its
  //   Legend Zone. RIFT-963 includes Shield in the production keyword
  //   re-expansion lifecycle, so the granted Shield contributes its derived
  //   continuous.might to the real CombatFlow damage plan.
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
          tag: "Mech",
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
