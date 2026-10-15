import { ENGINE_ERRORS, FOUNDATION_RULESET_ID } from "@riftbound/protocol";
import type { EngineError, GameEvent, PlayerId } from "@riftbound/protocol";
import type {
  EngineCardDefinition,
  FoundationGameState,
  GameState,
  PlayerState,
  SyntheticGameState,
  SyntheticPlayerState
} from "../state.js";
import { SYNTHETIC_RULESET_ID } from "./constants.js";
import type { CommandResult, GameEventInput } from "./contracts.js";

export function requireSyntheticGame(state: GameState): SyntheticGameState {
  if (state.rules.rulesetId !== SYNTHETIC_RULESET_ID) {
    throw new Error("This command requires synthetic-demo state");
  }
  return state as SyntheticGameState;
}

export function requireFoundationGame(state: GameState): FoundationGameState {
  if (state.rules.rulesetId !== FOUNDATION_RULESET_ID) {
    throw new Error("This command requires riftbound-foundation state");
  }
  return state as FoundationGameState;
}

export function getSyntheticPlayer(
  state: SyntheticGameState,
  playerId: PlayerId
): SyntheticPlayerState {
  const player = state.players.find(
    candidate => candidate.id === playerId
  );
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  return player;
}

export function requireActivePlayer(
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

export function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  return requirePlayer(state, playerId);
}

export function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find(player => player.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} is not in this game`);
  }
  return player;
}

export function opponentId(state: GameState, playerId: PlayerId): PlayerId {
  return state.players.find(player => player.id !== playerId)!.id;
}

export function getDefinition(
  state: GameState,
  cardId: string
): EngineCardDefinition | undefined {
  return state.cards[cardId];
}

export function objectExists(state: GameState, instanceId: string): boolean {
  return Boolean(state.objects[instanceId]);
}

export function appendEvent(
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

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function failure(state: GameState, error: EngineError): CommandResult {
  return { state, events: [], error };
}

export function requireNonNegativeInteger(
  value: number,
  name: string
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
}

export function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function requireDefinition(
  cards: ReadonlyMap<string, EngineCardDefinition>,
  cardId: string
): EngineCardDefinition {
  const definition = cards.get(cardId);
  if (!definition) {
    throw new Error(`Unknown card definition ${cardId}`);
  }
  return definition;
}
