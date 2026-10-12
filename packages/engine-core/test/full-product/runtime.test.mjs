import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_PRODUCT_ERROR_CODES,
  createFullProductGame,
  listLegalActions,
  submitFullProductCommand
} from "../../dist/full-product/runtime.js";

const players = [
  {
    playerId: "player-1",
    name: "Player One",
    life: 3,
    maximumEnergy: 1,
    deck: [{ instanceId: "p1:draw", cardId: "card.spell" }],
    startingHand: [{ instanceId: "p1:unit", cardId: "card.unit" }]
  },
  {
    playerId: "player-2",
    name: "Player Two",
    life: 3,
    maximumEnergy: 1,
    deck: [],
    startingHand: []
  }
];

const cards = [
  {
    cardId: "card.unit",
    name: "Test Unit",
    cost: 1,
    attack: 2,
    health: 2,
    types: ["unit"]
  },
  {
    cardId: "card.spell",
    name: "Test Spell",
    cost: 0,
    attack: 0,
    health: 1,
    types: ["spell"]
  }
];

function newGame() {
  return createFullProductGame({
    players,
    cards,
    firstPlayerId: "player-1",
    maximumBoardSize: 1,
    drawPerTurn: 1
  });
}

function newGameConfig() {
  return {
    players,
    cards,
    firstPlayerId: "player-1",
    maximumBoardSize: 1,
    drawPerTurn: 1
  };
}

function startGame() {
  let state = newGame();
  for (const playerId of ["player-1", "player-2"]) {
    const result = submitFullProductCommand(state, {
      type: "answer-prompt",
      playerId,
      promptId: state.prompt.promptId,
      optionId: "ready"
    });
    assert.equal(result.error, null);
    state = result.state;
  }
  return state;
}

function startGameWithDefenderUnit() {
  const state = structuredClone(startGame());
  const playerTwo = state.players[1];
  playerTwo.board.push("p2:blocker");
  state.instances["p2:blocker"] = {
    instanceId: "p2:blocker",
    cardId: "card.unit",
    ownerPlayerId: "player-2",
    zone: "board",
    damage: 0,
    attackedThisTurn: false
  };
  const main = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  });
  return submitFullProductCommand(main.state, {
    type: "pass-main",
    playerId: "player-1"
  }).state;
}

test("both players must answer the deterministic ready-check prompt", () => {
  let state = newGame();
  assert.equal(state.phase, "setup");
  assert.equal(state.prompt.playerId, "player-1");
  assert.deepEqual(listLegalActions(state, "player-1").map(action => action.type), [
    "answer-prompt"
  ]);
  assert.deepEqual(listLegalActions(state, "player-2"), []);

  const first = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "player-1",
    promptId: state.prompt.promptId,
    optionId: "ready"
  });
  assert.equal(first.error, null);
  assert.equal(first.state.phase, "setup");
  assert.equal(first.state.prompt.playerId, "player-2");
  assert.equal(first.state.priorityPlayerId, "player-2");
  assert.deepEqual(first.state.readyPlayerIds, ["player-1"]);

  const wrongOwner = submitFullProductCommand(first.state, {
    type: "answer-prompt",
    playerId: "player-1",
    promptId: first.state.prompt.promptId,
    optionId: "ready"
  });
  assert.equal(wrongOwner.error.code, FULL_PRODUCT_ERROR_CODES.promptRequired);
  assert.equal(wrongOwner.state, first.state);
});

test("the first complete turn refreshes, draws, and enters main", () => {
  const state = startGame();
  const player = state.players[0];

  assert.equal(state.turnNumber, 1);
  assert.equal(state.phase, "main");
  assert.equal(state.turnStep, "main");
  assert.equal(state.activePlayerId, "player-1");
  assert.equal(state.priorityPlayerId, "player-1");
  assert.equal(player.energy, 1);
  assert.deepEqual(player.hand, [
    "p1:unit",
    "p1:draw"
  ]);
  assert.deepEqual(player.deck, []);
  assert.deepEqual(state.eventLog.map(event => event.type).slice(-8), [
    "prompt-answered",
    "phase-advanced",
    "phase-advanced",
    "turn-started",
    "energy-refreshed",
    "zone-changed",
    "card-drawn",
    "phase-advanced"
  ]);
});

test("legal actions reflect energy and the active player only", () => {
  const state = startGame();

  assert.deepEqual(listLegalActions(state, "player-1"), [
    { type: "pass-main", playerId: "player-1" },
    { type: "play-card", playerId: "player-1", instanceId: "p1:unit" },
    { type: "play-card", playerId: "player-1", instanceId: "p1:draw" }
  ]);
  assert.deepEqual(listLegalActions(state, "player-2"), []);

  const invalidActor = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-2",
    instanceId: "p1:unit"
  });
  assert.equal(invalidActor.error.code, FULL_PRODUCT_ERROR_CODES.notYourTurn);
  assert.equal(invalidActor.state, state);
  assert.deepEqual(invalidActor.events, []);
});

test("playing a unit spends energy and changes zones deterministically", () => {
  const state = startGame();
  const before = structuredClone(state);
  const result = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.players[0].energy, 0);
  assert.deepEqual(result.state.players[0].hand, ["p1:draw"]);
  assert.deepEqual(result.state.players[0].board, ["p1:unit"]);
  assert.equal(result.state.instances["p1:unit"].zone, "board");
  assert.deepEqual(
    result.events.map(event => [event.seq, event.type]),
    [
      [14, "zone-changed"],
      [15, "card-played"]
    ]
  );
  assert.notDeepEqual(result.state, before);
});

test("the battle declaration enumerates object and player targets", () => {
  let state = startGame();
  state = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  state = submitFullProductCommand(state, {
    type: "pass-main",
    playerId: "player-1"
  }).state;

  assert.equal(state.phase, "battle-declaration");
  assert.equal(state.turnStep, "declare");
  const actions = listLegalActions(state, "player-1");
  assert.deepEqual(actions, [
    {
      type: "pass-battle",
      playerId: "player-1"
    },
    {
      type: "declare-attack",
      playerId: "player-1",
      instanceId: "p1:unit",
      targetInstanceId: "player"
    }
  ]);

  const declared = submitFullProductCommand(state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "player"
  });
  const passed = submitFullProductCommand(declared.state, {
    type: "pass-battle",
    playerId: "player-1"
  });
  assert.equal(passed.error, null);
  assert.equal(passed.state.phase, "battle");
  assert.equal(passed.state.turnStep, "resolve");
  assert.deepEqual(listLegalActions(passed.state, "player-1"), [
    { type: "resolve-battle", playerId: "player-1" }
  ]);

  const valid = submitFullProductCommand(state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "player"
  });
  assert.equal(valid.error, null);
  const duplicate = submitFullProductCommand(valid.state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "player"
  });
  const invalidTarget = submitFullProductCommand(state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "missing"
  });
  assert.equal(duplicate.error.code, FULL_PRODUCT_ERROR_CODES.invalidCommand);
  assert.equal(invalidTarget.error.code, FULL_PRODUCT_ERROR_CODES.cardNotFound);
  assert.equal(duplicate.state, valid.state);
  assert.equal(invalidTarget.state, state);
});

test("battle damage resolves, advances turns, and restores energy", () => {
  let state = startGame();
  state = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  state = submitFullProductCommand(state, {
    type: "pass-main",
    playerId: "player-1"
  }).state;
  const declared = submitFullProductCommand(state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "player"
  });
  state = declared.state;
  const resolved = submitFullProductCommand(state, {
    type: "pass-battle",
    playerId: "player-1"
  });
  state = resolved.state;
  const endedTurn = submitFullProductCommand(state, {
    type: "resolve-battle",
    playerId: "player-1"
  });

  assert.equal(endedTurn.error, null);
  assert.equal(endedTurn.state.players[1].life, 1);
  assert.equal(endedTurn.state.activePlayerId, "player-2");
  assert.equal(endedTurn.state.turnNumber, 2);
  assert.equal(endedTurn.state.phase, "main");
  assert.equal(endedTurn.state.players[1].energy, 1);
  assert.deepEqual(endedTurn.state.declaredAttacks, []);
  assert.equal(endedTurn.events.at(-1).type, "phase-advanced");
});

test("battle declaration exposes each legal object target distinctly", () => {
  const state = startGameWithDefenderUnit();
  const actions = listLegalActions(state, "player-1").filter(action =>
    action.type === "declare-attack"
  );

  assert.deepEqual(actions.map(action => action.targetInstanceId), [
    "p2:blocker",
    "player"
  ]);
});

test("full-board and unsupported-type cards are not legal actions", () => {
  const state = startGame();
  const playerOne = state.players[0];
  playerOne.board.push("p1:blocker");
  state.instances["p1:blocker"] = {
    instanceId: "p1:blocker",
    cardId: "card.unit",
    ownerPlayerId: "player-1",
    zone: "board",
    damage: 0,
    attackedThisTurn: false
  };

  const actions = listLegalActions(state, "player-1");
  assert.equal(
    actions.some(action =>
      action.type === "play-card" && action.instanceId === "p1:unit"
    ),
    false
  );
  const result = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  });
  assert.equal(result.error.code, FULL_PRODUCT_ERROR_CODES.zoneCapacityExceeded);
  assert.equal(result.state, state);
});

test("prompt answers are rejected when their state version is stale", () => {
  const state = newGame();
  const stale = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "player-1",
    promptId: state.prompt.promptId,
    optionId: "ready",
    stateVersion: state.prompt.stateVersion + 1
  });
  assert.equal(stale.error.code, FULL_PRODUCT_ERROR_CODES.promptExpired);
  assert.equal(stale.state, state);

  const valid = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "player-1",
    promptId: state.prompt.promptId,
    optionId: "ready",
    stateVersion: state.prompt.stateVersion
  });
  assert.equal(valid.error, null);
});

test("simultaneous object damage accumulates before destruction", () => {
  const state = startGameWithDefenderUnit();
  const playerOne = state.players[0];
  playerOne.board.push("p1:extra-unit");
  state.instances["p1:extra-unit"] = {
    instanceId: "p1:extra-unit",
    cardId: "card.unit",
    ownerPlayerId: "player-1",
    zone: "board",
    damage: 0,
    attackedThisTurn: false
  };
  state.declaredAttacks = [
    { attackerInstanceId: "p1:unit", targetInstanceId: "p2:blocker" },
    { attackerInstanceId: "p1:extra-unit", targetInstanceId: "p2:blocker" }
  ];
  state.phase = "battle";
  state.turnStep = "resolve";
  const result = submitFullProductCommand(state, {
    type: "resolve-battle",
    playerId: "player-1"
  });

  assert.equal(result.error, null);
  assert.deepEqual(state.players[1].discard, []);
  assert.equal(result.state.instances["p2:blocker"].zone, "discard");
  assert.equal(result.state.instances["p2:blocker"].damage, 4);
  assert.equal(result.state.instances["p1:unit"].damage, 2);
  assert.equal(result.state.instances["p1:extra-unit"].damage, 2);
});

test("battle resolution skips attacks whose target was removed before battle", () => {
  const state = startGameWithDefenderUnit();
  const defender = state.players[1];
  defender.board = defender.board.filter(id => id !== "p2:blocker");
  defender.discard.push("p2:blocker");
  state.instances["p2:blocker"].zone = "discard";
  state.declaredAttacks = [
    { attackerInstanceId: "p1:unit", targetInstanceId: "p2:blocker" }
  ];
  state.phase = "battle";
  state.turnStep = "resolve";
  const result = submitFullProductCommand(state, {
    type: "resolve-battle",
    playerId: "player-1"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.instances["p1:unit"].damage, 0);
  assert.equal(
    result.events.some(event => event.type === "damage-dealt"),
    false
  );
});

test("configuration and card instances are validated deterministically", () => {
  assert.throws(
    () => createFullProductGame({ ...newGameConfig(), maximumBoardSize: 0 }),
    /maximumBoardSize/
  );
  assert.throws(
    () => createFullProductGame({ ...newGameConfig(), drawPerTurn: -1 }),
    /drawPerTurn/
  );
  assert.throws(
    () => createFullProductGame({
      ...newGameConfig(),
      players: newGameConfig().players.map(player => ({
        ...player,
        life: 0
      }))
    }),
    /life/
  );
  assert.throws(
    () => createFullProductGame({
      ...newGameConfig(),
      players: newGameConfig().players.map(player => ({
        ...player,
        deck: [{ instanceId: "bad-instance", cardId: "missing-card" }]
      }))
    }),
    /Unknown card definition/
  );
  assert.throws(
    () => createFullProductGame({
      ...newGameConfig(),
      cards: [{
        cardId: "card.unsupported",
        name: "Unsupported",
        cost: 1,
        attack: 1,
        health: 1,
        types: ["rune"]
      }]
    }),
    /unsupported type/
  );
});

test("life reaching zero ends the match and rejects further commands", () => {
  let state = startGame();
  state = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "player-1",
    instanceId: "p1:unit"
  }).state;
  state = submitFullProductCommand(state, {
    type: "pass-main",
    playerId: "player-1"
  }).state;
  state.players[1].life = 2;
  state = submitFullProductCommand(state, {
    type: "declare-attack",
    playerId: "player-1",
    instanceId: "p1:unit",
    targetInstanceId: "player"
  }).state;
  state = submitFullProductCommand(state, {
    type: "pass-battle",
    playerId: "player-1"
  }).state;
  const ended = submitFullProductCommand(state, {
    type: "resolve-battle",
    playerId: "player-1"
  });

  assert.equal(ended.state.phase, "ended");
  assert.equal(ended.state.winnerPlayerId, "player-1");
  assert.equal(ended.state.eventLog.at(-1).type, "game-ended");
  assert.deepEqual(listLegalActions(ended.state, "player-1"), []);
  const afterEnd = submitFullProductCommand(ended.state, {
    type: "pass-main",
    playerId: "player-1"
  });
  assert.equal(afterEnd.error.code, FULL_PRODUCT_ERROR_CODES.gameEnded);
  assert.equal(afterEnd.state, ended.state);
});
