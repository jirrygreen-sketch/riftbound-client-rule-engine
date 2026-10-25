import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  isV2Projection,
} from "../dist/v2/index.js";

function projection() {
  return {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "rift-1069",
    viewerPlayerId: "alice",
    stateVersion: 4,
    eventSeq: 3,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
    ],
    zones: [],
    objects: [],
    chain: { status: "open", phase: "await-commit", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "choice" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      ],
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice: {
      status: "pending",
      choiceId: "finalize:trigger:1:optional",
      ownerPlayerId: "alice",
      stateVersion: 4,
      kind: "optional",
      prompt: "Pay 1 Energy?",
      source: { objectId: "source-1", name: "Treasure Hoard" },
    },
    winnerPlayerId: null,
    events: [],
  };
}

function pending(value) {
  assert.equal(value.pendingChoice.status, "pending");
  return value.pendingChoice;
}

test("V2 pending choice accepts legacy omissions and chooser source/prompt metadata", () => {
  assert.equal(isV2Projection(projection()), true);
  const legacy = projection();
  const current = pending(legacy);
  delete current.prompt;
  delete current.source;
  assert.equal(isV2Projection(legacy), true, "older projections omit both additive fields");

  for (const source of [
    { objectId: "source-1" },
    { name: "Treasure Hoard" },
  ]) {
    assert.equal(isV2Projection({
      ...projection(),
      pendingChoice: { ...pending(projection()), source },
    }), true);
  }
});

test("V2 pending choice source and prompt fail closed on malformed or unbounded values", () => {
  for (const [field, value] of [
    ["prompt", ""],
    ["prompt", " padded"],
    ["prompt", "x".repeat(513)],
    ["prompt", 7],
    ["source", {}],
    ["source", null],
    ["source", []],
    ["source", { objectId: "" }],
    ["source", { objectId: "source-1 ", name: "Card" }],
    ["source", { name: "x".repeat(513) }],
    ["source", { name: 7 }],
    ["source", { objectId: "source-1", extra: true }],
  ]) {
    assert.equal(isV2Projection({
      ...projection(),
      pendingChoice: { ...pending(projection()), [field]: value },
    }), false, `${field}=${JSON.stringify(value)}`);
  }
});

test("V2 source and prompt are chooser-only even when structurally valid", () => {
  const value = { ...projection(), viewerPlayerId: "bob" };
  assert.equal(isV2Projection(value), false);
  assert.equal(isV2Projection({ ...value, pendingChoice: {
    ...pending(projection()),
    prompt: undefined,
    source: undefined,
  } }), true);
});
