import type { CardProgram } from "../../ir/index.js";

const bodyRune = {
  // Body Rune — basic Rune (Origins, printing ogn-126-298).
  //
  // Rules evidence (Core Rules v1.5):
  // - 107.6 and 108.6: runes live in the Rune Deck / rune zone and provide
  //   resources when the rules exhaust or recycle them; a basic Rune card
  //   prints no ability text (the official gallery records "[NO TEXT]").
  // - 103.4 and 430: channeling and Adding are game actions directed by the
  //   turn structure or by other effects, not abilities printed on a Rune.
  // A no-ability program carries an empty ability list; validateCardProgram
  // rejects abilities on no-ability programs, which the golden test asserts.
  canonicalCardId: "card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
};

export default bodyRune;
