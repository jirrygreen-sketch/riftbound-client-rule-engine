import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_PRODUCT_ERROR_CODES,
  createFullProductGame,
  listLegalActions,
  submitFullProductCommand
} from "../../dist/full-product/runtime.js";

const unitCard = {
  cardId: "unit.test",
  name: "Contract Unit",
  cost: 1,
  attack: 2,
  health: 2,
  types: ["unit"]
};

const expensiveUnitCard = {
  cardId: "unit.expensive",
  name: "Expensive Contract Unit",
  cost: 3,
  attack: 1,
  health: 1,
  types: ["unit"]
};

const lethalUnitCard = {
  cardId: "unit.lethal",
  name: "Lethal Contract Unit",
  cost: 1,
  attack: 3,
  health: 1,
  types: ["unit"]
};

const spellCard = {
  cardId: "spell.test",
  name: "Contract Spell",
  cost: 0,
  attack: 0,
  health: 1,
  types: ["spell"]
};

const cards = [
  unitCard,
  expensiveUnitCard,
  lethalUnitCard,
  spellCard
];

function baseConfig() {
  return {
    players: [
      {
        playerId: "p1",
        name: "Player One",
        life: 10,
        maximumEnergy: 2,
        deck: [],
        startingHand: [
          { instanceId: "p1:unit-a", cardId: "unit.test" },
          { instanceId: "p1:unit-b", cardId: "unit.test" },
          { instanceId: "p1:expensive", cardId: "unit.expensive" },
          { instanceId: "p1:spell", cardId: "spell.test" }
        ]
      },
      {
        playerId: "p2",
        name: "Player Two",
        life: 10,
        maximumEnergy: 2,
        deck: [],
        startingHand: [
          { instanceId: "p2:unit", cardId: "unit.test" }
        ]
      }
    ],
    cards,
    firstPlayerId: "p1",
    maximumBoardSize: 2,
    drawPerTurn: 1
  };
}

function startReadyGame(config) {
  let state = createFullProductGame(config);
  for (const playerId of ["p1", "p2"]) {
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

function completeAttackTurn(
  state,
  playerId,
  playableInstanceId,
  instanceId,
  targetInstanceId = "player"
) {
  let turnState = state;
  if (playableInstanceId !== undefined) {
    const played = submitFullProductCommand(state, {
      type: "play-card",
      playerId,
      instanceId: playableInstanceId
    });
    assert.equal(played.error, null);
    turnState = played.state;
  }
  const passedMain = submitFullProductCommand(turnState, {
    type: "pass-main",
    playerId
  });
  assert.equal(passedMain.error, null);

  const declared = submitFullProductCommand(passedMain.state, {
    type: "declare-attack",
    playerId,
    instanceId,
    targetInstanceId
  });
  assert.equal(declared.error, null);

  const passedBattle = submitFullProductCommand(declared.state, {
    type: "pass-battle",
    playerId
  });
  assert.equal(passedBattle.error, null);

  const resolved = submitFullProductCommand(passedBattle.state, {
    type: "resolve-battle",
    playerId
  });
  assert.equal(resolved.error, null);
  return resolved.state;
}

function assertFailurePreservedState(result, state, before) {
  assert.equal(result.state, state);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.events, []);
}

test("ready prompt ownership, prompt identity, and state version are enforced", () => {
  const config = structuredClone(baseConfig());
  const state = createFullProductGame(config);
  const before = structuredClone(state);

  assert.equal(state.prompt.playerId, "p1");
  assert.equal(state.prompt.stateVersion, state.version);
  assert.deepEqual(listLegalActions(state, "p1"), [
    {
      type: "answer-prompt",
      playerId: "p1",
      promptId: state.prompt.promptId,
      optionId: "ready"
    }
  ]);
  assert.deepEqual(listLegalActions(state, "p2"), []);

  const wrongOwner = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "p2",
    promptId: state.prompt.promptId,
    optionId: "ready"
  });
  const staleVersion = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "p1",
    promptId: state.prompt.promptId,
    optionId: "ready",
    stateVersion: state.prompt.stateVersion + 1
  });
  const wrongPromptId = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "p1",
    promptId: "prompt:not-active",
    optionId: "ready"
  });
  const invalidOption = submitFullProductCommand(state, {
    type: "answer-prompt",
    playerId: "p1",
    promptId: state.prompt.promptId,
    optionId: "not-ready"
  });

  assert.equal(wrongOwner.error.code, FULL_PRODUCT_ERROR_CODES.promptRequired);
  assert.equal(staleVersion.error.code, FULL_PRODUCT_ERROR_CODES.promptExpired);
  assert.equal(wrongPromptId.error.code, FULL_PRODUCT_ERROR_CODES.promptNotFound);
  assert.equal(invalidOption.error.code, FULL_PRODUCT_ERROR_CODES.invalidPromptAnswer);
  for (const result of [wrongOwner, staleVersion, wrongPromptId, invalidOption]) {
    assertFailurePreservedState(result, state, before);
  }
});

test("invalid commands never mutate state or emit partial events", () => {
  const config = structuredClone(baseConfig());
  const state = startReadyGame(config);
  const before = structuredClone(state);

  const invalidCommands = [
    { type: "unknown-command", playerId: "p1" },
    { type: "play-card", playerId: "ghost", instanceId: "p1:unit-a" },
    { type: "play-card", playerId: "p1", instanceId: "missing-instance" },
    { type: "play-card", playerId: "p1", instanceId: "p1:expensive" },
    { type: "pass-battle", playerId: "p1" },
    { type: "resolve-battle", playerId: "p1" },
    { type: "confirm-setup", playerId: "p1" },
    { type: "answer-prompt", playerId: "p1", promptId: "missing", optionId: "ready" }
  ];

  const expectedCodes = [
    FULL_PRODUCT_ERROR_CODES.invalidCommand,
    FULL_PRODUCT_ERROR_CODES.invalidCommand,
    FULL_PRODUCT_ERROR_CODES.cardNotFound,
    FULL_PRODUCT_ERROR_CODES.notEnoughEnergy,
    FULL_PRODUCT_ERROR_CODES.invalidCommand,
    FULL_PRODUCT_ERROR_CODES.invalidCommand,
    FULL_PRODUCT_ERROR_CODES.invalidCommand,
    FULL_PRODUCT_ERROR_CODES.promptNotFound
  ];

  for (const [index, command] of invalidCommands.entries()) {
    const result = submitFullProductCommand(state, command);
    assert.equal(result.error.code, expectedCodes[index]);
    assertFailurePreservedState(result, state, before);
  }
});

test("board capacity removes unit actions but still permits spells", () => {
  const config = structuredClone(baseConfig());
  config.maximumBoardSize = 1;
  const state = startReadyGame(config);

  assert.deepEqual(listLegalActions(state, "p1"), [
    { type: "pass-main", playerId: "p1" },
    { type: "play-card", playerId: "p1", instanceId: "p1:unit-a" },
    { type: "play-card", playerId: "p1", instanceId: "p1:unit-b" },
    { type: "play-card", playerId: "p1", instanceId: "p1:spell" }
  ]);

  const played = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "p1",
    instanceId: "p1:unit-a"
  });
  assert.equal(played.error, null);
  assert.deepEqual(played.state.players[0].board, ["p1:unit-a"]);

  assert.deepEqual(listLegalActions(played.state, "p1"), [
    { type: "pass-main", playerId: "p1" },
    { type: "play-card", playerId: "p1", instanceId: "p1:spell" }
  ]);

  const before = structuredClone(played.state);
  const capacityFailure = submitFullProductCommand(played.state, {
    type: "play-card",
    playerId: "p1",
    instanceId: "p1:unit-b"
  });
  assert.equal(capacityFailure.error.code, FULL_PRODUCT_ERROR_CODES.zoneCapacityExceeded);
  assertFailurePreservedState(capacityFailure, played.state, before);

  const spell = submitFullProductCommand(played.state, {
    type: "play-card",
    playerId: "p1",
    instanceId: "p1:spell"
  });
  assert.equal(spell.error, null);
  assert.deepEqual(spell.state.players[0].discard, ["p1:spell"]);
  assert.equal(spell.state.instances["p1:spell"].zone, "discard");
});

test("draw exhaustion stops without synthesizing draw events", () => {
  const config = structuredClone(baseConfig());
  config.drawPerTurn = 2;
  config.players[0].deck = [
    { instanceId: "p1:draw-once", cardId: "spell.test" }
  ];
  config.players[1].deck = [];

  const firstTurn = startReadyGame(config);
  assert.equal(
    firstTurn.eventLog.filter(event => event.type === "card-drawn").length,
    1
  );
  assert.deepEqual(firstTurn.players[0].deck, []);

  const afterPlayerOneTurn = completeAttackTurn(
    firstTurn,
    "p1",
    "p1:unit-a",
    "p1:unit-a"
  );
  const afterPlayerTwoTurn = completeAttackTurn(
    afterPlayerOneTurn,
    "p2",
    "p2:unit",
    "p2:unit"
  );
  const secondPlayerOneTurn = completeAttackTurn(
    afterPlayerTwoTurn,
    "p1",
    "p1:unit-b",
    "p1:unit-a"
  );

  assert.equal(
    secondPlayerOneTurn.eventLog.filter(event => event.type === "card-drawn").length,
    1
  );
  assert.deepEqual(secondPlayerOneTurn.players[0].deck, []);
  assert.equal(secondPlayerOneTurn.turnNumber, 4);
  assert.equal(secondPlayerOneTurn.activePlayerId, "p2");
  assert.deepEqual(secondPlayerOneTurn.players[0].board, [
    "p1:unit-a",
    "p1:unit-b"
  ]);
});

test("a full turn emits ordered, versioned runtime events", () => {
  const config = structuredClone(baseConfig());
  config.players[0].startingHand = [
    { instanceId: "p1:unit-a", cardId: "unit.test" }
  ];
  config.players[1].startingHand = [];
  const state = startReadyGame(config);
  const beforeSeq = state.eventSeq;

  const played = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "p1",
    instanceId: "p1:unit-a"
  });
  const passedMain = submitFullProductCommand(played.state, {
    type: "pass-main",
    playerId: "p1"
  });
  const declared = submitFullProductCommand(passedMain.state, {
    type: "declare-attack",
    playerId: "p1",
    instanceId: "p1:unit-a",
    targetInstanceId: "player"
  });
  const passedBattle = submitFullProductCommand(declared.state, {
    type: "pass-battle",
    playerId: "p1"
  });
  const resolved = submitFullProductCommand(passedBattle.state, {
    type: "resolve-battle",
    playerId: "p1"
  });

  assert.equal(played.error, null);
  assert.equal(passedMain.error, null);
  assert.equal(declared.error, null);
  assert.equal(passedBattle.error, null);
  assert.equal(resolved.error, null);

  const events = [
    ...played.events,
    ...passedMain.events,
    ...declared.events,
    ...passedBattle.events,
    ...resolved.events
  ];
  assert.deepEqual(events.map(event => event.type), [
    "zone-changed",
    "card-played",
    "phase-advanced",
    "battle-declared",
    "phase-advanced",
    "player-damaged",
    "phase-advanced",
    "turn-ended",
    "phase-advanced",
    "turn-started",
    "energy-refreshed",
    "phase-advanced"
  ]);
  assert.equal(events.length, 12);
  assert.ok(events.every((event, index) =>
    event.seq === beforeSeq + index + 1
  ));
  assert.ok(events.every(event => event.version === event.seq));
});

test("the turn loop alternates players and resets per-turn attack state", () => {
  const config = structuredClone(baseConfig());
  config.players[0].startingHand = [
    { instanceId: "p1:unit-a", cardId: "unit.test" }
  ];
  config.players[1].startingHand = [
    { instanceId: "p2:unit", cardId: "unit.test" }
  ];
  const state = startReadyGame(config);

  const afterPlayerOne = completeAttackTurn(
    state,
    "p1",
    "p1:unit-a",
    "p1:unit-a"
  );
  assert.equal(afterPlayerOne.turnNumber, 2);
  assert.equal(afterPlayerOne.activePlayerId, "p2");
  assert.equal(afterPlayerOne.priorityPlayerId, "p2");
  assert.equal(afterPlayerOne.phase, "main");
  assert.equal(afterPlayerOne.players[0].energy, 1);
  assert.equal(afterPlayerOne.instances["p1:unit-a"].attackedThisTurn, false);
  assert.deepEqual(afterPlayerOne.declaredAttacks, []);

  const afterPlayerTwo = completeAttackTurn(
    afterPlayerOne,
    "p2",
    "p2:unit",
    "p2:unit"
  );
  assert.equal(afterPlayerTwo.turnNumber, 3);
  assert.equal(afterPlayerTwo.activePlayerId, "p1");
  assert.equal(afterPlayerTwo.priorityPlayerId, "p1");
  assert.equal(afterPlayerTwo.phase, "main");
  assert.equal(afterPlayerTwo.players[1].energy, 1);
  assert.equal(afterPlayerTwo.instances["p2:unit"].attackedThisTurn, false);
  assert.deepEqual(afterPlayerTwo.declaredAttacks, []);
  assert.deepEqual(afterPlayerTwo.players[0].board, ["p1:unit-a"]);
  assert.deepEqual(afterPlayerTwo.players[1].board, ["p2:unit"]);
});

test("lethal damage ends the match and freezes further commands", () => {
  const config = structuredClone(baseConfig());
  config.players[0].startingHand = [
    { instanceId: "p1:lethal", cardId: "unit.lethal" }
  ];
  config.players[1].startingHand = [];
  config.players[1].life = 3;
  const state = startReadyGame(config);

  const played = submitFullProductCommand(state, {
    type: "play-card",
    playerId: "p1",
    instanceId: "p1:lethal"
  });
  const passedMain = submitFullProductCommand(played.state, {
    type: "pass-main",
    playerId: "p1"
  });
  const declared = submitFullProductCommand(passedMain.state, {
    type: "declare-attack",
    playerId: "p1",
    instanceId: "p1:lethal",
    targetInstanceId: "player"
  });
  const passedBattle = submitFullProductCommand(declared.state, {
    type: "pass-battle",
    playerId: "p1"
  });
  const resolved = submitFullProductCommand(passedBattle.state, {
    type: "resolve-battle",
    playerId: "p1"
  });

  assert.equal(resolved.error, null);
  assert.equal(resolved.state.phase, "ended");
  assert.equal(resolved.state.turnStep, "end");
  assert.equal(resolved.state.winnerPlayerId, "p1");
  assert.equal(resolved.state.prompt, null);
  assert.deepEqual(resolved.state.declaredAttacks, []);
  assert.equal(resolved.state.eventLog.at(-1).type, "game-ended");
  assert.deepEqual(listLegalActions(resolved.state, "p1"), []);
  assert.deepEqual(listLegalActions(resolved.state, "p2"), []);

  const before = structuredClone(resolved.state);
  const afterEnd = submitFullProductCommand(resolved.state, {
    type: "pass-main",
    playerId: "p1"
  });
  assert.equal(afterEnd.error.code, FULL_PRODUCT_ERROR_CODES.gameEnded);
  assertFailurePreservedState(afterEnd, resolved.state, before);
});
