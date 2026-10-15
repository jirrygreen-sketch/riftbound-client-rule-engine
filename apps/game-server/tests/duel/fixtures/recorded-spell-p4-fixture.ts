import { loadCardCatalogRuntime } from "../../../src/card-catalog.js";
import {
  createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, type DuelCommandArchiveP4,
} from "../../../src/duel/command-journal-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./setup-adapter-catalog.js";

/**
 * Controlled fixture abilities: Units are blank, Spells use Draw 4, and
 * Legends/Battlefields use known non-interfering grammar. These are test
 * semantics, not the official abilities of the copied printing identities.
 * The catalog stamp permits the existing exact basic-Rune adapter in tests;
 * it is not evidence of the actual official catalog hash or effect coverage.
 * Printed costs and the card multiset remain unchanged.
 */
export async function createRecordedAuthoritativeDuelRuntimeP4() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." :
      card.cardType === "Legend" ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." :
        card.cardType === "Battlefield" ? "You may hide an additional card here." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0, randomCalls = 0;
  const deck = setupAdapterFixtureDecks.a.submission;
  const ordered = { ...deck, mainDeck: [deck.mainDeck![3]!, ...deck.mainDeck!.slice(0, 3), ...deck.mainDeck!.slice(4)] };
  const options = { catalog, matchId: "p4-recorded-spell-draw-fixture",
    // Fisher-Yates uses 38+11 calls per player; call 99 picks Alice first.
    randomIndex: (bound: number) => ++randomCalls === 99 ? 0 : bound - 1,
    uidFactory: () => `p4-recorded-spell-${++uid}`,
    roster: [
      { playerId: "alice", displayName: "Alice", deck: ordered },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ] as const };
  return { options, recorded: createDuelRecordedRuntimeP4(options), uidCount: () => uid };
}

export function restoreDuelCommandJournalP4(
  options: Awaited<ReturnType<typeof createRecordedAuthoritativeDuelRuntimeP4>>["options"],
  archive: DuelCommandArchiveP4, protectedDigest: string,
) {
  return replayDuelCommandArchiveP4(JSON.parse(JSON.stringify(archive)),
    createDuelReplayGateP4(options, protectedDigest));
}

export function protectedDigestOf(archive: DuelCommandArchiveP4) {
  return digestDuelCommandArchiveP4(archive);
}
