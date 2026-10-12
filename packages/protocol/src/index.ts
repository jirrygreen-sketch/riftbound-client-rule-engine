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
  mana?: number;
  energy?: number;
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
  targetObjectId?: string;
}

export interface PointsGainedEvent extends BaseEvent {
  type: "points-gained";
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
  | PointsGainedEvent
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

export const PROJECTION_SCHEMA_V1 = "riftbound.projection.v1";

export const PROJECTION_ZONES = [
  "base", "board", "battlefield", "champion", "legend", "rune",
  "hand", "deck", "rune-deck", "discard", "banish", "chain"
] as const;

export type ProjectionZone = (typeof PROJECTION_ZONES)[number];

export interface ProjectionObject {
  objectId: string;
  cardId: string;
  zone: ProjectionZone;
  controllerId: PlayerId;
  ownerPlayerId: PlayerId;
  faceUp: boolean;
  counters?: Readonly<Record<string, number>>;
  damage?: number;
}

export interface PlayerProjection {
  id: PlayerId;
  name: string;
  /** Legacy synthetic-demo values only. Foundation uses score and energy. */
  life?: number;
  mana?: number;
  score?: number;
  energy?: number;
  power?: Readonly<Record<string, number>>;
  zoneCounts?: Readonly<Partial<Record<ProjectionZone, number>>>;
  playableInstanceIds?: readonly string[];
  handCount: number;
  hand: readonly CardInstance[];
}

export interface GameProjection {
  projectionSchema?: typeof PROJECTION_SCHEMA_V1;
  rulesetId?: string;
  priority?: { playerId: PlayerId };
  objects?: readonly ProjectionObject[];
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
  ready: boolean;
  deckSubmitted: boolean;
}

export interface RoomSnapshot {
  roomId: RoomId;
  status: "playing" | "ended";
  players: readonly RoomPlayer[];
  version: number;
  roomVersion: number;
  roomEventSeq: number;
  eventSeq: number;
  projection: GameProjection;
  roomEvents: readonly RoomEvent[];
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
  | "judge_required"
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
  judgeRequired: "judge_required",
  gameEnded: "game_ended"
} as const satisfies Record<string, EngineErrorCode>;

export const PROTOCOL_VERSION = "0.2.0";
export const RULESET_ID = "synthetic-demo";
export const FOUNDATION_RULESET_ID = "riftbound-foundation";
/** Kept as an import alias; this slice does not claim full official support. */
export const OFFICIAL_RULESET_ID = FOUNDATION_RULESET_ID;
export const RULESET_IDS = [
  RULESET_ID,
  OFFICIAL_RULESET_ID
] as const satisfies readonly string[];

export interface ClientSession {
  roomId: RoomId;
  playerId: PlayerId;
  resumeToken: string;
}

export interface RoomView {
  roomId: RoomId;
  status: "waiting" | "playing" | "ended";
  rulesetId: string;
  version: number;
  roomVersion: number;
  roomEventSeq: number;
  players: readonly RoomPlayer[];
}

export type RoomEvent =
  | { type: "room-created"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-joined"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-disconnected"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-reconnected"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "deck-submitted"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-ready"; seq: number; roomId: RoomId; playerId: PlayerId; ready: boolean }
  | { type: "game-started"; seq: number; roomId: RoomId };

export type DeckZoneName =
  | "mainDeck"
  | "runes"
  | "legend"
  | "champion"
  | "battlefields"
  | "sideboard";

export interface DeckWireEntry {
  cardId: string;
  quantity: number;
}

export type RoomDeckSubmission = Readonly<
  Partial<Record<DeckZoneName, readonly DeckWireEntry[]>>
>;

export type ClientToServerMessage =
  | {
      type: "hello";
      protocolVersion: string;
      roomId?: RoomId;
      resumeToken?: string;
      afterEventSeq?: number;
      afterRoomEventSeq?: number;
    }
  | {
      type: "create-room";
      requestId: string;
      playerName: string;
      rulesetId?: string;
    }
  | { type: "join-room"; requestId: string; roomId: RoomId; playerName: string }
  | {
      type: "command";
      requestId: string;
      commandId: string;
      expectedVersion: number;
      command: PlayerCommand;
    }
  | {
      type: "submit-deck";
      requestId: string;
      expectedRoomVersion: number;
      deck: RoomDeckSubmission;
    }
  | {
      type: "set-ready";
      requestId: string;
      expectedRoomVersion: number;
      ready: boolean;
    }
  | {
      type: "sync-events";
      requestId: string;
      afterEventSeq?: number;
      afterRoomEventSeq?: number;
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
  | "capacity-exceeded"
  | "invalid-deck";

export interface CommandReceipt {
  type: "request-result";
  requestId: string;
  ok: true;
  commandId?: string;
  appliedVersion?: number;
  eventSeq?: number;
  roomVersion?: number;
  roomEventSeq?: number;
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
  | {
      type: "events";
      roomId: RoomId;
      afterEventSeq: number;
      nextEventSeq: number;
      version: number;
      events: readonly GameEvent[];
    }
  | {
      type: "room-events";
      roomId: RoomId;
      afterRoomEventSeq: number;
      nextRoomEventSeq: number;
      roomVersion: number;
      events: readonly RoomEvent[];
    }
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
    value === "capacity-exceeded" ||
    value === "invalid-deck";
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
      return hasExactKeys(value, [...base, "type", "playerId"], ["mana", "energy"]) &&
        text(value.playerId) &&
        ((safeInteger(value.mana) && value.energy === undefined) ||
          (safeInteger(value.energy) && value.mana === undefined));
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
      ], ["targetObjectId"]) &&
        text(value.sourceCardId, 256) &&
        text(value.sourcePlayerId) &&
        text(value.targetPlayerId) &&
        (value.targetObjectId === undefined || text(value.targetObjectId, 256)) &&
        safeInteger(value.amount, 1);
    case "points-gained":
      return hasExactKeys(value, [
        ...base, "type", "sourceCardId", "sourcePlayerId", "targetPlayerId", "amount"
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

function isCounterMap(value: unknown): value is Readonly<Record<string, number>> {
  return record(value) && Object.entries(value).every(([key, count]) =>
    text(key, 64) && safeInteger(count)
  );
}

function isEventWindow(
  events: readonly { seq: number }[],
  after: number,
  through: number
): boolean {
  let previous = after;
  for (const event of events) {
    if (event.seq <= previous || event.seq > through) return false;
    previous = event.seq;
  }
  return true;
}

export function isProjectionObject(value: unknown): value is ProjectionObject {
  return record(value) &&
    hasExactKeys(value, [
      "objectId", "cardId", "zone", "controllerId", "ownerPlayerId", "faceUp"
    ], ["counters", "damage"]) &&
    text(value.objectId, 256) &&
    text(value.cardId, 256) &&
    (PROJECTION_ZONES as readonly unknown[]).includes(value.zone) &&
    value.zone !== "deck" &&
    value.zone !== "rune-deck" &&
    text(value.controllerId) &&
    text(value.ownerPlayerId) &&
    value.faceUp === true &&
    (value.counters === undefined || isCounterMap(value.counters)) &&
    (value.damage === undefined || safeInteger(value.damage));
}

function isPlayerProjection(value: unknown): value is PlayerProjection {
  return record(value) &&
    hasExactKeys(value, ["id", "name", "handCount", "hand"], [
      "life", "mana", "score", "energy", "power", "zoneCounts", "playableInstanceIds"
    ]) &&
    text(value.id) &&
    text(value.name) &&
    (value.life === undefined || safeInteger(value.life)) &&
    (value.mana === undefined || safeInteger(value.mana)) &&
    (value.score === undefined || safeInteger(value.score)) &&
    (value.energy === undefined || safeInteger(value.energy)) &&
    (value.power === undefined || isCounterMap(value.power)) &&
    (value.zoneCounts === undefined ||
      (isCounterMap(value.zoneCounts) && Object.keys(value.zoneCounts).every(zone =>
        (PROJECTION_ZONES as readonly string[]).includes(zone)))) &&
    (value.playableInstanceIds === undefined ||
      (isStringArray(value.playableInstanceIds, 256) &&
        new Set(value.playableInstanceIds).size === value.playableInstanceIds.length &&
        Array.isArray(value.hand) &&
        value.playableInstanceIds.every(id =>
          (value.hand as unknown[]).some(card => isCardInstance(card) && card.instanceId === id)))) &&
    safeInteger(value.handCount) &&
    Array.isArray(value.hand) &&
    value.hand.every(isCardInstance) &&
    value.handCount >= value.hand.length;
}

export function isGameProjection(value: unknown): value is GameProjection {
  if (!(record(value) &&
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
    ], ["projectionSchema", "rulesetId", "priority", "objects"]) &&
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
    value.events.every(isGameEvent))) return false;

  const players = value.players as PlayerProjection[];
  const ids = players.map(player => player.id);
  if (new Set(ids).size !== 2 || !ids.includes(value.activePlayerId as string)) return false;
  if (value.winnerPlayerId !== null && !ids.includes(value.winnerPlayerId as string)) return false;
  if (value.waitingForPlayerId !== null &&
      !ids.includes(value.waitingForPlayerId as string)) return false;
  if (value.prompt !== null &&
      (value.prompt as Prompt).ownerPlayerId !== value.waitingForPlayerId) return false;
  const visibleHands = players.filter(player => player.hand.length > 0);
  const handIds = players.flatMap(player => player.hand.map(card => card.instanceId));
  if (visibleHands.length > 1 || new Set(handIds).size !== handIds.length ||
      visibleHands.some(player => player.handCount !== player.hand.length)) return false;
  if (!isEventWindow(value.events as GameEvent[], 0, value.eventSeq as number) ||
      (value.events as GameEvent[]).some(event =>
        event.turnNumber > (value.turnNumber as number) ||
        !ids.includes(event.activePlayerId))) return false;
  if (value.projectionSchema === undefined) {
    return value.rulesetId === undefined && value.priority === undefined &&
      value.objects === undefined && players.every(player =>
        safeInteger(player.life) && safeInteger(player.mana) &&
        player.score === undefined && player.energy === undefined &&
        player.power === undefined && player.zoneCounts === undefined &&
        player.playableInstanceIds === undefined);
  }
  return value.projectionSchema === PROJECTION_SCHEMA_V1 &&
    value.rulesetId === FOUNDATION_RULESET_ID &&
    record(value.priority) &&
    hasExactKeys(value.priority, ["playerId"]) &&
    ids.includes(value.priority.playerId as string) &&
    Array.isArray(value.objects) &&
    value.objects.every(isProjectionObject) &&
    value.objects.filter(object => object.zone === "hand").length === handIds.length &&
    new Set(value.objects.map(object => object.objectId)).size === value.objects.length &&
    value.objects.every(object =>
      ids.includes(object.ownerPlayerId) && ids.includes(object.controllerId) &&
      (object.zone === "hand"
        ? players.some(player => player.id === object.ownerPlayerId &&
            player.hand.some(card => card.instanceId === object.objectId &&
              card.cardId === object.cardId))
        : !handIds.includes(object.objectId))) &&
    players.every(player => safeInteger(player.score) && safeInteger(player.energy) &&
      isCounterMap(player.power) && player.life === undefined && player.mana === undefined &&
      player.zoneCounts !== undefined &&
      player.zoneCounts.hand === player.handCount &&
      player.playableInstanceIds !== undefined);
}

function isRoomPlayer(value: unknown): value is RoomPlayer {
  return record(value) &&
    hasExactKeys(value, ["id", "name", "connected", "ready", "deckSubmitted"]) &&
    text(value.id) &&
    text(value.name) &&
    typeof value.connected === "boolean" &&
    typeof value.ready === "boolean" &&
    typeof value.deckSubmitted === "boolean";
}

function isRoomEvent(value: unknown): value is RoomEvent {
  return record(value) &&
    text(value.type) &&
    ["room-created", "player-joined", "player-disconnected", "player-reconnected",
      "deck-submitted", "player-ready", "game-started"].includes(value.type) &&
    safeInteger(value.seq, 1) &&
    text(value.roomId, 64) &&
    (value.type === "game-started"
      ? hasExactKeys(value, ["type", "seq", "roomId"])
      : value.type === "player-ready"
        ? hasExactKeys(value, ["type", "seq", "roomId", "playerId", "ready"]) &&
          text(value.playerId) &&
          typeof value.ready === "boolean"
        : hasExactKeys(value, ["type", "seq", "roomId", "playerId"]) &&
          text(value.playerId));
}

function isDeckWireEntry(value: unknown): value is DeckWireEntry {
  return record(value) &&
    hasExactKeys(value, ["cardId", "quantity"]) &&
    text(value.cardId, 256) &&
    safeInteger(value.quantity, 1);
}

function isRoomDeck(value: unknown): value is RoomDeckSubmission {
  if (!record(value)) return false;
  const zones = [
    "mainDeck",
    "runes",
    "legend",
    "champion",
    "battlefields",
    "sideboard"
  ];
  if (!Object.keys(value).every(key => zones.includes(key))) return false;
  return zones.every(key =>
    value[key] === undefined ||
    (Array.isArray(value[key]) && value[key].every(isDeckWireEntry))
  );
}

export function isRoomView(value: unknown): value is RoomView {
  return record(value) &&
    hasExactKeys(value, [
      "roomId",
      "status",
      "rulesetId",
      "version",
      "roomVersion",
      "roomEventSeq",
      "players"
    ]) &&
    text(value.roomId, 64) &&
    (value.status === "waiting" || value.status === "playing" || value.status === "ended") &&
    text(value.rulesetId, 64) &&
    (RULESET_IDS as readonly string[]).includes(value.rulesetId) &&
    safeInteger(value.version) &&
    safeInteger(value.roomVersion) &&
    safeInteger(value.roomEventSeq) &&
    Array.isArray(value.players) &&
    value.players.length >= 1 && value.players.length <= 2 &&
    new Set(value.players.map(player => record(player) ? player.id : null)).size === value.players.length &&
    value.players.every(isRoomPlayer);
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!(record(value) &&
    hasExactKeys(value, [
      "roomId",
      "status",
      "players",
      "version",
      "roomVersion",
      "roomEventSeq",
      "eventSeq",
      "projection",
      "roomEvents"
    ]) &&
    text(value.roomId, 64) &&
    (value.status === "playing" || value.status === "ended") &&
    Array.isArray(value.players) &&
    value.players.every(isRoomPlayer) &&
    value.players.length >= 1 &&
    value.players.length <= 2 &&
    safeInteger(value.version) &&
    safeInteger(value.roomVersion) &&
    safeInteger(value.roomEventSeq) &&
    safeInteger(value.eventSeq) &&
    isGameProjection(value.projection) &&
    Array.isArray(value.roomEvents) &&
    value.roomEvents.every(isRoomEvent))) return false;

  const playerIds = (value.players as RoomPlayer[]).map(player => player.id);
  const roomEvents = value.roomEvents as RoomEvent[];
  return new Set(playerIds).size === value.players.length &&
    isEventWindow(roomEvents, 0, value.roomEventSeq as number) &&
    roomEvents.every(event => event.roomId === value.roomId) &&
    roomEvents.every(event =>
      event.type === "game-started" || playerIds.includes(event.playerId));
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
      return hasExactKeys(
        value,
        ["type", "protocolVersion"],
        ["roomId", "resumeToken", "afterEventSeq", "afterRoomEventSeq"]
      ) &&
        text(value.protocolVersion, 32) &&
        ((value.roomId === undefined && value.resumeToken === undefined) ||
          (text(value.roomId, 64) && text(value.resumeToken, 128))) &&
        (value.afterEventSeq === undefined || safeInteger(value.afterEventSeq)) &&
        (value.afterRoomEventSeq === undefined ||
          safeInteger(value.afterRoomEventSeq));
    case "create-room":
      return hasExactKeys(value, ["type", "requestId", "playerName"], ["rulesetId"]) &&
        text(value.requestId) &&
        text(value.playerName, 32) &&
        (value.rulesetId === undefined || text(value.rulesetId, 64));
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
    case "submit-deck":
      return hasExactKeys(value, ["type", "requestId", "expectedRoomVersion", "deck"]) &&
        text(value.requestId) &&
        safeInteger(value.expectedRoomVersion) &&
        isRoomDeck(value.deck);
    case "set-ready":
      return hasExactKeys(value, ["type", "requestId", "expectedRoomVersion", "ready"]) &&
        text(value.requestId) &&
        safeInteger(value.expectedRoomVersion) &&
        typeof value.ready === "boolean";
    case "sync-events":
      return hasExactKeys(value, ["type", "requestId"], ["afterEventSeq", "afterRoomEventSeq"]) &&
        text(value.requestId) &&
        (value.afterEventSeq === undefined || safeInteger(value.afterEventSeq)) &&
        (value.afterRoomEventSeq === undefined ||
          safeInteger(value.afterRoomEventSeq));
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
        ["commandId", "appliedVersion", "eventSeq", "roomVersion", "roomEventSeq", "duplicate"]
      ) &&
        text(value.requestId) &&
        value.ok === true &&
        (value.commandId === undefined || text(value.commandId)) &&
        (value.appliedVersion === undefined || safeInteger(value.appliedVersion)) &&
        (value.eventSeq === undefined || safeInteger(value.eventSeq)) &&
        (value.roomVersion === undefined || safeInteger(value.roomVersion)) &&
        (value.roomEventSeq === undefined || safeInteger(value.roomEventSeq)) &&
        (value.duplicate === undefined || typeof value.duplicate === "boolean");
    case "room":
      return hasExactKeys(value, ["type", "room"]) && isRoomView(value.room);
    case "projection":
      return hasExactKeys(value, ["type", "roomId", "projection"]) &&
        text(value.roomId, 64) &&
        isGameProjection(value.projection);
    case "events":
      return hasExactKeys(value, [
        "type",
        "roomId",
        "afterEventSeq",
        "nextEventSeq",
        "version",
        "events"
      ]) &&
        text(value.roomId, 64) &&
        safeInteger(value.afterEventSeq) &&
        safeInteger(value.nextEventSeq) &&
        value.afterEventSeq <= value.nextEventSeq &&
        safeInteger(value.version) &&
        Array.isArray(value.events) &&
        value.events.every(isGameEvent) &&
        isEventWindow(value.events, value.afterEventSeq, value.nextEventSeq);
    case "room-events":
      return hasExactKeys(value, [
        "type",
        "roomId",
        "afterRoomEventSeq",
        "nextRoomEventSeq",
        "roomVersion",
        "events"
      ]) &&
        text(value.roomId, 64) &&
        safeInteger(value.afterRoomEventSeq) &&
        safeInteger(value.nextRoomEventSeq) &&
        value.afterRoomEventSeq <= value.nextRoomEventSeq &&
        safeInteger(value.roomVersion) &&
        Array.isArray(value.events) &&
        value.events.every(isRoomEvent) &&
        value.events.every(event => event.roomId === value.roomId) &&
        isEventWindow(value.events, value.afterRoomEventSeq, value.nextRoomEventSeq);
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
