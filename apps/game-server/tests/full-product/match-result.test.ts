import { describe, expect, it } from "vitest";
import {
  createFullProductGame,
  FULL_PRODUCT_ERROR_CODES,
  listLegalActions,
  submitFullProductCommand,
  type FullProductCommand,
  type FullProductCommandResult,
  type FullProductGameConfig,
  type FullProductGameState,
  type FullProductLegalAction
} from "../../../../packages/engine-core/src/full-product/runtime.js";

const players = [
  {
    playerId: "player-1",
    name: "Alice",
    life: 2,
    maximumEnergy: 1,
    deck: [{ instanceId: "player-1:deck:1", cardId: "fixture.unit" }],
    startingHand: [
      { instanceId: "player-1:hand:1", cardId: "fixture.unit" }
    ]
  },
  {
    playerId: "player-2",
    name: "Bob",
    life: 2,
    maximumEnergy: 1,
    deck: [{ instanceId: "player-2:deck:1", cardId: "fixture.unit" }],
    startingHand: [
      { instanceId: "player-2:hand:1", cardId: "fixture.unit" }
    ]
  }
];

const config: FullProductGameConfig = {
  players,
  cards: [
    {
      cardId: "fixture.unit",
      name: "Fixture Unit",
      cost: 0,
      attack: 2,
      health: 1,
      types: ["unit"]
    }
  ],
  firstPlayerId: "player-1",
  maximumBoardSize: 6,
  drawPerTurn: 1
};

function apply(
  state: FullProductGameState,
  command: FullProductCommand
): FullProductCommandResult {
  const result = submitFullProductCommand(state, command);
  expect(result.error).toBeNull();
  return result;
}

function legalAction(
  state: FullProductGameState,
  playerId: string,
  type: FullProductLegalAction["type"],
  targetInstanceId?: string
): FullProductLegalAction {
  const action = listLegalActions(state, playerId).find(action =>
    action.type === type &&
    (targetInstanceId === undefined || action.targetInstanceId === targetInstanceId)
  );
  if (!action) {
    throw new Error(
      `Expected ${playerId} legal action ${type}` +
      (targetInstanceId === undefined ? "" : ` -> ${targetInstanceId}`)
    );
  }
  return action;
}

function answerReady(
  state: FullProductGameState,
  playerId: string
): FullProductCommandResult {
  const action = legalAction(state, playerId, "answer-prompt");
  return apply(state, {
    type: "answer-prompt",
    playerId,
    promptId: action.promptId,
    optionId: action.optionId ?? "ready"
  });
}

describe("full product match result", () => {
  it("reaches a deterministic winner through only legal commands and server-visible actions", () => {
    let state = createFullProductGame(config);

    state = answerReady(state, "player-1").state;
    state = answerReady(state, "player-2").state;

    const aliceAction = legalAction(state, "player-1", "play-card");
    state = apply(state, {
      type: "play-card",
      playerId: "player-1",
      instanceId: aliceAction.instanceId ?? ""
    }).state;

    state = apply(state, {
      type: "pass-main",
      playerId: "player-1"
    }).state;

    const attack = legalAction(state, "player-1", "declare-attack", "player");
    state = apply(state, {
      type: "declare-attack",
      playerId: "player-1",
      instanceId: attack.instanceId ?? "",
      targetInstanceId: "player"
    }).state;
    state = apply(state, {
      type: "pass-battle",
      playerId: "player-1"
    }).state;

    const result = apply(state, {
      type: "resolve-battle",
      playerId: "player-1"
    });
    state = result.state;

    expect(result.events.some(event => event.type === "player-damaged")).toBe(true);
    expect(state.phase).toBe("ended");
    expect(state.winnerPlayerId).toBe("player-1");
    expect(state.players.map(player => player.life)).toEqual([2, 0]);
    const ended = state.eventLog.at(-1);
    expect(ended).toMatchObject({
      type: "game-ended",
      winnerPlayerId: "player-1"
    });
    expect(state.eventSeq).toBe(ended?.seq);
    expect(listLegalActions(state, "player-1")).toEqual([]);
    expect(listLegalActions(state, "player-2")).toEqual([]);

    const afterEnd = submitFullProductCommand(state, {
      type: "pass-main",
      playerId: "player-1"
    });
    expect(afterEnd.error?.code).toBe(FULL_PRODUCT_ERROR_CODES.gameEnded);
    expect(afterEnd.state).toBe(state);
    expect(afterEnd.events).toEqual([]);
  });

  it("keeps setup prompts authoritative and rejects an out-of-turn command before setup completes", () => {
    let state = createFullProductGame(config);
    expect(state.phase).toBe("setup");
    expect(state.prompt?.playerId).toBe("player-1");
    expect(listLegalActions(state, "player-2")).toEqual([]);

    const rejected = submitFullProductCommand(state, {
      type: "pass-main",
      playerId: "player-1"
    });
    expect(rejected.error?.code).toBe(FULL_PRODUCT_ERROR_CODES.promptRequired);
    expect(rejected.state).toBe(state);
    expect(rejected.events).toEqual([]);

    state = answerReady(state, "player-1").state;
    expect(state.prompt?.playerId).toBe("player-2");

    const wrongPlayer = submitFullProductCommand(state, {
      type: "answer-prompt",
      playerId: "player-1",
      promptId: state.prompt.promptId,
      optionId: "ready"
    });
    expect(wrongPlayer.error?.code).toBe(FULL_PRODUCT_ERROR_CODES.promptRequired);

    state = answerReady(state, "player-2").state;
    expect(state.prompt).toBeNull();
    expect(state.phase).toBe("main");
    expect(state.turnNumber).toBe(1);
    expect(state.players.map(player => player.energy)).toEqual([1, 0]);
  });
});
