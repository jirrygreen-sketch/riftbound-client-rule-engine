import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  isV2Projection
} from "../../dist/v2/index.js";

function projection(activations) {
  return {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "rift-1167",
    viewerPlayerId: "alice",
    stateVersion: 7,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "alice",
    players: [{
      playerId: "alice",
      name: "Alice",
      score: 0,
      energy: 0,
      power: {},
      xp: 0,
      handCount: 0,
      deckCount: 0,
      runeDeckCount: 0,
      zoneCounts: {}
    }],
    zones: [],
    objects: [],
    chain: {
      status: "open",
      phase: "open",
      priorityPlayerId: "alice",
      focusPlayerId: null,
      items: []
    },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: []
    },
    actionOptions: { canEndTurn: false, moves: [], plays: [], activations },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

test("RIFT-1167 activations expose the exact source, ability index, label and Reaction timing", () => {
  const activation = {
    sourceObjectId: "gold-1",
    abilityId: "0",
    label: "Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:.",
    reaction: true
  };
  assert.equal(isV2Projection(projection([activation])), true);
  assert.equal(isV2Projection(projection([{ ...activation, reaction: undefined }])), true);
});

test("RIFT-1167 activation options reject malformed identities, labels, timing and fields", () => {
  const valid = {
    sourceObjectId: "gold-1",
    abilityId: "0",
    label: "Equip",
    reaction: false
  };
  for (const activation of [
    { ...valid, sourceObjectId: "" },
    { ...valid, abilityId: "" },
    { ...valid, label: " Equip" },
    { ...valid, reaction: "yes" },
    { ...valid, extra: true }
  ]) {
    assert.equal(isV2Projection(projection([activation])), false);
  }
  assert.equal(isV2Projection(projection(null)), false);
});
