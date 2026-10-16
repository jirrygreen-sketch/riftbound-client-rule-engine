import type { CardProgram } from "../../ir/index.js";

const orderRune = {
  // Order Rune — basic Rune (Origins, printing ogn-214-298).
  //
  // Rules evidence (Core Rules v1.5):
  // - 107.6 and 108.6: runes live in the Rune Deck / rune zone and provide
  //   resources when the rules exhaust or recycle them; a basic Rune card
  //   prints no ability text (the official gallery records "[NO TEXT]").
  // - 103.4 and 430: channeling and Adding are game actions directed by the
  //   turn structure or by other effects, not abilities printed on a Rune.
  // A no-ability program carries an empty ability list; validateCardProgram
  // rejects abilities on no-ability programs, which the golden test asserts.
  canonicalCardId: "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
};

export default orderRune;
