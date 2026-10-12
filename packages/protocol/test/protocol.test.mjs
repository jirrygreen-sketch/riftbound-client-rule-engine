import assert from "node:assert/strict";
import test from "node:test";
import {
  isClientMessage,
  isCommand,
  FOUNDATION_RULESET_ID,
  PROJECTION_SCHEMA_V1,
  isGameProjection,
  isPlayerCommand,
  isPrompt,
  isRoomSnapshot,
  isServerMessage
} from "../dist/index.js";

const prompt = {
  id: "prompt:task-1",
  ownerPlayerId: "player-1",
  playerId: "player-1",
  stateVersion: 6,
  status: "pending",
  taskId: "task-1",
  reason: "trigger-conquer",
  optional: true,
  options: [
    { id: "resolve", label: "Resolve trigger" },
    { id: "skip", label: "Skip trigger" }
  ]
};

test("prompt validation requires one owner and a stable response contract", () => {
  assert.equal(isPrompt(prompt), true);
  assert.equal(isPrompt({ ...prompt, ownerPlayerId: "player-2" }), false);
  assert.equal(isPrompt({ ...prompt, stateVersion: -1 }), false);
  assert.equal(isPrompt({ ...prompt, options: [] }), false);
  assert.equal(isPrompt({
    ...prompt,
    options: [
      { id: "resolve", label: "Resolve trigger" },
      { id: "resolve", label: "Duplicate" }
    ]
  }), false);
});

test("client command validation rejects a client-supplied actor", () => {
  const playerCommand = {
    type: "play-card",
    instanceId: "player-1:trigger-conquer"
  };

  assert.equal(isPlayerCommand(playerCommand), true);
  assert.equal(isPlayerCommand({ ...playerCommand, playerId: "player-2" }), false);
  assert.equal(isCommand({ ...playerCommand, playerId: "player-1" }), true);
  assert.equal(isCommand(playerCommand), false);

  assert.equal(isClientMessage({
    type: "command",
    requestId: "request-1",
    commandId: "command-1",
    expectedVersion: 3,
    command: playerCommand
  }), true);
  assert.equal(isClientMessage({
    type: "command",
    requestId: "request-1",
    commandId: "command-1",
    expectedVersion: 3,
    command: { ...playerCommand, playerId: "player-2" }
  }), false);
});

test("projection and server message validation are recursive", () => {
  const projection = {
    version: 6,
    eventSeq: 5,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    winnerPlayerId: null,
    prompt,
    waitingForPlayerId: "player-1",
    players: [
      {
        id: "player-1",
        name: "Player One",
        life: 20,
        mana: 0,
        handCount: 0,
        hand: []
      },
      {
        id: "player-2",
        name: "Player Two",
        life: 20,
        mana: 1,
        handCount: 1,
        hand: []
      }
    ],
    events: [
      {
        type: "prompt-created",
        seq: 5,
        turnNumber: 1,
        activePlayerId: "player-1",
        promptId: prompt.id,
        playerId: "player-1",
        reason: prompt.reason,
        optional: true
      }
    ]
  };

  assert.equal(isGameProjection(projection), true);
  assert.equal(isGameProjection({ ...projection, prompt: null }), true);
  assert.equal(isGameProjection({
    ...projection,
    players: [{ ...projection.players[0], hand: [{ instanceId: "x", cardId: "x" }] }]
  }), false);
  assert.equal(isServerMessage({
    type: "projection",
    roomId: "room-1",
    projection
  }), true);
  assert.equal(isServerMessage({
    type: "error",
    code: "prompt_expired",
    message: "The prompt has expired."
  }), true);
});

test("lobby and replay messages use strict wire shapes", () => {
  const unknownField = { unexpected: true };

  assert.equal(isClientMessage({
    type: "create-room",
    requestId: "create-1",
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  }), true);
  assert.equal(isClientMessage({
    ...unknownField,
    type: "create-room",
    requestId: "create-1",
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  }), false);

  const deck = {
    mainDeck: [{ cardId: "fixture.card.standard", quantity: 3 }],
    legend: [{ cardId: "fixture.legend", quantity: 1 }]
  };
  assert.equal(isClientMessage({
    type: "submit-deck",
    requestId: "deck-1",
    expectedRoomVersion: 1,
    deck
  }), true);
  assert.equal(isClientMessage({
    type: "submit-deck",
    requestId: "deck-1",
    expectedRoomVersion: 1,
    deck: { ...deck, mainDeck: [{ cardId: "fixture.card.standard", quantity: 0 }] }
  }), false);

  assert.equal(isClientMessage({
    type: "sync-events",
    requestId: "sync-1",
    afterRoomEventSeq: 2,
    afterEventSeq: 4
  }), true);
  assert.equal(isClientMessage({
    type: "sync-events",
    requestId: "sync-1",
    afterEventSeq: -1
  }), false);

  const room = {
    type: "room",
    room: {
      roomId: "room-1",
      status: "waiting",
      rulesetId: FOUNDATION_RULESET_ID,
      version: 0,
      roomVersion: 3,
      roomEventSeq: 3,
      players: [{
        id: "player-1",
        name: "Alice",
        connected: true,
        ready: false,
        deckSubmitted: false
      }]
    }
  };
  assert.equal(isServerMessage(room), true);
  assert.equal(isServerMessage({
    ...room,
    room: { ...room.room, roomEventSeq: 4, rulesetId: "unsupported-ruleset" }
  }), false);

  assert.equal(isServerMessage({
    type: "room-events",
    roomId: "room-1",
    afterRoomEventSeq: 0,
    nextRoomEventSeq: 1,
    roomVersion: 1,
    events: [{
      type: "room-created",
      seq: 1,
      roomId: "room-1",
      playerId: "player-1"
    }]
  }), true);
  assert.equal(isServerMessage({
    type: "room-events",
    roomId: "room-1",
    afterRoomEventSeq: 2,
    nextRoomEventSeq: 1,
    roomVersion: 1,
    events: []
  }), false);
});

function foundationProjection() {
  return {
    projectionSchema: PROJECTION_SCHEMA_V1,
    rulesetId: FOUNDATION_RULESET_ID,
    version: 6,
    eventSeq: 5,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    players: [
      {
        id: "player-1", name: "Alice", score: 0, energy: 0, power: {},
        handCount: 1,
        hand: [{ instanceId: "alice:card", cardId: "card.unit" }],
        zoneCounts: { hand: 1, deck: 35, "rune-deck": 12 },
        playableInstanceIds: []
      },
      {
        id: "player-2", name: "Bob", score: 0, energy: 0, power: {},
        handCount: 4, hand: [],
        zoneCounts: { hand: 4, deck: 35, "rune-deck": 12 },
        playableInstanceIds: []
      }
    ],
    objects: [{
      objectId: "alice:card", cardId: "card.unit", zone: "hand",
      ownerPlayerId: "player-1", controllerId: "player-1", faceUp: true
    }],
    events: [{
      type: "turn-started", seq: 2, turnNumber: 1,
      activePlayerId: "player-1", playerId: "player-1", energy: 0
    }]
  };
}

test("filtered projections keep event gaps and a private opponent prompt", () => {
  const projection = foundationProjection();
  assert.equal(isGameProjection(projection), true);
  assert.equal(isGameProjection({
    ...projection, waitingForPlayerId: "player-2"
  }), true);
  assert.equal(isGameProjection({
    ...projection, prompt, waitingForPlayerId: "player-1"
  }), true);
  assert.equal(isGameProjection({
    ...projection, prompt, waitingForPlayerId: "player-2"
  }), false);
  assert.equal(isGameProjection({
    ...projection, waitingForPlayerId: "unknown"
  }), false);
  assert.equal(isGameProjection({
    ...projection, eventSeq: 1
  }), false);
  assert.equal(isGameProjection({
    ...projection, events: [...projection.events, ...projection.events]
  }), false);
});

test("foundation projections reject contradictory hands and secret deck objects", () => {
  const projection = foundationProjection();
  const handObject = projection.objects[0];
  assert.equal(isGameProjection({ ...projection, objects: [] }), false);
  for (const zone of ["deck", "rune-deck"]) {
    assert.equal(isGameProjection({
      ...projection,
      objects: [...projection.objects, { ...handObject, objectId: "secret", zone }]
    }), false);
  }
  assert.equal(isGameProjection({
    ...projection,
    objects: [{ ...handObject, cardId: "different.card" }]
  }), false);
  assert.equal(isGameProjection({
    ...projection,
    players: [
      { ...projection.players[0], handCount: 2, zoneCounts: { hand: 2 } },
      projection.players[1]
    ]
  }), false);
  assert.equal(isGameProjection({
    ...projection,
    players: [
      { ...projection.players[0], zoneCounts: { hand: 2 } },
      projection.players[1]
    ]
  }), false);
  assert.equal(isGameProjection({
    ...projection,
    players: [
      { ...projection.players[0], playableInstanceIds: ["alice:card", "alice:card"] },
      projection.players[1]
    ]
  }), false);
  assert.equal(isGameProjection({
    ...projection,
    players: [
      projection.players[0],
      { ...projection.players[1], hand: projection.players[0].hand }
    ]
  }), false);
});

test("event backfill accepts privacy gaps but rejects replay outside its cursor window", () => {
  const event = foundationProjection().events[0];
  const message = {
    type: "events", roomId: "room-1",
    afterEventSeq: 1, nextEventSeq: 5, version: 6, events: [event]
  };
  assert.equal(isServerMessage(message), true);
  assert.equal(isServerMessage({ ...message, events: [] }), true);
  assert.equal(isServerMessage({ ...message, afterEventSeq: 2 }), false);
  assert.equal(isServerMessage({ ...message, nextEventSeq: 1 }), false);
  assert.equal(isServerMessage({ ...message, events: [event, event] }), false);
  assert.equal(isServerMessage({
    type: "room-events", roomId: "room-1",
    afterRoomEventSeq: 0, nextRoomEventSeq: 2, roomVersion: 3,
    events: [{ type: "game-started", seq: 1, roomId: "another-room" }]
  }), false);
});

test("room snapshots bind replay events to their room and players", () => {
  const players = [{
    id: "player-1",
    name: "Alice",
    connected: true,
    ready: true,
    deckSubmitted: true
  }];
  const roomEvent = {
    type: "room-created",
    seq: 1,
    roomId: "room-1",
    playerId: "player-1"
  };
  const snapshot = {
    roomId: "room-1",
    status: "playing",
    players,
    version: 2,
    roomVersion: 1,
    roomEventSeq: 1,
    eventSeq: 2,
    projection: foundationProjection(),
    roomEvents: [roomEvent]
  };

  assert.equal(isRoomSnapshot(snapshot), true);
  assert.equal(isRoomSnapshot({
    ...snapshot,
    roomEvents: [{ ...roomEvent, roomId: "another-room" }]
  }), false);
  assert.equal(isRoomSnapshot({
    ...snapshot,
    roomEvents: [{ ...roomEvent, playerId: "player-2" }]
  }), false);
  assert.equal(isRoomSnapshot({
    ...snapshot,
    roomEventSeq: 0
  }), false);
});
