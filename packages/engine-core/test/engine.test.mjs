import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialGame,
  createRoomSnapshot,
  projectGame,
  submitCommand
} from "../dist/index.js";
import {
  isClientMessage,
  isCommand,
  isGameProjection,
  isPlayerCommand
} from "@riftbound/protocol";

const players = [
  { id: "player-1", name: "Player One" },
  { id: "player-2", name: "Player Two" }
];

function newGame() {
  return createInitialGame({ players });
}

test("createInitialGame is deterministic and emits ordered events", () => {
  const first = newGame();
  const second = newGame();

  assert.deepEqual(first, second);
  assert.equal(first.eventSeq, 2);
  assert.deepEqual(
    first.eventLog.map((event) => [event.seq, event.type]),
    [
      [1, "game-started"],
      [2, "turn-started"]
    ]
  );
});

test("playing trigger-conquer creates the automatic optional prompt", () => {
  const state = newGame();
  const result = submitCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.eventSeq, 5);
  assert.deepEqual(
    result.events.map((event) => [event.seq, event.type]),
    [
      [3, "card-played"],
      [4, "task-resolved"],
      [5, "prompt-created"]
    ]
  );
  assert.equal(result.state.prompt?.reason, "trigger-conquer");
  assert.equal(result.state.prompt?.optional, true);
  assert.deepEqual(
    result.state.outstandingTasks.map(task => [task.reason, task.optional]),
    [["trigger-conquer", true]]
  );
});

test("resolving the prompt applies damage and clears the task", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;
  const promptId = played.prompt?.id;

  const result = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId,
    optionId: "resolve"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.players[1].life, 19);
  assert.equal(result.state.prompt, null);
  assert.equal(result.state.outstandingTasks.length, 0);
  assert.deepEqual(
    result.events.map((event) => [event.seq, event.type]),
    [
      [6, "prompt-answered"],
      [7, "damage-dealt"]
    ]
  );
});

test("skipping the optional trigger does not deal damage", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;

  const result = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId: played.prompt?.id,
    optionId: "skip"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.players[1].life, 20);
  assert.equal(result.state.outstandingTasks.length, 0);
  assert.equal(result.events.at(-1)?.type, "trigger-skipped");
});

test("pass switches the active player and blocks commands during prompts", () => {
  const state = newGame();
  const passed = submitCommand(state, {
    type: "pass",
    playerId: "player-1"
  });

  assert.equal(passed.state.activePlayerId, "player-2");
  assert.equal(passed.state.turnNumber, 2);

  const played = submitCommand(passed.state, {
    type: "play-card",
    playerId: "player-2",
    instanceId: "player-2:trigger-conquer"
  });
  const invalidPass = submitCommand(played.state, {
    type: "pass",
    playerId: "player-2"
  });

  assert.equal(invalidPass.error?.code, "prompt_required");
  assert.equal(invalidPass.state, played.state);
});

test("illegal commands are rejected without mutating the authoritative state", () => {
  const state = newGame();
  const result = submitCommand(state, {
    type: "play-card",
    playerId: "player-2",
    instanceId: "player-2:trigger-conquer"
  });

  assert.equal(result.error?.code, "not_your_turn");
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
});

test("ending the game marks a winner and rejects further commands", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;
  played.players[1].life = 1;

  const result = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId: played.prompt?.id,
    optionId: "resolve"
  });
  const afterEnd = submitCommand(result.state, {
    type: "pass",
    playerId: "player-1"
  });

  assert.equal(result.state.phase, "ended");
  assert.equal(result.state.winnerPlayerId, "player-1");
  assert.equal(result.events.at(-1)?.type, "game-ended");
  assert.equal(afterEnd.error?.code, "game_ended");
});

test("public projection hides hands and room snapshot exposes the public view", () => {
  const state = newGame();
  const projection = projectGame(state);

  assert.equal(projection.eventSeq, state.eventSeq);
  assert.equal(projection.players[0].handCount, 1);
  assert.deepEqual(projection.players[0].hand, []);

  const ownProjection = projectGame(state, "player-1");
  assert.equal(ownProjection.players[0].hand.length, 1);
  assert.equal(ownProjection.players[1].hand.length, 0);

  const snapshot = createRoomSnapshot(state, "room-1");
  assert.equal(snapshot.roomId, "room-1");
  assert.equal(snapshot.eventSeq, 2);
  assert.equal(snapshot.projection.players[1].handCount, 1);
});

test("illegal commands preserve state identity and exact state values", () => {
  const state = newGame();
  const before = structuredClone(state);

  const invalidActor = submitCommand(state, {
    type: "play-card",
    playerId: "player-2",
    instanceId: "player-2:trigger-conquer"
  });
  const invalidCard = submitCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "missing-card"
  });

  for (const result of [invalidActor, invalidCard]) {
    assert.equal(result.state, state);
    assert.deepEqual(result.state, before);
    assert.deepEqual(result.events, []);
    assert.equal(result.state.eventSeq, 2);
    assert.equal(result.state.version, 3);
  }
});

test("prompt exposes owner/playerId, stateVersion, status, and options", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;
  const prompt = played.prompt;

  assert.ok(prompt);
  assert.equal(prompt.ownerPlayerId, "player-1");
  assert.equal(prompt.playerId, "player-1");
  assert.equal(prompt.stateVersion, played.version);
  assert.equal(prompt.status, "pending");
  assert.deepEqual(
    prompt.options.map(option => option.id),
    ["resolve", "skip"]
  );
});

test("only the prompt owner may answer and a stale version is rejected", () => {
  const state = newGame();
  const played = submitCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;
  const promptId = played.prompt?.id;
  const before = structuredClone(played);

  const wrongOwner = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-2",
    promptId,
    optionId: "resolve"
  });
  const staleVersion = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId,
    optionId: "resolve",
    stateVersion: played.prompt.stateVersion - 1
  });

  assert.equal(wrongOwner.error?.code, "not_your_turn");
  assert.equal(staleVersion.error?.code, "prompt_expired");
  for (const result of [wrongOwner, staleVersion]) {
    assert.equal(result.state, played);
    assert.deepEqual(result.state, before);
    assert.deepEqual(result.events, []);
  }
});

test("projection exposes only the viewer hand and viewer prompt", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;

  const playerOneView = projectGame(played, "player-1");
  const playerTwoView = projectGame(played, "player-2");
  const publicView = projectGame(played);

  assert.equal(playerOneView.prompt?.ownerPlayerId, "player-1");
  assert.equal(playerTwoView.prompt, null);
  assert.equal(publicView.prompt, null);
  assert.equal(playerOneView.players[0].hand.length, 0);
  assert.equal(playerTwoView.players[0].hand.length, 0);
  assert.ok(playerTwoView.eventSeq > 0);
  assert.equal(
    playerOneView.events.some(event => event.type === "prompt-created"),
    true
  );
  assert.equal(
    playerTwoView.events.some(event => event.type === "prompt-created"),
    false
  );
  assert.equal(isGameProjection(playerOneView), true);
  assert.equal(isGameProjection(playerTwoView), true);
  assert.equal(publicView.players.every(player => player.hand.length === 0), true);
});

test("protocol validators distinguish player and engine commands", () => {
  const playerCommand = {
    type: "respond-to-prompt",
    promptId: "prompt:example",
    optionId: "resolve"
  };
  const engineCommand = { ...playerCommand, playerId: "player-1" };

  assert.equal(isPlayerCommand(playerCommand), true);
  assert.equal(isPlayerCommand(engineCommand), false);
  assert.equal(isCommand(playerCommand), false);
  assert.equal(isCommand(engineCommand), true);
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
    command: engineCommand
  }), false);
});
