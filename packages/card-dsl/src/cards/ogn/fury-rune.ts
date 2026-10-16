import type { CardProgram } from "../../ir/index.js";

const furyRune = {
  // Fury Rune — basic Rune (Origins, printing ogn-007-298).
  //
  // Rules evidence (Core Rules v1.5):
  // - 107.6 and 108.6: runes live in the Rune Deck / rune zone and provide
  //   resources when the rules exhaust or recycle them; a basic Rune card
  //   prints no ability text (the official gallery records "[NO TEXT]").
  // - 103.4 and 430: channeling and Adding are game actions directed by the
  //   turn structure or by other effects, not abilities printed on a Rune.
  // A no-ability program carries an empty ability list; validateCardProgram
  // rejects abilities on no-ability programs, which the golden test asserts.
  canonicalCardId: "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
};

export default furyRune;
