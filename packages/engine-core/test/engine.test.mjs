import assert from "node:assert/strict";
import test from "node:test";
import {
  RULESET_ID,
  createConfiguredGame,
  createInitialGame,
  createRoomSnapshot,
  getHotFeprStep,
  projectObject,
  projectGame,
  projectZones,
  submitCommand
} from "../dist/index.js";
import {
  isClientMessage,
  isCommand,
  isGameEvent,
  isGameProjection,
  isPlayerCommand,
  FOUNDATION_RULESET_ID,
  PROJECTION_SCHEMA_V1
} from "@riftbound/protocol";

const players = [
  { id: "player-1", name: "Player One" },
  { id: "player-2", name: "Player Two" }
];

function newGame() {
  return createInitialGame({ players });
}

function newFoundationGame() {
  return createConfiguredGame({
    players: [
      {
        id: "player-1",
        name: "Player One",
        startingHand: [
          { instanceId: "p1:unit", cardId: "card.unit" },
          { instanceId: "p1:score", cardId: "card.score" },
          { instanceId: "p1:target", cardId: "card.target" },
          { instanceId: "p1:judge", cardId: "card.judge" }
        ],
        deck: [
          { instanceId: "p1:deck-1", cardId: "card.score" },
          { instanceId: "p1:deck-2", cardId: "card.score" }
        ]
      },
      {
        id: "player-2",
        name: "Player Two",
        startingHand: [],
        deck: [{ instanceId: "p2:deck-1", cardId: "card.score" }]
      }
    ],
    cards: [
      {
        id: "card.unit",
        name: "Foundation Unit",
        cost: 1,
        types: ["unit"],
        health: 2
      },
      {
        id: "card.score",
        name: "Foundation Score",
        cost: 0,
        types: ["spell"],
        effect: {
          kind: "gain-points",
          amount: 3,
          targets: [{ kind: "player", playerId: "player-1" }]
        }
      },
      {
        id: "card.target",
        name: "Foundation Target Strike",
        cost: 0,
        types: ["spell"],
        effect: {
          kind: "damage",
          amount: 2,
          targets: []
        }
      },
      {
        id: "card.judge",
        name: "Judge Required",
        cost: 0,
        types: ["spell"],
        effect: { kind: "judge-required", reason: "official text not modeled" }
      }
    ],
    rules: { targetPoints: 3, startingEnergy: 2 }
  });
}

function newRuneDeckGame() {
  return createConfiguredGame({
    players: [
      {
        id: "player-1",
        name: "Player One",
        startingHand: [],
        rune: [{ instanceId: "p1:rune", cardId: "card.rune" }],
        runeDeck: [
          { instanceId: "p1:rune-deck-1", cardId: "card.rune" },
          { instanceId: "p1:rune-deck-2", cardId: "card.rune" }
        ]
      },
      {
        id: "player-2",
        name: "Player Two",
        startingHand: [],
        rune: [{ instanceId: "p2:rune", cardId: "card.rune" }],
        runeDeck: [{ instanceId: "p2:rune-deck-1", cardId: "card.rune" }]
      }
    ],
    cards: [{
      id: "card.rune",
      name: "Foundation Rune",
      cost: 0,
      types: ["rune"]
    }],
    rules: { targetPoints: 8 }
  });
}

function withLegacyTargetPrompt(state) {
  // Restored states may already hold a target prompt produced before the play
  // authorization policy existed; such a prompt must stay resolvable through
  // the real submitCommand path for its owner.
  const taskId = "task:legacy:p1:target";
  state.outstandingTasks.push({
    id: taskId,
    sourceCardId: "card.target",
    sourceObjectId: "p1:target",
    sourcePlayerId: "player-1",
    reason: "resolve-effect",
    optional: false,
    effect: { kind: "damage", amount: 2, targets: [] },
    targetChoices: [{ kind: "object", objectId: "p1:unit" }],
    requiresTargetChoice: true
  });
  state.prompt = {
    id: `prompt:${taskId}`,
    ownerPlayerId: "player-1",
    playerId: "player-1",
    stateVersion: state.version,
    status: "pending",
    taskId,
    reason: "resolve-effect",
    optional: false,
    options: [{ id: "target:object:p1:unit", label: "Object p1:unit" }]
  };
  return state;
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

test("foundation rules create a separate finite resource model", () => {
  const state = newFoundationGame();

  assert.equal(RULESET_ID, "riftbound-foundation");
  assert.equal(state.rules.rulesetId, "riftbound-foundation");
  assert.equal(state.rules.targetPoints, 3);
  assert.equal(state.players[0].score, 0);
  assert.equal(state.players[0].energy, 2);
  assert.deepEqual(state.players[0].deck, ["p1:deck-1", "p1:deck-2"]);
  assert.deepEqual(state.players[0].battlefield, []);
  assert.equal(state.objects["p1:unit"].zone, "hand");
});

test("foundation turn draws and restores energy", () => {
  const result = submitCommand(newFoundationGame(), {
    type: "pass",
    playerId: "player-1"
  });

  assert.equal(result.state.activePlayerId, "player-2");
  assert.equal(result.state.turnNumber, 2);
  assert.equal(result.state.players[1].energy, 3);
  assert.equal(result.events.find(event => event.type === "turn-started")?.energy, 3);
  assert.deepEqual(result.state.players[1].hand.map(card => card.instanceId), [
    "p2:deck-1"
  ]);
});

test("foundation initial turn event uses energy rather than mana", () => {
  const state = newFoundationGame();
  const event = state.eventLog.find(candidate => candidate.type === "turn-started");

  assert.equal(event?.energy, 2);
  assert.equal(event?.mana, undefined);
  assert.equal(isGameEvent(event), true);
});

test("playing a unit enters the board and playing a score spell wins", () => {
  const playedUnit = submitCommand(newFoundationGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  });
  assert.deepEqual(playedUnit.state.players[0].board, ["p1:unit"]);
  assert.equal(playedUnit.state.objects["p1:unit"].zone, "board");
  assert.equal(projectObject(playedUnit.state, "p1:unit").objectId, "p1:unit");

  const playedScore = submitCommand(playedUnit.state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:score"
  });

  assert.equal(playedScore.error, null);
  assert.equal(playedScore.state.phase, "ended");
  assert.equal(playedScore.state.winnerPlayerId, "player-1");
  assert.deepEqual(playedScore.state.players[0].discard, ["p1:score"]);
});

test("foundation target commands submit a specific public object and resolve", () => {
  const playedUnit = submitCommand(newFoundationGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  });
  const targetAction = projectGame(playedUnit.state, "player-1")
    .actionOptions.actions.find(candidate => candidate.id === "play:p1:target");
  assert.deepEqual(targetAction.targetPolicy, {
    minTargets: 1,
    maxTargets: 1,
    options: [{ kind: "object", objectId: "p1:unit" }]
  });

  const playedTarget = submitCommand(playedUnit.state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:target",
    targets: [...targetAction.targetPolicy.options]
  });

  assert.equal(playedTarget.error, null);
  assert.equal(playedTarget.state.prompt, null);
  assert.equal(playedTarget.state.outstandingTasks.length, 0);
  assert.equal(playedTarget.state.objects["p1:unit"].damage, 2);
  assert.equal(playedTarget.state.players[0].score, 0);
  assert.equal(playedTarget.state.players[0].energy, 1);
  assert.deepEqual(playedTarget.state.players[0].discard, ["p1:target"]);
  assert.equal(playedTarget.state.objects["p1:target"].zone, "discard");
});

test("unknown official effects are rejected before any pool or zone change", () => {
  const state = newFoundationGame();
  const snapshot = structuredClone(state);
  const action = projectGame(state, "player-1").actionOptions.actions.find(
    candidate => candidate.id === "play:p1:judge"
  );
  assert.equal(action.enabled, false);
  assert.equal(action.blockedReason, "judge-required");

  const played = submitCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:judge"
  });

  assert.equal(played.error?.code, "judge_required");
  assert.equal(played.state, state);
  assert.deepEqual(played.state, snapshot);
  assert.deepEqual(played.events, []);
  assert.equal(getHotFeprStep(played.state), "pass");
  assert.equal(state.prompt, null);
  assert.deepEqual(state.outstandingTasks, []);
  assert.equal(state.players[0].energy, 2);
  assert.equal(state.objects["p1:judge"].zone, "hand");
  assert.deepEqual(state.players[0].chain, []);
  assert.deepEqual(state.players[0].discard, []);

  const strayAnswer = submitCommand(played.state, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId: "prompt:p1:judge",
    optionId: "judge-required"
  });
  assert.equal(strayAnswer.error?.code, "prompt_not_found");
  assert.equal(strayAnswer.state, state);
  assert.deepEqual(strayAnswer.events, []);
  assert.deepEqual(state.players[0].discard, []);
});

test("duplicate instance IDs are rejected including deck placements", () => {
  assert.throws(() => createConfiguredGame({
    players: [
      {
        id: "player-1",
        name: "Player One",
        startingHand: [{ instanceId: "same", cardId: "card.unit" }],
        deck: [{ instanceId: "same", cardId: "card.unit" }]
      },
      { id: "player-2", name: "Player Two" }
    ],
    cards: [{
      id: "card.unit",
      name: "Unit",
      cost: 0,
      types: ["unit"]
    }],
    rules: { targetPoints: 8, drawOnTurnStart: true }
  }), /Duplicate card instance same/);
});

test("invalid card definitions are rejected during configuration", () => {
  const cards = [{
    id: "card.bad",
    name: "Bad Card",
    cost: -1,
    types: ["unit"]
  }];
  assert.throws(() => createConfiguredGame({
    players: [
      { id: "player-1", name: "Player One" },
      { id: "player-2", name: "Player Two" }
    ],
    cards,
    rules: { targetPoints: 8 }
  }), /invalid cost/);
});

test("foundation projection exposes only public zones and the viewer hand", () => {
  const playedUnit = submitCommand(newFoundationGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  const projection = projectGame(playedUnit, "player-1");
  const opponentProjection = projectGame(playedUnit, "player-2");

  assert.equal(isGameProjection(projection), true);
  assert.equal(projection.projectionSchema, "riftbound.projection.v1");
  assert.equal(projection.rulesetId, "riftbound-foundation");
  assert.equal(projection.priority.playerId, "player-1");
  assert.ok(projection.objects.some(object =>
    object.objectId === "p1:unit" && object.zone === "board"
  ));
  assert.equal(projection.objects.some(object => object.zone === "deck"), false);
  assert.equal(projection.objects.some(object =>
    object.objectId === "p1:deck-1"
  ), false);
  assert.equal(projection.players[0].hand.some(card =>
    card.instanceId === "p1:score"
  ), true);
  assert.equal(opponentProjection.players[0].hand.length, 0);
  assert.equal(projection.players[0].score, 0);
  assert.equal(newFoundationGame().players[0].energy, 2);
  assert.equal(projection.players[0].energy, 1);
  assert.deepEqual(projection.players[0].power, {});
  assert.equal(projection.players[0].zoneCounts.deck, 2);
  assert.deepEqual(projection.players[0].playableInstanceIds, [
    "p1:score",
    "p1:target",
    "p1:judge"
  ]);
});

test("foundation rune deck stays private while public runes are visible", () => {
  const state = newRuneDeckGame();
  const projection = projectGame(state, "player-1");

  assert.equal(state.objects["p1:rune-deck-1"].zone, "rune-deck");
  assert.equal(state.players[0].runeDeck.length, 2);
  assert.equal(projection.objects.some(object =>
    object.objectId === "p1:rune" && object.zone === "rune"
  ), true);
  assert.equal(projection.objects.some(object =>
    object.zone === "rune-deck"
  ), false);
  assert.equal(projection.objects.some(object =>
    object.objectId === "p1:rune-deck-1"
  ), false);
  assert.equal(projection.players[0].zoneCounts.rune, 1);
  assert.equal(projection.players[0].zoneCounts["rune-deck"], 2);
  assert.equal(projection.players[1].zoneCounts["rune-deck"], 1);
  assert.equal(projection.projectionSchema, PROJECTION_SCHEMA_V1);
  assert.equal(projection.rulesetId, FOUNDATION_RULESET_ID);
  assert.equal(isGameProjection(projection), true);
  assert.deepEqual(projectZones(state, "player-1").runeDeck, [
    "p1:rune-deck-1",
    "p1:rune-deck-2"
  ]);
});

test("foundation playable cards are gated to legal action points", () => {
  const playedUnit = submitCommand(newFoundationGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  const playedTarget = withLegacyTargetPrompt(playedUnit);
  const viewerProjection = projectGame(playedTarget, "player-1");
  const opponentProjection = projectGame(playedTarget, "player-2");

  assert.equal(playedTarget.prompt !== null, true);
  assert.deepEqual(viewerProjection.players[0].playableInstanceIds, []);
  assert.deepEqual(opponentProjection.players[1].playableInstanceIds, []);
  assert.equal(isGameProjection(viewerProjection), true);

  const blocked = submitCommand(playedTarget, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:score"
  });
  assert.equal(blocked.error?.code, "prompt_required");
  assert.equal(blocked.state, playedTarget);
  assert.deepEqual(blocked.events, []);
  assert.equal(playedTarget.objects["p1:score"].zone, "hand");
  assert.equal(playedTarget.players[0].energy, 1);
});

test("foundation handCount reports the real hand size to every viewer", () => {
  const projection = projectGame(newFoundationGame(), "player-2");

  assert.equal(projection.players[0].hand.length, 0);
  assert.equal(projection.players[0].handCount, 4);
  assert.equal(projection.players[1].handCount, 0);
});

test("foundation end waits for resolved tasks and a sole leader", () => {
  const playedUnit = submitCommand(newFoundationGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  const playedTarget = withLegacyTargetPrompt(playedUnit);
  assert.equal(playedTarget.prompt !== null, true);
  playedTarget.players[0].score = 3;
  playedTarget.players[0].hand.push({
    instanceId: "p1:board-unit",
    cardId: "card.unit"
  });
  playedTarget.players[0].board.push("p1:board-unit");
  playedTarget.objects["p1:board-unit"] = {
    ...playedTarget.objects["p1:unit"],
    objectId: "p1:board-unit",
    instanceId: "p1:board-unit",
    zone: "board"
  };

  // The threshold is reached, but the unresolved task still defers the finish.
  assert.equal(getHotFeprStep(playedTarget), "handle-outstanding-tasks");
  const deferred = submitCommand(playedTarget, {
    type: "pass",
    playerId: "player-1"
  });
  assert.equal(deferred.error?.code, "prompt_required");
  assert.equal(deferred.state.phase, "main");
  assert.equal(deferred.state.winnerPlayerId, null);

  const answered = submitCommand(playedTarget, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId: playedTarget.prompt.id,
    optionId: "target:object:p1:unit"
  });

  assert.equal(answered.error, null);
  assert.equal(answered.state.objects["p1:unit"].damage, 2);
  assert.equal(answered.state.prompt, null);
  assert.equal(answered.state.outstandingTasks.length, 0);
  assert.equal(answered.state.phase, "ended");
  assert.equal(answered.state.winnerPlayerId, "player-1");
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
  assert.equal(result.state.players[1].points, 19);
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
  assert.equal(result.state.players[1].points, 20);
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
  played.players[1].points = 1;

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
  assert.equal(result.state.prompt, null);
  assert.equal(result.state.outstandingTasks.length, 0);
  assert.equal(afterEnd.error?.code, "game_ended");
});

test("resolving a game-ending prompt clears pending automation consistently", () => {
  const played = submitCommand(newGame(), {
    type: "play-card",
    playerId: "player-1",
    instanceId: "player-1:trigger-conquer"
  }).state;
  played.players[1].points = 1;

  const result = submitCommand(played, {
    type: "respond-to-prompt",
    playerId: "player-1",
    promptId: played.prompt?.id,
    optionId: "resolve"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.phase, "ended");
  assert.equal(result.state.prompt, null);
  assert.deepEqual(result.state.outstandingTasks, []);
  assert.equal(
    result.state.eventLog.filter(event => event.type === "game-ended").length,
    1
  );
  assert.deepEqual(
    result.events.map(event => event.type),
    [
      "prompt-answered",
      "damage-dealt",
      "game-ended"
    ]
  );
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
  assert.equal(ownProjection.players[0].handCount, 1);
  assert.equal(ownProjection.players[1].handCount, 1);

  const snapshot = createRoomSnapshot(state, "room-1");
  assert.equal(snapshot.roomId, "room-1");
  assert.equal(snapshot.eventSeq, 2);
  assert.equal(snapshot.projection.players[1].hand.length, 0);
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
  assert.equal(playerOneView.projectionSchema, undefined);
  assert.equal(playerOneView.rulesetId, undefined);
  assert.equal(playerOneView.priority, undefined);
  assert.equal(playerOneView.objects, undefined);
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
