import { setupAdapterFixtureDecks } from "./setup-adapter-catalog.js";

/**
 * Put the controlled Draw fixture's one-energy printing first in the input
 * deck. The real constructor still shuffles, deals and executes mulligans;
 * no canonical head, resources or cards are inserted after admission.
 * These tests replace ability text with Draw 4 and are not official-card
 * acceptance. Reordering preserves the submitted card multiset and costs.
 */
export const spellFirstSetupDeck = {
  ...setupAdapterFixtureDecks.a.submission,
  mainDeck: [
    ...setupAdapterFixtureDecks.a.submission.mainDeck.filter(entry => entry.cardId === "ogn-004-298"),
    ...setupAdapterFixtureDecks.a.submission.mainDeck.filter(entry => entry.cardId !== "ogn-004-298"),
  ],
};
