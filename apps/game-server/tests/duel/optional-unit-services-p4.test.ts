import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2, createDuelMatchV2, resolveDuelMulliganV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createCardProgramAuthority } from "../../src/duel/card-program-authority.js";
import { createDuelOptionalUnitProgramReader, createP4OptionalUnitServices } from
  "../../src/duel/optional-unit-services-p4.js";
import { setupAdapterFixtureCatalog } from "./fixtures/setup-adapter-catalog.js";

const printings = setupAdapterFixtureCatalog.cards.filter(card =>
  card.id === "ogn-001-298" || card.id === "ogn-010-298");
const metadata = { matchId: "optional-unit-p4-two-printings",
  dataVersion: "2026-10-12-official-gallery",
  catalogDigest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10",
  roster: ["alice", "bob"].map(playerId => ({ playerId, displayName: playerId })) as
    [{ playerId: string; displayName: string }, { playerId: string; displayName: string }] };
const seats = ["alice", "bob"].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
    cardId: i % 2 ? "ogn-010-298" : "ogn-001-298" })),
  champion: { uid: `${playerId}-champion`, cardId: "fixture-champion" },
  legend: { uid: `${playerId}-legend`, cardId: "fixture-legend" },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: "fixture-rune", domain: "Fury" as const })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `fixture-field-${i}` })),
}));
const typeOf = (cardId: string) => cardId === "fixture-champion" ? "Champion" as const :
  cardId === "fixture-legend" ? "Legend" as const : cardId === "fixture-rune" ? "Rune" as const :
  cardId.startsWith("fixture-field-") ? "Battlefield" as const : "Unit" as const;

async function scene() {
  const catalog = await loadCardCatalogRuntime({ catalog: { schemaVersion: 1,
    dataVersion: metadata.dataVersion, digest: metadata.catalogDigest, policy: {}, cards: printings } });
  const programs = createCardProgramAuthority(catalog);
  let match = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  match = resolveDuelMulliganV2(match, "alice", []);
  match = resolveDuelMulliganV2(match, "bob", []);
  if (match.stage !== "playing") throw new TypeError("playing constructor required");
  const playing = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  return { catalog, programs, playing };
}

describe("P4 optional Unit catalog binding", () => {
  it("loads the genuine two printing tuples and binds each current Hand UID/epoch", async () => {
    expect(printings).toHaveLength(2);
    const { catalog, programs, playing } = await scene();
    const reader = createDuelOptionalUnitProgramReader({ catalog, programs });
    const cards = playing.players[0].hand;
    expect(new Set(cards.map(card => card.cardId))).toEqual(new Set(["ogn-001-298", "ogn-010-298"]));
    for (const card of cards) {
      const source = reader.readSource(playing, "alice", card.uid);
      const result = reader.describe({ match: playing, matchId: playing.matchId,
        dataVersion: playing.dataVersion, catalogDigest: playing.catalogDigest,
        actor: "alice", uid: card.uid, cardId: card.cardId, sourceEpoch: source.sourceEpoch });
      expect(result.description.status).toBe("known");
      expect(result.programFingerprint).toBe(source.sourceProgramFingerprint);
      expect(result.description.printedBaseCost.energy).toBe(card.cardId === "ogn-001-298" ? 5 : 2);
      expect(programs.resolvedProgramReference(card.cardId)).toBeUndefined();
    }
    expect(() => reader.readSource(playing, "bob", cards[0]!.uid)).toThrow();
    expect(() => reader.describe({ match: playing, matchId: playing.matchId,
      dataVersion: playing.dataVersion, catalogDigest: playing.catalogDigest,
      actor: "alice", uid: cards[0]!.uid, cardId: cards[0]!.cardId,
      sourceEpoch: playing.physicalCardsByUID[cards[0]!.uid]!.zoneEpoch + 1 })).toThrow();
  });

  it("keeps unproved global cost census and entry closure blocked", async () => {
    const { catalog, programs, playing } = await scene();
    const helper = createP4OptionalUnitServices({ catalog, programs, getOperationHead: () => playing,
      currentJournal: () => ({ readCostCensus: () => null }) as never,
      inspectChoice: () => { throw new TypeError("no choice authority"); } });
    const card = playing.players[0].hand[0]!;
    const source = helper.readSource(playing, "alice", card.uid);
    const bound = helper.program({ match: playing, matchId: playing.matchId,
      dataVersion: playing.dataVersion, catalogDigest: playing.catalogDigest,
      actor: "alice", uid: card.uid, cardId: card.cardId, sourceEpoch: source.sourceEpoch });
    expect(helper.entry({ match: playing, matchId: playing.matchId,
      stateVersion: playing.stateVersion, eventSeq: playing.eventSeq, actor: "alice", uid: card.uid,
      cardId: card.cardId, sourceEpoch: source.sourceEpoch,
      baseLocationId: playing.board.bases[0]!.locationId,
      programId: bound.programFingerprint }).sourceCensus).toBe("unknown");
    expect(() => helper.cost({ transactionId: JSON.stringify([playing.matchId, playing.stateVersion,
      "alice", "play-1", card.uid, source.sourceEpoch, "play-1", "pay"]),
      cardId: card.cardId, actor: "alice", uid: card.uid, sourceEpoch: source.sourceEpoch,
      choice: "pay", description: bound.description,
      receipt: { ...source, commandId: "play-1", stateVersion: playing.stateVersion,
        decision: "pay" } })).toThrow(/cost census unavailable/);
  });

  it("refuses mixed ability text even when it begins with Accelerate", async () => {
    const { playing } = await scene();
    const mixed = printings.map(card => card.id === "ogn-001-298" ? {
      ...card, ability: `${card.ability}\nWhen you play me, draw 1.` } : card);
    const catalog = await loadCardCatalogRuntime({ catalog: { schemaVersion: 1,
      dataVersion: metadata.dataVersion, digest: metadata.catalogDigest, policy: {}, cards: mixed } });
    const programs = createCardProgramAuthority(catalog);
    const reader = createDuelOptionalUnitProgramReader({ catalog, programs });
    const card = playing.players[0].hand.find(item => item.cardId === "ogn-001-298")!;
    expect(() => reader.readSource(playing, "alice", card.uid)).toThrow(/whole-pure Accelerate/);
  });

  it("blocks an extra optional source mislabeled not-applicable", async () => {
    const { catalog, programs, playing } = await scene();
    const helper = createP4OptionalUnitServices({ catalog, programs, getOperationHead: () => playing,
      currentJournal: () => ({ readCostCensus: () => census }) as never,
      inspectChoice: () => { throw new TypeError("no choice authority"); } });
    const card = playing.players[0].hand[0]!;
    const source = helper.readSource(playing, "alice", card.uid);
    const bound = helper.program({ match: playing, matchId: playing.matchId,
      dataVersion: playing.dataVersion, catalogDigest: playing.catalogDigest,
      actor: "alice", uid: card.uid, cardId: card.cardId, sourceEpoch: source.sourceEpoch });
    const otherCardId = card.cardId === "ogn-001-298" ? "ogn-010-298" : "ogn-001-298";
    const census = {
      matchId: playing.matchId, stateVersion: playing.stateVersion, eventSeq: playing.eventSeq,
      journalRevision: 1, candidateSetRevision: 1, unresolvedNativeHistory: false, phaseClosed: false,
      sources: [
        { uid: card.uid, sourceEpoch: source.sourceEpoch, cardId: card.cardId,
          ownerPlayerId: "alice", controllerPlayerId: "alice", programReference: null,
          carrier: "object", zone: { kind: "hand", zonePlayerId: "alice" }, bindingRevision: 1, status: "live" },
        { uid: "extra-optional-source", sourceEpoch: 0, cardId: otherCardId,
          ownerPlayerId: "alice", controllerPlayerId: "alice", programReference: null,
          carrier: "object", zone: { kind: "hand", zonePlayerId: "alice" }, bindingRevision: 1, status: "live" },
      ],
    };
    expect(() => helper.cost({ transactionId: JSON.stringify([playing.matchId, playing.stateVersion,
      "alice", "play-1", card.uid, source.sourceEpoch, "play-1", "pay"]),
      cardId: card.cardId, actor: "alice", uid: card.uid, sourceEpoch: source.sourceEpoch,
      choice: "pay", description: bound.description,
      receipt: { ...source, commandId: "play-1", stateVersion: playing.stateVersion,
        decision: "pay" } })).toThrow(/native cost census differs|unknown source program/);
  });
});
