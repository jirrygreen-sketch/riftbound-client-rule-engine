import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_V2_EVENT_CONTRACT,
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  isV2Projection,
  type V2EngineEvent,
  type V2Projection
} from "../../../../packages/protocol/src/v2/index.js";
import {
  emptyReplayLibrary,
  normalizeReplayRecording,
  readReplayLibrary,
  saveReplayRecording,
  serializeReplayLibrary,
  summarizeReplayFrame,
  writeReplayLibrary,
  type StorageLike
} from "../../src/replays/replay-library";
import {
  captureV2ReplaySnapshot,
  v2ReplayCaptureComplete,
  v2ReplayRecording,
  type V2ReplayCapture
} from "../../src/replays/v2-replay-capture";
import { findReplayRecording, replayRecordingFrameCount } from "../../src/replays/replay-library";
import { ReplayPage } from "../../src/replays/ReplayPage";
import { createEngineRuntime, type EngineRuntimeDeck } from "../../../game-server/src/engine-runtime/index.js";
type M1Card = {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
};

type M1Candidate = {
  readonly id: string;
  readonly chosenChampion: string;
  readonly officialCardList: readonly M1Card[];
};

const m1Catalog = JSON.parse(readFileSync(new URL(
  "../../../../docs/plans/m1-decks.json", import.meta.url
), "utf8")) as { readonly candidates: readonly M1Candidate[] };

/** Production server fleet fixture, copied at behavior level from its package test. */
function runtimeDeck(candidateId: string): EngineRuntimeDeck {
  const candidate = m1Catalog.candidates.find(item => item.id === candidateId);
  if (!candidate) throw new Error(`Unknown M1 candidate ${candidateId}`);
  const expand = (entries: readonly M1Card[], zone: string) => entries.flatMap(entry =>
    Array.from({ length: entry.quantity }, (_, index) => ({
      id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: entry.canonicalCardId,
      name: entry.name,
      types: [entry.cardType.toLowerCase()],
      energy: null,
      power: null
    })));
  const legendEntry = candidate.officialCardList.find(entry => entry.zone === "legend");
  const chosenEntry = candidate.officialCardList.find(entry => entry.zone === "champion" &&
    entry.name === candidate.chosenChampion);
  if (!legendEntry || !chosenEntry) throw new Error(`Incomplete M1 candidate ${candidateId}`);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosenEntry.canonicalCardId);
  if (chosenIndex < 0) throw new Error(`Chosen champion absent from ${candidateId}`);
  mainDeck.splice(chosenIndex, 1);
  const battlefields = expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield");
  if (battlefields.length !== 3) throw new Error(`M1 candidate ${candidateId} requires three battlefields`);
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: { ...expand([legendEntry], "legend")[0]! },
    chosenChampion: { ...expand([chosenEntry], "champion")[0]! },
    battlefields: battlefields as unknown as readonly [ReturnType<typeof expand>[number], ReturnType<typeof expand>[number], ReturnType<typeof expand>[number]]
  };
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function event(eventSeq: number, viewer = "alice", ownerOnly = false): V2EngineEvent {
  return {
    contract: PROTOCOL_V2_EVENT_CONTRACT,
    seq: eventSeq,
    eventSeq,
    stateVersion: eventSeq,
    timingPoint: "card-played",
    audience: ownerOnly ? { visibility: "owner-only", ownerPlayerId: viewer } : { visibility: "public" },
    payload: {
      marker: { visibility: "public", value: `${viewer}:${eventSeq}` }
    }
  };
}

function projection(
  viewer: string,
  stateVersion: number,
  eventSeq = stateVersion,
  phase: V2Projection["phase"] = "main",
  winnerPlayerId: string | null = null
): V2Projection {
  const ownHand = viewer === "alice" ? "alice-hand-1" : "bob-hand-1";
  const value: V2Projection = {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "match-v2-replay",
    viewerPlayerId: viewer,
    stateVersion,
    eventSeq,
    phase,
    turnNumber: 1,
    activePlayerId: viewer,
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 2, power: { Fury: 1 }, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 6, zoneCounts: { hand: 1, deck: 20 } },
      { playerId: "bob", name: "Bob", score: 0, energy: 1, power: { Calm: 1 }, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 6, zoneCounts: { hand: 1, deck: 20 } }
    ],
    zones: [
      { zone: "hand", ownerPlayerId: viewer, count: 1, objects: [{
        objectId: ownHand, zone: "hand", ownerPlayerId: viewer,
        cardId: `${viewer}-private-card`, faceDown: false, visibility: "owner-only"
      }] },
      { zone: "hand", ownerPlayerId: viewer === "alice" ? "bob" : "alice", count: 1 },
      { zone: "deck", ownerPlayerId: "alice", count: 20 },
      { zone: "deck", ownerPlayerId: "bob", count: 20 }
    ],
    objects: [{
      objectId: ownHand, zone: "hand", ownerPlayerId: viewer,
      cardId: `${viewer}-private-card`, faceDown: false, visibility: "owner-only"
    }],
    chain: { status: "closed", phase: "open", priorityPlayerId: viewer, focusPlayerId: null, items: [] },
    priority: { playerId: viewer, focusPlayerId: null, window: "open" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: ["field-1"],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: null,
      contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId,
    events: Array.from({ length: eventSeq }, (_, index) => event(index + 1, viewer, index % 2 === 0))
  };
  expect(isV2Projection(value)).toBe(true);
  return value;
}

function captureFrames(length: number): V2ReplayCapture {
  let capture: V2ReplayCapture | null = null;
  for (let index = 0; index < length; index += 1) {
    const frame = projection("alice", index, index);
    capture = captureV2ReplaySnapshot(capture, {
      roomId: "room-v2", sessionPlayerId: "alice",
      projection: frame, events: frame.events
    }).capture;
  }
  if (capture === null) throw new Error("empty capture");
  return capture;
}

describe("V2 local replay capture", () => {
  it("captures real server projections through the production V2 projector", () => {
    const realAlice = runtimeDeck("rumble-sfd");
    const realBob = runtimeDeck("fiora-sfd");
    let handForMulligan: string[] = [];
    const probe = createEngineRuntime({
      matchId: "match-production-replay-probe",
      decks: [realAlice, realBob],
      seed: "RIFT-1024"
    }).start();
    handForMulligan = probe.projectFor("A").zones
      .find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects?.map(object => object.objectId) ?? [];
    expect(handForMulligan).toHaveLength(5);
    const runtime = createEngineRuntime({
      matchId: "match-production-replay", decks: [realAlice, realBob],
      seed: "RIFT-1024",
      mulligans: [[], []]
    }).start();
    const alice = runtime.projectFor("A");
    const bob = runtime.projectFor("B");
    expect(isV2Projection(alice)).toBe(true);
    expect(isV2Projection(bob)).toBe(true);
    const aliceCards = alice.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [];
    const bobCards = bob.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "B")?.objects ?? [];
    expect(aliceCards.length).toBeGreaterThan(0);
    expect(bobCards.length).toBeGreaterThan(0);

    const capture = captureV2ReplaySnapshot(null, {
      roomId: "room-production-replay", sessionPlayerId: "A", projection: alice, events: alice.events
    });
    expect(capture.rejectedReason).toBeNull();
    expect(JSON.stringify(capture.capture)).toContain(aliceCards[0]!.objectId);
    expect(JSON.stringify(capture.capture)).not.toContain(bobCards[0]!.objectId);
    expect(capture.capture?.frames[0]?.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "B")?.objects)
      .toBeUndefined();
  });

  it("captures only the authenticated viewer's owner-only projection and never mixes the opponent", () => {
    const alice = captureV2ReplaySnapshot(null, {
      roomId: "room-v2", sessionPlayerId: "alice",
      projection: projection("alice", 1), events: []
    });
    expect(alice.capture?.frames).toHaveLength(1);
    expect(alice.capture?.frames[0]?.viewerPlayerId).toBe("alice");
    expect(JSON.stringify(alice.capture)).toContain("alice-private-card");
    expect(JSON.stringify(alice.capture)).not.toContain("bob-private-card");
    expect(alice.capture?.frames[0]?.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "bob")?.objects)
      .toBeUndefined();

    const swap = captureV2ReplaySnapshot(alice.capture ?? null, {
      roomId: "room-v2", sessionPlayerId: "alice",
      projection: projection("bob", 2), events: []
    });
    expect(swap.capture).toBe(alice.capture);
    expect(swap.rejectedReason).toContain("不属于当前玩家");
  });

  it("keeps every distinct frame through 56 turns and de-duplicates cumulative events", () => {
    const capture = captureFrames(600);
    expect(capture.frames).toHaveLength(600);
    expect(capture.frames.map(frame => frame.stateVersion)).toEqual(Array.from({ length: 600 }, (_, index) => index));
    for (const [index, frame] of capture.frames.entries()) {
      expect(frame.events.map(event => event.eventSeq)).toEqual(index === 0 ? [] : [index]);
    }

    const same = captureV2ReplaySnapshot(capture, {
      roomId: "room-v2", sessionPlayerId: "alice",
      projection: capture.frames.at(-1)!, events: capture.frames.at(-1)!.events
    });
    expect(same.capture?.frames).toHaveLength(600);
  });

  it("saves a terminal recording and reads the identical viewer-scoped frames back", () => {
    const capture = captureFrames(5);
    const ended = projection("alice", 5, 5, "ended", "alice");
    const final = captureV2ReplaySnapshot(capture, {
      roomId: "room-v2", sessionPlayerId: "alice", projection: ended, events: ended.events
    });
    expect(v2ReplayCaptureComplete(final.capture)).toBe(true);
    const recording = v2ReplayRecording(final.capture!, "2026-10-23T00:00:00.000Z");
    const saved = saveReplayRecording(emptyReplayLibrary(), recording);
    const storage = new MemoryStorage();
    expect(writeReplayLibrary(storage, saved)).toBe(true);
    const restored = readReplayLibrary(storage);
    expect(restored).toEqual(saved);
    expect(restored.recordings[0]?.v2Frames).toEqual(final.capture?.frames);
    expect(restored.recordings[0]?.frames).toEqual([]);
    expect(summarizeReplayFrame(restored.recordings[0]!, 5)).toMatchObject({
      phase: "ended",
      viewerPlayerId: "alice",
      matchId: "match-v2-replay"
    });
    const parsed = JSON.parse(serializeReplayLibrary(restored));
    expect(Object.keys(parsed.recordings[0]).sort()).toEqual(["frames", "id", "roomId", "savedAt", "title", "v2Frames"]);

    const html = renderToStaticMarkup(createElement(ReplayPage, {
      library: restored,
      selectedId: restored.recordings[0]!.id,
      selectedFrameIndex: 5,
      onSelectFrame: () => {},
      onDelete: () => {}
    }));
    expect(html).toContain('aria-label="协议 v2 回放牌桌"');
    expect(html).toContain("alice-private-card");
    expect(html).not.toContain("bob-private-card");
    expect(html).toContain("胜者：Alice");
    expect(html).toContain("V2 回放只读");
    expect(html).toContain("回放协议：协议 v2");
    expect(html).not.toContain("<form");
    expect(findReplayRecording(restored, restored.recordings[0]!.id)).not.toBeNull();
    expect(replayRecordingFrameCount(restored.recordings[0]!)).toBe(6);
  });

  it("refuses mixed viewers, viewer-less frames, and a malformed V2 record", () => {
    const first = projection("alice", 1);
    const second = projection("bob", 2);
    expect(normalizeReplayRecording({
      id: "v2:mixed", roomId: "room-v2", title: "Mixed", savedAt: "2026-10-23T00:00:00.000Z",
      frames: [], v2Frames: [first, second]
    })).toBeNull();
    expect(normalizeReplayRecording({
      id: "v2:public", roomId: "room-v2", title: "Public", savedAt: "2026-10-23T00:00:00.000Z",
      frames: [], v2Frames: [{ ...first, viewerPlayerId: null }]
    })).toBeNull();
    expect(normalizeReplayRecording({
      id: "v2:extra", roomId: "room-v2", title: "Extra", savedAt: "2026-10-23T00:00:00.000Z",
      frames: [], v2Frames: [{ ...first, unexpected: "private" }]
    })).toBeNull();
  });
});
