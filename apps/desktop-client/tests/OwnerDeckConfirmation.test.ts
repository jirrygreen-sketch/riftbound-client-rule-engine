import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, FOUNDATION_RULESET_ID, OWNER_DECK_CONFIRMATION_SCHEMA,
  type OwnerDeckConfirmationMessage, type RoomView } from "@riftbound/protocol";
import { emptySubmissionTracking, roomDeckPickerGate } from "../src/components/RoomDeckPicker";
import { confirmedOwnerDeckFingerprint, type OwnerConfirmationContext } from
  "../src/decks/owner-deck-confirmation";
import { deckFingerprint, emptyDeckByZoneSnapshot } from "../src/decks/library";
import type { DeckByZone } from "../src/hooks/useCardCatalog";
import type { OwnerDeckConfirmation } from "../src/net/GameClient";

const url = "ws://127.0.0.1:8787/ws";
const deck: DeckByZone = {
  ...emptyDeckByZoneSnapshot(),
  mainDeck: { "unit-a": 3, "unit-b": 2 },
  runes: { "rune-a": 12 },
  legend: { "legend-a": 1 },
  champion: { "hero-a": 1 },
  battlefields: { "field-a": 1 },
  sideboard: { "extra-a": 1 }
};
const echoDeck: NonNullable<OwnerDeckConfirmationMessage["deck"]> = {
  mainDeck: [{ cardId: "unit-b", quantity: 2 }, { cardId: "unit-a", quantity: 3 }],
  runes: [{ cardId: "rune-a", quantity: 12 }],
  legend: [{ cardId: "legend-a", quantity: 1 }],
  champion: [{ cardId: "hero-a", quantity: 1 }],
  battlefields: [{ cardId: "field-a", quantity: 1 }],
  sideboard: [{ cardId: "extra-a", quantity: 1 }]
};
function confirmation(overrides: Partial<OwnerDeckConfirmation> = {}): OwnerDeckConfirmation {
  return {
    type: "owner-deck-confirmation", schema: OWNER_DECK_CONFIRMATION_SCHEMA,
    roomId: "owner-room", playerId: "player-1", rulesetId: FOUNDATION_RULESET_ID,
    roomVersion: 4, roomEventSeq: 4,
    catalog: { dataVersion: "server-catalog", digest: "sha256:server-catalog" },
    deck: echoDeck, serverUrl: url, socketGeneration: 3, ...overrides
  };
}
function context(overrides: Partial<OwnerConfirmationContext> = {}): OwnerConfirmationContext {
  const roomView: RoomView = {
    roomId: "owner-room", rulesetId: FOUNDATION_RULESET_ID, status: "waiting",
    version: 0, roomVersion: 4, roomEventSeq: 4,
    players: [
      { id: "player-1", name: "Alice", connected: true, ready: false, deckSubmitted: true },
      { id: "player-2", name: "Bob", connected: true, ready: false, deckSubmitted: false }
    ]
  };
  return {
    connected: true, roomId: "owner-room", playerId: "player-1", serverUrl: url,
    roomView, switching: false, ...overrides
  };
}
function gate(proof: string | null, draft: DeckByZone = deck, rulesetId: string = FOUNDATION_RULESET_ID) {
  return roomDeckPickerGate({ connected: true, reconnecting: false,
    roomStatus: "waiting", requestPending: false, switching: false,
    selfReady: false, selfDeckSubmitted: true,
    currentFingerprint: deckFingerprint(draft), currentDeckEmpty: false,
    confirmedFingerprint: rulesetId === FOUNDATION_RULESET_ID || rulesetId === DUEL_RULESET_ID
      ? proof : emptySubmissionTracking.confirmedFingerprint,
    pendingFingerprint: emptySubmissionTracking.pendingFingerprint });
}

describe("owner-only server deck identity in a fresh App tracker", () => {
  it.each([FOUNDATION_RULESET_ID, DUEL_RULESET_ID])("recovers confirmed/ready only with matching %s private echo", rulesetId => {
    const fresh = emptySubmissionTracking;
    expect(fresh.confirmedFingerprint).toBeNull();
    expect(gate(null).canToggleReady).toBe(false);
    const proof = confirmedOwnerDeckFingerprint(
      confirmation({ rulesetId }), context({ roomView: {
        ...context().roomView!, rulesetId
      } }), deck);
    expect(proof).toBe(deckFingerprint(deck));
    expect(gate(proof, deck, rulesetId)).toMatchObject({
      canToggleReady: true, needsResubmit: false,
      deckState: { kind: "submitted", label: "卡组已提交" }
    });
  });

  it("never restores from public deckSubmitted or the former local receipt alone", () => {
    const restoredReceipt = { ...emptySubmissionTracking, confirmedFingerprint: deckFingerprint(deck) };
    expect(restoredReceipt.confirmedFingerprint).not.toBeNull();
    for (const unproven of [null, confirmation({ deck: null })]) {
      const proof = confirmedOwnerDeckFingerprint(unproven, context(), deck);
      expect(proof).toBeNull();
      // App uses proof rather than the local receipt for catalog-backed modes.
      expect(gate(proof)).toMatchObject({ canToggleReady: false, needsResubmit: true,
        deckState: { kind: "stale" } });
    }
  });

  it("refuses a different or modified local draft and restores again if it matches", () => {
    const initial = confirmedOwnerDeckFingerprint(confirmation(), context(), deck);
    const changed: DeckByZone = { ...deck, mainDeck: { ...deck.mainDeck, "unit-a": 2 } };
    expect(initial).toBe(deckFingerprint(deck));
    expect(confirmedOwnerDeckFingerprint(confirmation(), context(), changed)).toBeNull();
    expect(gate(null, changed).needsResubmit).toBe(true);
    expect(confirmedOwnerDeckFingerprint(confirmation(), context(), deck)).toBe(initial);
  });

  it("rejects foreign actor, server, room, ruleset and stale/future room clocks", () => {
    const room = context().roomView!;
    const cases: Array<[OwnerDeckConfirmation, OwnerConfirmationContext]> = [
      [confirmation({ playerId: "player-2" }), context()],
      [confirmation({ roomId: "other" }), context()],
      [confirmation({ serverUrl: "ws://other/ws" }), context()],
      [confirmation({ rulesetId: DUEL_RULESET_ID }), context()],
      [confirmation({ roomVersion: 3 }), context()],
      [confirmation({ roomVersion: 5 }), context()],
      [confirmation({ roomEventSeq: 3 }), context()],
      [confirmation({ roomEventSeq: 5 }), context()],
      [confirmation(), context({ roomId: "other" })],
      [confirmation(), context({ playerId: "player-2" })],
      [confirmation(), context({ serverUrl: "ws://other/ws" })],
      [confirmation(), context({ roomView: { ...room, roomVersion: 5 } })],
      [confirmation(), context({ roomView: { ...room, roomEventSeq: 5 } })]
    ];
    for (const [echo, identity] of cases)
      expect(confirmedOwnerDeckFingerprint(echo, identity, deck)).toBeNull();
  });

  it("does not elevate a proof while disconnecting, switching, playing, or without public owner status", () => {
    const room = context().roomView!;
    for (const state of [
      context({ connected: false }), context({ switching: true }),
      context({ roomView: { ...room, status: "playing" } }),
      context({ roomView: { ...room, rulesetId: "synthetic-demo" } }),
      context({ roomView: { ...room, players: room.players.map(player =>
        ({ ...player, deckSubmitted: false })) } }),
      context({ roomView: null })
    ]) expect(confirmedOwnerDeckFingerprint(confirmation(), state, deck)).toBeNull();
  });

  it("does not confuse cross-zone printings, duplicate entries or unsafe inventory with the draft", () => {
    expect(confirmedOwnerDeckFingerprint(confirmation({ deck: {
      ...echoDeck, sideboard: [{ cardId: "unit-a", quantity: 1 }]
    } }), context(), deck)).toBeNull();
    expect(confirmedOwnerDeckFingerprint(confirmation({ deck: {
      ...echoDeck, mainDeck: [...echoDeck.mainDeck!, echoDeck.mainDeck![0]!]
    } }), context(), deck)).toBeNull();
    expect(confirmedOwnerDeckFingerprint(confirmation({ deck: {
      ...echoDeck, mainDeck: [{ cardId: "unit-a", quantity: Number.MAX_SAFE_INTEGER },
        { cardId: "unit-b", quantity: 1 }]
    } }), context(), deck)).toBeNull();
  });

  it("compares literal card inventory despite plaintext fingerprint separator collisions", () => {
    const draft: DeckByZone = { ...emptyDeckByZoneSnapshot(),
      mainDeck: { "a=1|mainDeck:b": 2 } };
    const different: DeckByZone = { ...emptyDeckByZoneSnapshot(),
      mainDeck: { "a": 1, "b": 2 } };
    expect(deckFingerprint(draft)).toBe(deckFingerprint(different));
    const echo = confirmation({ deck: { mainDeck: [
      { cardId: "a", quantity: 1 }, { cardId: "b", quantity: 2 }
    ] } });
    expect(confirmedOwnerDeckFingerprint(echo, context(), draft)).toBeNull();
    expect(confirmedOwnerDeckFingerprint(echo, context(), different))
      .toBe(deckFingerprint(different));
  });

  it("preserves legacy Synthetic local receipt gating without private protocol echo", () => {
    const legacy = { ...emptySubmissionTracking, confirmedFingerprint: deckFingerprint(deck) };
    expect(confirmedOwnerDeckFingerprint(confirmation(), context({ roomView: {
      ...context().roomView!, rulesetId: "synthetic-demo"
    } }), deck)).toBeNull();
    expect(roomDeckPickerGate({ connected: true, reconnecting: false, roomStatus: "waiting",
      requestPending: false, switching: false, selfReady: false,
      selfDeckSubmitted: true, currentFingerprint: deckFingerprint(deck), currentDeckEmpty: false,
      confirmedFingerprint: legacy.confirmedFingerprint,
      pendingFingerprint: legacy.pendingFingerprint }).canToggleReady).toBe(true);
  });
});
