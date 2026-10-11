export type PlayerId = string;
export type RoomId = string;

export type GamePhase = "main" | "ended";

export interface PlayerIdentity {
  id: PlayerId;
  name: string;
}

export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
}

export interface PassPlayerCommand {
  type: "pass";
}

export interface PlayCardPlayerCommand {
  type: "play-card";
  instanceId: string;
}

export interface RespondToPromptPlayerCommand {
  type: "respond-to-prompt";
  promptId: string;
  optionId: string;
  /**
   * Optional optimistic-concurrency check for the prompt state version.
   */
  stateVersion?: number;
}

/**
 * A command submitted by a client. The actor is derived from the
 * authenticated session and is intentionally not part of this type.
 */
export type PlayerCommand =
  | PassPlayerCommand
  | PlayCardPlayerCommand
  | RespondToPromptPlayerCommand;

type CommandWithActor<T extends PlayerCommand> = T & {
  playerId: PlayerId;
};

/**
 * A command executed by the engine after the server has attached an
 * authoritative actor to a client command.
 */
export type Command =
  | CommandWithActor<PassPlayerCommand>
  | CommandWithActor<PlayCardPlayerCommand>
  | CommandWithActor<RespondToPromptPlayerCommand>;

export type CommandName = Command["type"];

export interface BaseEvent {
  seq: number;
  turnNumber: number;
  activePlayerId: PlayerId;
}

export interface GameStartedEvent extends BaseEvent {
  type: "game-started";
  playerIds: readonly PlayerId[];
}

export interface TurnStartedEvent extends BaseEvent {
  type: "turn-started";
  playerId: PlayerId;
  mana: number;
}

export interface CardPlayedEvent extends BaseEvent {
  type: "card-played";
  playerId: PlayerId;
  instanceId: string;
  cardId: string;
}

export interface PromptCreatedEvent extends BaseEvent {
  type: "prompt-created";
  promptId: string;
  playerId: PlayerId;
  reason: string;
  optional: boolean;
}

export interface PromptAnsweredEvent extends BaseEvent {
  type: "prompt-answered";
  promptId: string;
  playerId: PlayerId;
  optionId: string;
}

export interface DamageDealtEvent extends BaseEvent {
  type: "damage-dealt";
  sourceCardId: string;
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  amount: number;
}

export interface TaskResolvedEvent extends BaseEvent {
  type: "task-resolved";
  taskId: string;
  sourceCardId: string;
  reason: string;
  autoResolved: true;
}

export interface TriggerSkippedEvent extends BaseEvent {
  type: "trigger-skipped";
  taskId: string;
  sourceCardId: string;
}

export interface TurnPassedEvent extends BaseEvent {
  type: "turn-passed";
  playerId: PlayerId;
}

export interface GameEndedEvent extends BaseEvent {
  type: "game-ended";
  winnerPlayerId: PlayerId;
}

export type GameEvent =
  | GameStartedEvent
  | TurnStartedEvent
  | CardPlayedEvent
  | PromptCreatedEvent
  | PromptAnsweredEvent
  | DamageDealtEvent
  | TaskResolvedEvent
  | TriggerSkippedEvent
  | TurnPassedEvent
  | GameEndedEvent;

export interface PromptOption {
  id: string;
  label: string;
}

export interface Prompt {
  id: string;
  /**
   * The owner/responder of this prompt. `playerId` is retained as the wire
   * name; `ownerPlayerId` makes the authorization rule explicit.
   */
  ownerPlayerId: PlayerId;
  playerId: PlayerId;
  stateVersion: number;
  status: "pending";
  taskId: string;
  reason: string;
  optional: boolean;
  options: readonly PromptOption[];
}

export interface PlayerProjection {
  id: PlayerId;
  name: string;
  life: number;
  mana: number;
  handCount: number;
  hand: readonly CardInstance[];
}

export interface GameProjection {
  version: number;
  eventSeq: number;
  phase: GamePhase;
  turnNumber: number;
  activePlayerId: PlayerId;
  winnerPlayerId: PlayerId | null;
  prompt: Prompt | null;
  waitingForPlayerId: PlayerId | null;
  players: readonly PlayerProjection[];
  events: readonly GameEvent[];
}

export interface RoomPlayer extends PlayerIdentity {
  connected: boolean;
}

export interface RoomSnapshot {
  roomId: RoomId;
  status: "playing" | "ended";
  players: readonly RoomPlayer[];
  version: number;
  eventSeq: number;
  projection: GameProjection;
}

export type EngineErrorCode =
  | "invalid_command"
  | "not_your_turn"
  | "prompt_required"
  | "prompt_not_found"
  | "prompt_expired"
  | "invalid_prompt_answer"
  | "card_not_found"
  | "not_enough_mana"
  | "game_ended";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export const TRIGGER_CONQUER_CARD: CardDefinition = {
  id: "card.trigger-conquer",
  name: "Trigger Conquer",
  cost: 1
};

export const ENGINE_ERRORS = {
  invalidCommand: "invalid_command",
  notYourTurn: "not_your_turn",
  promptRequired: "prompt_required",
  promptNotFound: "prompt_not_found",
  promptExpired: "prompt_expired",
  invalidPromptAnswer: "invalid_prompt_answer",
  cardNotFound: "card_not_found",
  notEnoughMana: "not_enough_mana",
  gameEnded: "game_ended"
} as const satisfies Record<string, EngineErrorCode>;

export const PROTOCOL_VERSION = "0.1.0";
export const RULESET_ID = "synthetic-demo";

export interface ClientSession {
  roomId: RoomId;
  playerId: PlayerId;
  resumeToken: string;
}

export interface RoomView {
  roomId: RoomId;
  status: "waiting" | "playing" | "ended";
  rulesetId: typeof RULESET_ID;
  players: readonly RoomPlayer[];
}

export type ClientToServerMessage =
  | {
      type: "hello";
      protocolVersion: string;
      roomId?: RoomId;
      resumeToken?: string;
    }
  | { type: "create-room"; requestId: string; playerName: string }
  | { type: "join-room"; requestId: string; roomId: RoomId; playerName: string }
  | {
      type: "command";
      requestId: string;
      commandId: string;
      expectedVersion: number;
      command: PlayerCommand;
    }
  | { type: "ping" };

export type ErrorCode =
  | EngineErrorCode
  | "protocol-error"
  | "handshake-required"
  | "already-in-room"
  | "room-not-found"
  | "room-full"
  | "invalid-token"
  | "session-replaced"
  | "command-rejected"
  | "stale-version"
  | "idempotency-conflict"
  | "capacity-exceeded";

export interface CommandReceipt {
  type: "request-result";
  requestId: string;
  ok: true;
  commandId?: string;
  appliedVersion?: number;
  eventSeq?: number;
  duplicate?: boolean;
}

export type ServerToClientMessage =
  | {
      type: "welcome";
      protocolVersion: string;
      session?: ClientSession;
      resumed?: boolean;
    }
  | CommandReceipt
  | { type: "room"; room: RoomView }
  | { type: "projection"; roomId: RoomId; projection: GameProjection }
  | { type: "error"; requestId?: string; code: ErrorCode; message: string }
  | { type: "pong" };

export type ServerTransport = (message: ServerToClientMessage) => void;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => allowed.has(key));
}

function isStringArray(value: unknown, max = 128): value is readonly string[] {
  return Array.isArray(value) &&
    value.every(item => text(item, max)) &&
    new Set(value).size === value.length;
}

export function isCardInstance(value: unknown): value is CardInstance {
  return record(value) &&
    hasExactKeys(value, ["instanceId", "cardId"]) &&
    text(value.instanceId, 256) &&
    text(value.cardId, 256);
}

function isPromptOption(value: unknown): value is PromptOption {
  return record(value) &&
    hasExactKeys(value, ["id", "label"]) &&
    text(value.id, 256) &&
    text(value.label);
}

function isEngineErrorCode(value: unknown): value is EngineErrorCode {
  return typeof value === "string" &&
    (Object.values(ENGINE_ERRORS) as readonly string[]).includes(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return isEngineErrorCode(value) ||
    value === "protocol-error" ||
    value === "handshake-required" ||
    value === "already-in-room" ||
    value === "room-not-found" ||
    value === "room-full" ||
    value === "invalid-token" ||
    value === "session-replaced" ||
    value === "command-rejected" ||
    value === "stale-version" ||
    value === "idempotency-conflict" ||
    value === "capacity-exceeded";
}

export function isPrompt(value: unknown): value is Prompt {
  if (!record(value) ||
      !hasExactKeys(value, [
        "id",
        "ownerPlayerId",
        "playerId",
        "stateVersion",
        "status",
        "taskId",
        "reason",
        "optional",
        "options"
      ]) ||
      !text(value.id, 256) ||
      !text(value.ownerPlayerId) ||
      !text(value.playerId) ||
      value.ownerPlayerId !== value.playerId ||
      !safeInteger(value.stateVersion) ||
      value.status !== "pending" ||
      !text(value.taskId, 256) ||
      !text(value.reason) ||
      typeof value.optional !== "boolean" ||
      !Array.isArray(value.options) ||
      value.options.length === 0 ||
      !value.options.every(isPromptOption)) {
    return false;
  }

  const optionIds = value.options.map(option => option.id);
  return new Set(optionIds).size === optionIds.length;
}

export function isGameEvent(value: unknown): value is GameEvent {
  if (!record(value) ||
      !text(value.type) ||
      !safeInteger(value.seq, 1) ||
      !safeInteger(value.turnNumber, 1) ||
      !text(value.activePlayerId)) {
    return false;
  }

  const base = ["seq", "turnNumber", "activePlayerId"] as const;
  switch (value.type) {
    case "game-started":
      return hasExactKeys(value, [...base, "type", "playerIds"]) &&
        isStringArray(value.playerIds) &&
        value.playerIds.length > 0;
    case "turn-started":
      return hasExactKeys(value, [...base, "type", "playerId", "mana"]) &&
        text(value.playerId) &&
        safeInteger(value.mana);
    case "card-played":
      return hasExactKeys(value, [...base, "type", "playerId", "instanceId", "cardId"]) &&
        text(value.playerId) &&
        text(value.instanceId, 256) &&
        text(value.cardId, 256);
    case "prompt-created":
      return hasExactKeys(value, [...base, "type", "promptId", "playerId", "reason", "optional"]) &&
        text(value.promptId, 256) &&
        text(value.playerId) &&
        text(value.reason) &&
        typeof value.optional === "boolean";
    case "prompt-answered":
      return hasExactKeys(value, [...base, "type", "promptId", "playerId", "optionId"]) &&
        text(value.promptId, 256) &&
        text(value.playerId) &&
        text(value.optionId);
    case "damage-dealt":
      return hasExactKeys(value, [
        ...base,
        "type",
        "sourceCardId",
        "sourcePlayerId",
        "targetPlayerId",
        "amount"
      ]) &&
        text(value.sourceCardId, 256) &&
        text(value.sourcePlayerId) &&
        text(value.targetPlayerId) &&
        safeInteger(value.amount, 1);
    case "task-resolved":
      return hasExactKeys(value, [
        ...base,
        "type",
        "taskId",
        "sourceCardId",
        "reason",
        "autoResolved"
      ]) &&
        text(value.taskId, 256) &&
        text(value.sourceCardId, 256) &&
        text(value.reason) &&
        value.autoResolved === true;
    case "trigger-skipped":
      return hasExactKeys(value, [...base, "type", "taskId", "sourceCardId"]) &&
        text(value.taskId, 256) &&
        text(value.sourceCardId, 256);
    case "turn-passed":
      return hasExactKeys(value, [...base, "type", "playerId"]) &&
        text(value.playerId);
    case "game-ended":
      return hasExactKeys(value, [...base, "type", "winnerPlayerId"]) &&
        text(value.winnerPlayerId);
    default:
      return false;
  }
}

function isPlayerProjection(value: unknown): value is PlayerProjection {
  return record(value) &&
    hasExactKeys(value, ["id", "name", "life", "mana", "handCount", "hand"]) &&
    text(value.id) &&
    text(value.name) &&
    safeInteger(value.life) &&
    safeInteger(value.mana) &&
    safeInteger(value.handCount) &&
    Array.isArray(value.hand) &&
    value.hand.every(isCardInstance) &&
    value.handCount >= value.hand.length;
}

export function isGameProjection(value: unknown): value is GameProjection {
  return record(value) &&
    hasExactKeys(value, [
      "version",
      "eventSeq",
      "phase",
      "turnNumber",
      "activePlayerId",
      "winnerPlayerId",
      "prompt",
      "waitingForPlayerId",
      "players",
      "events"
    ]) &&
    safeInteger(value.version) &&
    safeInteger(value.eventSeq) &&
    (value.phase === "main" || value.phase === "ended") &&
    safeInteger(value.turnNumber, 1) &&
    text(value.activePlayerId) &&
    (value.winnerPlayerId === null || text(value.winnerPlayerId)) &&
    (value.prompt === null || isPrompt(value.prompt)) &&
    (value.waitingForPlayerId === null || text(value.waitingForPlayerId)) &&
    Array.isArray(value.players) &&
    value.players.length === 2 &&
    value.players.every(isPlayerProjection) &&
    Array.isArray(value.events) &&
    value.events.every(isGameEvent);
}

function isRoomPlayer(value: unknown): value is RoomPlayer {
  return record(value) &&
    hasExactKeys(value, ["id", "name", "connected"]) &&
    text(value.id) &&
    text(value.name) &&
    typeof value.connected === "boolean";
}

export function isRoomView(value: unknown): value is RoomView {
  return record(value) &&
    hasExactKeys(value, ["roomId", "status", "rulesetId", "players"]) &&
    text(value.roomId, 64) &&
    (value.status === "waiting" || value.status === "playing" || value.status === "ended") &&
    value.rulesetId === RULESET_ID &&
    Array.isArray(value.players) &&
    value.players.every(isRoomPlayer);
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  return record(value) &&
    hasExactKeys(value, ["roomId", "status", "players", "version", "eventSeq", "projection"]) &&
    text(value.roomId, 64) &&
    (value.status === "playing" || value.status === "ended") &&
    Array.isArray(value.players) &&
    value.players.every(isRoomPlayer) &&
    safeInteger(value.version) &&
    safeInteger(value.eventSeq) &&
    isGameProjection(value.projection);
}

function isCommandShape(value: Record<string, unknown>, actor: boolean): boolean {
  const withActor = (keys: readonly string[]) =>
    actor ? hasExactKeys(value, [...keys, "playerId"]) : hasExactKeys(value, keys);

  switch (value.type) {
    case "pass":
      return withActor(["type"]);
    case "play-card":
      return withActor(["type", "instanceId"]) &&
        text(value.instanceId, 256);
    case "respond-to-prompt":
      return actor
        ? hasExactKeys(
            value,
            ["type", "promptId", "optionId", "playerId"],
            ["stateVersion"]
          ) &&
          text(value.promptId, 256) &&
          text(value.optionId) &&
          (value.stateVersion === undefined || safeInteger(value.stateVersion))
        : hasExactKeys(value, ["type", "promptId", "optionId"], ["stateVersion"]) &&
          text(value.promptId, 256) &&
          text(value.optionId) &&
          (value.stateVersion === undefined || safeInteger(value.stateVersion));
    default:
      return false;
  }
}

export function isPlayerCommand(value: unknown): value is PlayerCommand {
  return record(value) && isCommandShape(value, false);
}

export function isCommand(value: unknown): value is Command {
  return record(value) &&
    text(value.playerId) &&
    isCommandShape(value, true);
}

function isClientSession(value: unknown): value is ClientSession {
  return record(value) &&
    hasExactKeys(value, ["roomId", "playerId", "resumeToken"]) &&
    text(value.roomId, 64) &&
    text(value.playerId) &&
    text(value.resumeToken, 128);
}

// Validate before a socket may create a room or execute an engine command.
export function isClientMessage(value: unknown): value is ClientToServerMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "hello":
      return hasExactKeys(value, ["type", "protocolVersion"], ["roomId", "resumeToken"]) &&
        text(value.protocolVersion, 32) &&
        ((value.roomId === undefined && value.resumeToken === undefined) ||
          (text(value.roomId, 64) && text(value.resumeToken, 128)));
    case "create-room":
      return hasExactKeys(value, ["type", "requestId", "playerName"]) &&
        text(value.requestId) &&
        text(value.playerName, 32);
    case "join-room":
      return hasExactKeys(value, ["type", "requestId", "playerName", "roomId"]) &&
        text(value.requestId) &&
        text(value.playerName, 32) &&
        text(value.roomId, 64);
    case "command":
      return hasExactKeys(value, ["type", "requestId", "commandId", "expectedVersion", "command"]) &&
        text(value.requestId) &&
        text(value.commandId) &&
        safeInteger(value.expectedVersion) &&
        isPlayerCommand(value.command);
    case "ping":
      return hasExactKeys(value, ["type"]);
    default:
      return false;
  }
}

export function isServerMessage(value: unknown): value is ServerToClientMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "welcome":
      return hasExactKeys(value, ["type", "protocolVersion"], ["session", "resumed"]) &&
        text(value.protocolVersion, 32) &&
        (value.session === undefined || isClientSession(value.session)) &&
        (value.resumed === undefined || typeof value.resumed === "boolean");
    case "request-result":
      return hasExactKeys(
        value,
        ["type", "requestId", "ok"],
        ["commandId", "appliedVersion", "eventSeq", "duplicate"]
      ) &&
        text(value.requestId) &&
        value.ok === true &&
        (value.commandId === undefined || text(value.commandId)) &&
        (value.appliedVersion === undefined || safeInteger(value.appliedVersion)) &&
        (value.eventSeq === undefined || safeInteger(value.eventSeq)) &&
        (value.duplicate === undefined || typeof value.duplicate === "boolean");
    case "room":
      return hasExactKeys(value, ["type", "room"]) && isRoomView(value.room);
    case "projection":
      return hasExactKeys(value, ["type", "roomId", "projection"]) &&
        text(value.roomId, 64) &&
        isGameProjection(value.projection);
    case "error":
      return hasExactKeys(value, ["type", "code", "message"], ["requestId"]) &&
        (value.requestId === undefined || text(value.requestId)) &&
        isErrorCode(value.code) &&
        text(value.message, 512);
    case "pong":
      return hasExactKeys(value, ["type"]);
    default:
      return false;
  }
}
