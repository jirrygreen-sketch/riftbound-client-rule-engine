import {
  ENGINE_ERRORS,
  TRIGGER_CONQUER_CARD,
  isCommand
} from "@riftbound/protocol";
import type {
  Command,
  EngineError,
  GameEvent,
  GameProjection,
  PlayerId,
  PlayerProjection,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";
import type { GameState, PlayerState } from "./state.js";

export type { GameState, OutstandingTask, PlayerState } from "./state.js";
export type {
  CardInstance,
  Command,
  EngineError,
  GameEvent,
  GameProjection,
  PlayerCommand,
  PlayerId,
  PlayerProjection,
  Prompt,
  PromptOption,
  RoomSnapshot
} from "@riftbound/protocol";

export interface CreateGameOptions {
  players: readonly {
    id: PlayerId;
    name: string;
  }[];
}

export interface CommandResult {
  state: GameState;
  events: readonly GameEvent[];
  error: EngineError | null;
}

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;
type GameEventInput = DistributiveOmit<
  GameEvent,
  "seq" | "turnNumber" | "activePlayerId"
>;

/**
 * This package implements a deliberately narrow synthetic-demo ruleset. It is
 * not a complete implementation of the official game rules.
 */
export function createInitialGame(options: CreateGameOptions): GameState {
  if (options.players.length !== 2) {
    throw new Error("createInitialGame requires exactly two players");
  }
  if (new Set(options.players.map(player => player.id)).size !== 2 ||
      options.players.some(player => !player.id || !player.name.trim())) {
    throw new Error("Players must have unique nonempty identities");
  }

  const players: PlayerState[] = options.players.map((player) => ({
    id: player.id,
    name: player.name,
    life: 20,
    mana: 1,
    hand: [
      {
        instanceId: `${player.id}:trigger-conquer`,
        cardId: TRIGGER_CONQUER_CARD.id
      }
    ]
  }));

  const state: GameState = {
    version: 1,
    eventSeq: 0,
    turnNumber: 1,
    phase: "main",
    activePlayerId: players[0]!.id,
    winnerPlayerId: null,
    players,
    prompt: null,
    outstandingTasks: [],
    eventLog: []
  };

  appendEvent(state, {
    type: "game-started",
    playerIds: players.map((player) => player.id)
  });
  appendEvent(state, {
    type: "turn-started",
    playerId: players[0]!.id,
    mana: players[0]!.mana
  });
  return state;
}

export function submitCommand(
  currentState: GameState,
  command: Command
): CommandResult {
  if (!isCommand(command)) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "The command is not valid for this ruleset."
    });
  }

  if (currentState.phase === "ended") {
    return failure(currentState, {
      code: ENGINE_ERRORS.gameEnded,
      message: "The game has already ended."
    });
  }

  /*
   * The working copy is the transaction. Any error discards it and returns
   * the exact authoritative input object, with no sequence or version bump.
   */
  const state = cloneState(currentState);
  const startingSeq = state.eventSeq;
  const startingVersion = state.version;

  const error = applyCommand(state, command);
  if (error) {
    return failure(currentState, error);
  }

  processOutstandingTasks(state);
  checkGameEnd(state);

  if (state.phase === "ended" && (state.prompt !== null || state.outstandingTasks.length > 0)) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "Engine transaction produced an invalid state."
    });
  }

  if (state.version < startingVersion || state.eventSeq < startingSeq) {
    return failure(currentState, {
      code: ENGINE_ERRORS.invalidCommand,
      message: "Engine transaction produced an invalid state."
    });
  }

  return {
    state,
    events: state.eventLog.filter((event) => event.seq > startingSeq),
    error: null
  };
}

function applyCommand(state: GameState, command: Command): EngineError | null {
  if (state.prompt) {
    if (command.type !== "respond-to-prompt") {
      return {
        code: ENGINE_ERRORS.promptRequired,
        message: "A prompt must be answered before other commands."
      };
    }

    return answerPrompt(state, command);
  }

  switch (command.type) {
    case "pass":
      return passTurn(state, command);
    case "play-card":
      return playCard(state, command);
    case "respond-to-prompt":
      return {
        code: ENGINE_ERRORS.promptNotFound,
        message: "There is no active prompt to answer."
      };
  }
}

export function projectGame(
  state: GameState,
  viewerPlayerId: PlayerId | null = null
): GameProjection {
  const prompt = state.prompt;
  const viewerPrompt = prompt && prompt.ownerPlayerId === viewerPlayerId
    ? projectPrompt(prompt)
    : null;

  return {
    version: state.version,
    eventSeq: state.eventSeq,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    winnerPlayerId: state.winnerPlayerId,
    prompt: viewerPrompt,
    waitingForPlayerId: prompt?.ownerPlayerId ?? null,
    players: state.players.map((player) => projectPlayer(player, viewerPlayerId)),
    events: state.eventLog
      .filter(event => isEventVisibleTo(event, viewerPlayerId))
      .map(event => structuredClone(event))
  };
}

export function createRoomSnapshot(
  state: GameState,
  roomId: string,
  viewerPlayerId: PlayerId | null = null
): RoomSnapshot {
  return {
    roomId,
    status: state.phase === "ended" ? "ended" : "playing",
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: true
    })),
    version: state.version,
    eventSeq: state.eventSeq,
    projection: projectGame(state, viewerPlayerId)
  };
}

function appendEvent(
  state: GameState,
  event: GameEventInput
): GameEvent {
  state.eventSeq += 1;
  const fullEvent = {
    ...event,
    seq: state.eventSeq,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId
  } as GameEvent;

  state.eventLog.push(fullEvent);
  state.version += 1;
  return fullEvent;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function failure(state: GameState, error: EngineError): CommandResult {
  return {
    state,
    events: [],
    error
  };
}

function requireActivePlayer(
  state: GameState,
  playerId: PlayerId
): EngineError | null {
  if (state.activePlayerId !== playerId) {
    return {
      code: ENGINE_ERRORS.notYourTurn,
      message: `It is not ${playerId}'s turn.`
    };
  }

  return null;
}

function passTurn(
  state: GameState,
  command: Extract<Command, { type: "pass" }>
): EngineError | null {
  const activeError = requireActivePlayer(state, command.playerId);
  if (activeError) {
    return activeError;
  }

  appendEvent(state, {
    type: "turn-passed",
    playerId: command.playerId
  });

  const nextPlayer = state.players.find(
    (player) => player.id !== state.activePlayerId
  )!;
  state.activePlayerId = nextPlayer.id;
  state.turnNumber += 1;
  nextPlayer.mana = Math.min(10, nextPlayer.mana + 1);
  appendEvent(state, {
    type: "turn-started",
    playerId: nextPlayer.id,
    mana: nextPlayer.mana
  });

  return null;
}

function playCard(
  state: GameState,
  command: Extract<Command, { type: "play-card" }>
): EngineError | null {
  const activeError = requireActivePlayer(state, command.playerId);
  if (activeError) {
    return activeError;
  }

  const player = getPlayer(state, command.playerId);
  const cardIndex = player.hand.findIndex(
    (card) => card.instanceId === command.instanceId
  );
  if (cardIndex === -1) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Card instance ${command.instanceId} is not in the player's hand.`
    };
  }

  const card = player.hand[cardIndex]!;
  if (card.cardId !== TRIGGER_CONQUER_CARD.id) {
    return {
      code: ENGINE_ERRORS.cardNotFound,
      message: `Unsupported card ${card.cardId}.`
    };
  }
  if (player.mana < TRIGGER_CONQUER_CARD.cost) {
    return {
      code: ENGINE_ERRORS.notEnoughMana,
      message: "The player does not have enough mana."
    };
  }

  player.hand.splice(cardIndex, 1);
  player.mana -= TRIGGER_CONQUER_CARD.cost;
  appendEvent(state, {
    type: "card-played",
    playerId: player.id,
    instanceId: card.instanceId,
    cardId: card.cardId
  });

  const playSeq = state.eventSeq;
  state.outstandingTasks.push(
    {
      id: `task:${card.instanceId}:mandatory:${playSeq}`,
      sourceCardId: card.cardId,
      reason: "resolve-card",
      optional: false
    },
    {
      id: `task:${card.instanceId}:trigger:${playSeq}`,
      sourceCardId: card.cardId,
      reason: "trigger-conquer",
      optional: true
    }
  );
  return null;
}

function answerPrompt(
  state: GameState,
  command: Extract<Command, { type: "respond-to-prompt" }>
): EngineError | null {
  const prompt = state.prompt;
  if (!prompt || prompt.id !== command.promptId) {
    return {
      code: ENGINE_ERRORS.promptNotFound,
      message: `Prompt ${command.promptId} is not active.`
    };
  }
  if (prompt.ownerPlayerId !== command.playerId ||
      prompt.playerId !== command.playerId) {
    return {
      code: ENGINE_ERRORS.notYourTurn,
      message: "Only the prompt owner may answer this prompt."
    };
  }
  if (command.stateVersion !== undefined &&
      command.stateVersion !== prompt.stateVersion) {
    return {
      code: ENGINE_ERRORS.promptExpired,
      message: "The prompt response was created for a different state version."
    };
  }
  if (prompt.stateVersion !== state.version) {
    return {
      code: ENGINE_ERRORS.promptExpired,
      message: "The prompt has expired."
    };
  }
  if (!prompt.options.some((option) => option.id === command.optionId)) {
    return {
      code: ENGINE_ERRORS.invalidPromptAnswer,
      message: `Option ${command.optionId} is not valid for this prompt.`
    };
  }

  appendEvent(state, {
    type: "prompt-answered",
    promptId: prompt.id,
    playerId: prompt.ownerPlayerId,
    optionId: command.optionId
  });

  const task = state.outstandingTasks.find(
    (candidate) => candidate.id === prompt.taskId
  );
  if (command.optionId === "resolve") {
    const target = state.players.find(
      (player) => player.id !== state.activePlayerId
    )!;
    target.life -= 1;
    appendEvent(state, {
      type: "damage-dealt",
      sourceCardId: task?.sourceCardId ?? "unknown",
      sourcePlayerId: state.activePlayerId,
      targetPlayerId: target.id,
      amount: 1
    });
  } else {
    appendEvent(state, {
      type: "trigger-skipped",
      taskId: task?.id ?? "unknown",
      sourceCardId: task?.sourceCardId ?? "unknown"
    });
  }

  state.prompt = null;
  state.outstandingTasks = state.outstandingTasks.filter(
    (candidate) => candidate.id !== prompt.taskId
  );
  return null;
}

function processOutstandingTasks(state: GameState): void {
  while (!state.prompt && state.outstandingTasks.length > 0) {
    const task = state.outstandingTasks[0]!;

    if (!task.optional) {
      state.outstandingTasks.shift();
      appendEvent(state, {
        type: "task-resolved",
        taskId: task.id,
        sourceCardId: task.sourceCardId,
        reason: task.reason,
        autoResolved: true
      });
      continue;
    }

    const options: PromptOption[] = [
      { id: "resolve", label: "Resolve trigger" },
      { id: "skip", label: "Skip trigger" }
    ];
    const prompt: Prompt = {
      id: `prompt:${task.id}`,
      ownerPlayerId: state.activePlayerId,
      playerId: state.activePlayerId,
      stateVersion: state.version + 1,
      status: "pending",
      taskId: task.id,
      reason: task.reason,
      optional: task.optional,
      options
    };

    state.prompt = prompt;
    appendEvent(state, {
      type: "prompt-created",
      promptId: prompt.id,
      playerId: prompt.ownerPlayerId,
      reason: prompt.reason,
      optional: prompt.optional
    });
  }
}

function checkGameEnd(state: GameState): void {
  if (state.phase === "ended") {
    return;
  }

  const defeatedPlayer = state.players.find((player) => player.life <= 0);
  if (!defeatedPlayer) {
    return;
  }

  const winner = state.players.find((player) => player.id !== defeatedPlayer.id)!;
  state.phase = "ended";
  state.winnerPlayerId = winner.id;
  appendEvent(state, {
    type: "game-ended",
    winnerPlayerId: winner.id
  });

  state.prompt = null;
  state.outstandingTasks = [];
}

function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  return state.players.find((player) => player.id === playerId)!;
}

function projectPlayer(
  player: PlayerState,
  viewerPlayerId: PlayerId | null
): PlayerProjection {
  const hand = viewerPlayerId === player.id
    ? player.hand.map(card => ({ ...card }))
    : [];

  return {
    id: player.id,
    name: player.name,
    life: player.life,
    mana: player.mana,
    handCount: player.hand.length,
    hand
  };
}

function projectPrompt(prompt: Prompt): Prompt {
  return {
    id: prompt.id,
    ownerPlayerId: prompt.ownerPlayerId,
    playerId: prompt.playerId,
    stateVersion: prompt.stateVersion,
    status: prompt.status,
    taskId: prompt.taskId,
    reason: prompt.reason,
    optional: prompt.optional,
    options: prompt.options.map(option => ({ ...option }))
  };
}

function isEventVisibleTo(
  event: GameEvent,
  viewerPlayerId: PlayerId | null
): boolean {
  if (event.type === "prompt-created" || event.type === "prompt-answered") {
    return event.playerId === viewerPlayerId;
  }

  return true;
}
