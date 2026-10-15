import { readDeckLibrary, type DeckLibrary } from "../decks/library";
import { readUiPreferences, type UiPreferences } from "../decks/ui-preferences";
import { readStoredDeck, type DeckByZone } from "../hooks/useCardCatalog";

export interface UiBootstrap {
  readonly storage: Storage | null;
  readonly library: DeckLibrary;
  readonly preferences: UiPreferences;
  readonly restoredDeck: DeckByZone;
}

/**
 * Tolerant, single-shot read of the three independent local keys this app owns
 * at mount. Each reader degrades to empty on missing/corrupt data and never
 * throws, so a broken storage never blocks the editor.
 */
export function createUiBootstrap(): UiBootstrap {
  const storage = typeof window === "undefined" ? null : window.localStorage;
  return {
    storage,
    library: readDeckLibrary(storage),
    preferences: readUiPreferences(storage),
    restoredDeck: readStoredDeck(storage)
  };
}
