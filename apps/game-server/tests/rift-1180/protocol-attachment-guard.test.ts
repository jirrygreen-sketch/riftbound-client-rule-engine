import { describe, expect, it } from "vitest";

import {
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  isV2Projection,
  type V2ProjectedObject,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";

function projectionWith(object: V2ProjectedObject): V2Projection {
  const host: V2ProjectedObject = {
    objectId: "unit", zoneEntryId: 2, zone: "board", ownerPlayerId: "A",
    faceDown: false, visibility: "public", location: { kind: "base", playerId: "A" },
  };
  return {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "RIFT-1180-guard",
    viewerPlayerId: "A",
    stateVersion: 0,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "A",
    players: [{
      playerId: "A", name: "A", score: 0, energy: 0, power: {}, xp: 0,
      handCount: 0, deckCount: 0, runeDeckCount: 0, zoneCounts: { board: 2 },
    }],
    zones: [{ zone: "board", ownerPlayerId: "A", count: 2, objects: [object, host] }],
    objects: [object, host],
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "open" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [{ playerId: "A", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }],
    },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [],
  };
}

describe("RIFT-1180 attachment projection guard", () => {
  const sword: V2ProjectedObject = {
    objectId: "sword", zoneEntryId: 1, zone: "board", ownerPlayerId: "A",
    faceDown: false, visibility: "public", location: { kind: "base", playerId: "A" },
  };

  it("accepts a non-empty attachedToObjectId on a board permanent", () => {
    expect(isV2Projection(projectionWith({ ...sword, attachedToObjectId: "unit" }))).toBe(true);
  });

  it("rejects an empty, whitespace, or non-string attachedToObjectId", () => {
    for (const invalid of ["", " ", 1, null, {}, ["unit"]] as const) {
      expect(isV2Projection(projectionWith({ ...sword, attachedToObjectId: invalid as never })), String(invalid)).toBe(false);
    }
  });
});
