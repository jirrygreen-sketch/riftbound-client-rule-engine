import assert from "node:assert/strict";
import test from "node:test";
import {
  isClientMessage,
  isCommand,
  isGameProjection,
  isPlayerCommand,
  isPrompt,
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
