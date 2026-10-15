import { DUEL_RULESET_ID, FOUNDATION_RULESET_ID, OWNER_DECK_ZONES, type RoomView } from "@riftbound/protocol";
import type { DeckByZone } from "../hooks/useCardCatalog";
import type { OwnerDeckConfirmation } from "../net/GameClient";
import { deckFingerprint } from "./library";

/** Echo is private transport evidence, not an ACK or locally persisted proof. */
export interface OwnerConfirmationContext {
  readonly connected: boolean;
  readonly roomId: string | null;
  readonly playerId: string | null;
  readonly serverUrl: string | null;
  readonly roomView: RoomView | null;
  /** Pending deck switch must finish its own set-ready(false) receipt first. */
  readonly switching: boolean;
}

/** Missing/old echo and a public deckSubmitted flag are always insufficient. */
export function confirmedOwnerDeckFingerprint(
  confirmation: OwnerDeckConfirmation | null,
  context: OwnerConfirmationContext,
  draft: DeckByZone
): string | null {
  const room = context.roomView;
  if (!confirmation || !room || !context.connected || context.switching ||
      !context.roomId || !context.playerId || !context.serverUrl ||
      context.roomId !== room.roomId || context.roomId !== confirmation.roomId ||
      context.playerId !== confirmation.playerId ||
      context.serverUrl !== confirmation.serverUrl ||
      room.rulesetId !== confirmation.rulesetId ||
      (room.rulesetId !== FOUNDATION_RULESET_ID && room.rulesetId !== DUEL_RULESET_ID) ||
      room.roomVersion !== confirmation.roomVersion ||
      room.roomEventSeq !== confirmation.roomEventSeq ||
      room.status !== "waiting" ||
      !room.players.find(player => player.id === context.playerId)?.deckSubmitted ||
      confirmation.deck === null) return null;

  // The private protocol parser already rejects unknown zones, duplicates,
  // overflow, and malformed entries. Re-check totals here while converting an
  // immutable server echo into a local record: never silently drop a duplicate.
  const inventory: DeckByZone = {
    mainDeck: {}, runes: {}, legend: {}, champion: {}, battlefields: {}, sideboard: {}
  };
  let total = 0;
  for (const zone of OWNER_DECK_ZONES) {
    const target = inventory[zone] as Record<string, number>;
    for (const { cardId, quantity } of confirmation.deck[zone] ?? []) {
      if (Object.prototype.hasOwnProperty.call(target, cardId) ||
          !Number.isSafeInteger(quantity) || quantity <= 0 ||
          !Number.isSafeInteger(total + quantity)) return null;
      total += quantity;
      Object.defineProperty(target, cardId, { value: quantity, enumerable: true, configurable: true, writable: true });
    }
  }
  if (total === 0) return null;
  // Compare actual per-zone inventory, not just its display fingerprint: card
  // IDs can contain the fingerprint's separators, so string equality alone
  // would silently conflate two different decks.
  for (const zone of OWNER_DECK_ZONES) {
    const received = inventory[zone] as Record<string, number>;
    const local = Object.entries(draft[zone]);
    if (local.length !== Object.keys(received).length || local.some(([cardId, quantity]) =>
      !Number.isSafeInteger(quantity) || quantity < 1 ||
      !Object.prototype.hasOwnProperty.call(received, cardId) ||
      received[cardId] !== quantity)) return null;
  }
  // deckFingerprint is plaintext; keep it only in memory for the existing UI
  // gate, never on the wire, in RoomView or in local/session storage.
  const fingerprint = deckFingerprint(inventory);
  return fingerprint !== "" ? fingerprint : null;
}
