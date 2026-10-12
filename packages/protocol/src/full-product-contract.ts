import {
  FOUNDATION_RULESET_ID,
  PROJECTION_SCHEMA_V1,
  PROJECTION_ZONES,
  PROTOCOL_VERSION,
  type GamePhase,
  type PlayerId,
  type ProjectionZone,
  type RoomId
} from "./index.js";

export const FULL_PRODUCT_PROTOCOL_VERSION = "0.3.0";
export const FULL_PRODUCT_COMMAND_CONTRACT = "riftbound.full-product.command.v1";
export const FULL_PRODUCT_EVENT_CONTRACT = "riftbound.full-product.event.v1";
export const FULL_PRODUCT_PROJECTION_CONTRACT =
  "riftbound.full-product.projection.v1";
export const FULL_PRODUCT_RULESET_ID = FOUNDATION_RULESET_ID;

export const FULL_PRODUCT_COMPATIBLE_PROTOCOL_VERSIONS = [
  FULL_PRODUCT_PROTOCOL_VERSION,
  PROTOCOL_VERSION
] as const;

export type FullProductProtocolVersion = typeof FULL_PRODUCT_PROTOCOL_VERSION;
export type FullProductCompatibilityVersion =
  (typeof FULL_PRODUCT_COMPATIBLE_PROTOCOL_VERSIONS)[number];

export const FULL_PRODUCT_TARGET_KINDS = ["object", "player"] as const;
export type FullProductTargetKind =
  (typeof FULL_PRODUCT_TARGET_KINDS)[number];

export interface FullProductTargetSelection {
  readonly targetKind: FullProductTargetKind;
  readonly targetId: string;
}

export interface FullProductTargetPolicy {
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly allowedZones: readonly ProjectionZone[];
}

export interface FullProductPromptOption {
  readonly id: string;
  readonly label: string;
}

export interface FullProductPrompt {
  readonly promptId: string;
  readonly ownerPlayerId: PlayerId;
  readonly stateVersion: number;
  readonly optional: boolean;
  readonly targetPolicy: FullProductTargetPolicy;
  readonly options: readonly FullProductPromptOption[];
}

export interface FullProductPassCommand {
  readonly type: "pass";
}

export interface FullProductPlayCardCommand {
  readonly type: "play-card";
  readonly instanceId: string;
  readonly targets: readonly FullProductTargetSelection[];
}

export interface FullProductRespondPromptCommand {
  readonly type: "respond-to-prompt";
  readonly promptId: string;
  readonly optionId: string;
  readonly targets: readonly FullProductTargetSelection[];
}

export interface FullProductConcedeCommand {
  readonly type: "concede";
}

export type FullProductCommand =
  | FullProductPassCommand
  | FullProductPlayCardCommand
  | FullProductRespondPromptCommand
  | FullProductConcedeCommand;

export type FullProductCommandName = FullProductCommand["type"];

export interface FullProductCommandEnvelope {
  readonly requestId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: FullProductCommand;
}

export interface FullProductBaseEvent {
  readonly seq: number;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly priorityPlayerId: PlayerId;
}

export interface FullProductGameStartedEvent extends FullProductBaseEvent {
  readonly type: "game-started";
  readonly playerIds: readonly PlayerId[];
  readonly rulesetId: string;
}

export interface FullProductTurnStartedEvent extends FullProductBaseEvent {
  readonly type: "turn-started";
  readonly playerId: PlayerId;
}

export interface FullProductCardPlayedEvent extends FullProductBaseEvent {
  readonly type: "card-played";
  readonly playerId: PlayerId;
  readonly instanceId: string;
  readonly cardId: string;
  readonly targets: readonly FullProductTargetSelection[];
}

export interface FullProductPromptCreatedEvent extends FullProductBaseEvent {
  readonly type: "prompt-created";
  readonly promptId: string;
  readonly ownerPlayerId: PlayerId;
  readonly stateVersion: number;
  readonly optional: boolean;
  readonly targetPolicy: FullProductTargetPolicy;
}

export interface FullProductPromptAnsweredEvent extends FullProductBaseEvent {
  readonly type: "prompt-answered";
  readonly promptId: string;
  readonly playerId: PlayerId;
  readonly optionId: string;
  readonly targets: readonly FullProductTargetSelection[];
}

export interface FullProductPriorityPassedEvent extends FullProductBaseEvent {
  readonly type: "priority-passed";
  readonly playerId: PlayerId;
}

export interface FullProductGameEndedEvent extends FullProductBaseEvent {
  readonly type: "game-ended";
  readonly winnerPlayerId: PlayerId;
}

export type FullProductGameEvent =
  | FullProductGameStartedEvent
  | FullProductTurnStartedEvent
  | FullProductCardPlayedEvent
  | FullProductPromptCreatedEvent
  | FullProductPromptAnsweredEvent
  | FullProductPriorityPassedEvent
  | FullProductGameEndedEvent;

export interface FullProductProjectionObject {
  readonly objectId: string;
  readonly cardId: string;
  readonly zone: ProjectionZone;
  readonly controllerId: PlayerId;
  readonly ownerPlayerId: PlayerId;
  readonly faceUp: boolean;
  readonly visibility: "public" | "private";
  readonly counters?: Readonly<Record<string, number>>;
  readonly damage?: number;
}

export interface FullProductPlayerProjection {
  readonly id: PlayerId;
  readonly name: string;
  readonly score: number;
  readonly energy: number;
  readonly power: Readonly<Record<string, number>>;
  readonly handCount: number;
  readonly zoneCounts: Readonly<Partial<Record<ProjectionZone, number>>>;
  readonly playableInstanceIds: readonly string[] | null;
}

export interface FullProductProjection {
  readonly projectionContract: typeof FULL_PRODUCT_PROJECTION_CONTRACT;
  readonly protocolVersion: FullProductProtocolVersion;
  readonly rulesetId: typeof FULL_PRODUCT_RULESET_ID;
  readonly viewerPlayerId: PlayerId | null;
  readonly version: number;
  readonly eventSeq: number;
  readonly phase: GamePhase;
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly priorityPlayerId: PlayerId;
  readonly winnerPlayerId: PlayerId | null;
  readonly waitingForPlayerId: PlayerId | null;
  readonly prompt: FullProductPrompt | null;
  readonly players: readonly FullProductPlayerProjection[];
  readonly objects: readonly FullProductProjectionObject[];
  readonly events: readonly FullProductGameEvent[];
}

export interface FullProductResumeRequest {
  readonly type: "resume";
  readonly protocolVersion: FullProductCompatibilityVersion;
  readonly roomId: RoomId;
  readonly resumeToken: string;
  readonly afterEventSeq: number;
  readonly afterRoomEventSeq: number;
}

export interface FullProductResumeBackfill {
  readonly type: "resume-backfill";
  readonly roomId: RoomId;
  readonly projection: FullProductProjection;
  readonly afterEventSeq: number;
  readonly nextEventSeq: number;
  readonly events: readonly FullProductGameEvent[];
  readonly roomVersion: number;
  readonly afterRoomEventSeq: number;
  readonly nextRoomEventSeq: number;
}

export interface FullProductCommandReceipt {
  readonly type: "command-result";
  readonly requestId: string;
  readonly commandId: string;
  readonly duplicate: boolean;
  readonly appliedVersion: number;
  readonly eventSeq: number;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength;
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
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

function isUniqueStringArray(
  value: unknown,
  maxLength = 256
): value is readonly string[] {
  return Array.isArray(value) &&
    value.every(item => isText(item, maxLength)) &&
    new Set(value).size === value.length;
}

function isCounterMap(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) &&
    Object.entries(value).every(([key, count]) =>
      isText(key, 64) && isSafeInteger(count));
}

function isProjectionZone(value: unknown): value is ProjectionZone {
  return typeof value === "string" &&
    (PROJECTION_ZONES as readonly unknown[]).includes(value);
}

function isTargetKind(value: unknown): value is FullProductTargetKind {
  return typeof value === "string" &&
    (FULL_PRODUCT_TARGET_KINDS as readonly unknown[]).includes(value);
}

function isTargetSelection(value: unknown): value is FullProductTargetSelection {
  return isRecord(value) &&
    hasExactKeys(value, ["targetKind", "targetId"]) &&
    isTargetKind(value.targetKind) &&
    isText(value.targetId, 256);
}

function isTargetArray(value: unknown): value is readonly FullProductTargetSelection[] {
  return Array.isArray(value) &&
    value.every(isTargetSelection) &&
    new Set(value.map(target => `${target.targetKind}:${target.targetId}`))
      .size === value.length;
}

export function isFullProductTargetPolicy(
  value: unknown
): value is FullProductTargetPolicy {
  return isRecord(value) &&
    hasExactKeys(value, ["minTargets", "maxTargets", "allowedZones"]) &&
    isSafeInteger(value.minTargets) &&
    isSafeInteger(value.maxTargets) &&
    (value.minTargets as number) <= (value.maxTargets as number) &&
    Array.isArray(value.allowedZones) &&
    value.allowedZones.every(isProjectionZone) &&
    new Set(value.allowedZones).size === value.allowedZones.length &&
    ((value.maxTargets as number) === 0
      ? value.allowedZones.length === 0
      : value.allowedZones.length > 0);
}

function isPromptOption(value: unknown): value is FullProductPromptOption {
  return isRecord(value) &&
    hasExactKeys(value, ["id", "label"]) &&
    isText(value.id, 256) &&
    isText(value.label, 128);
}

export function isFullProductPrompt(value: unknown): value is FullProductPrompt {
  if (!(isRecord(value) &&
    hasExactKeys(value, [
      "promptId",
      "ownerPlayerId",
      "stateVersion",
      "optional",
      "targetPolicy",
      "options"
    ]) &&
    isText(value.promptId, 256) &&
    isText(value.ownerPlayerId) &&
    isSafeInteger(value.stateVersion) &&
    typeof value.optional === "boolean" &&
    isFullProductTargetPolicy(value.targetPolicy) &&
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every(isPromptOption))) {
    return false;
  }

  const options = value.options as readonly FullProductPromptOption[];
  return new Set(options.map(option => option.id)).size === options.length;
}

function isCommandShape(
  value: Record<string, unknown>,
  commandType: string
): boolean {
  switch (commandType) {
    case "pass":
      return hasExactKeys(value, ["type"]);
    case "play-card":
      return hasExactKeys(value, ["type", "instanceId", "targets"]) &&
        isText(value.instanceId, 256) &&
        isTargetArray(value.targets);
    case "respond-to-prompt":
      return hasExactKeys(value, [
        "type",
        "promptId",
        "optionId",
        "targets"
      ]) &&
        isText(value.promptId, 256) &&
        isText(value.optionId, 256) &&
        isTargetArray(value.targets);
    case "concede":
      return hasExactKeys(value, ["type"]);
    default:
      return false;
  }
}

export function isFullProductCommand(value: unknown): value is FullProductCommand {
  return isRecord(value) &&
    typeof value.type === "string" &&
    isCommandShape(value, value.type);
}

export function isFullProductCommandEnvelope(
  value: unknown
): value is FullProductCommandEnvelope {
  return isRecord(value) &&
    hasExactKeys(value, [
      "requestId",
      "commandId",
      "expectedVersion",
      "command"
    ]) &&
    isText(value.requestId, 256) &&
    isText(value.commandId, 256) &&
    isSafeInteger(value.expectedVersion) &&
    isFullProductCommand(value.command);
}

function isBaseEvent(value: Record<string, unknown>): boolean {
  return isSafeInteger(value.seq, 1) &&
    isSafeInteger(value.turnNumber, 1) &&
    isText(value.activePlayerId) &&
    isText(value.priorityPlayerId);
}

function isEventShape(value: Record<string, unknown>): boolean {
  if (!isBaseEvent(value)) return false;

  const base = ["seq", "turnNumber", "activePlayerId", "priorityPlayerId"];
  switch (value.type) {
    case "game-started":
      return hasExactKeys(value, [
        ...base,
        "type",
        "playerIds",
        "rulesetId"
      ]) &&
        isUniqueStringArray(value.playerIds) &&
        (value.playerIds as readonly string[]).length === 2 &&
        value.rulesetId === FULL_PRODUCT_RULESET_ID;
    case "turn-started":
      return hasExactKeys(value, [...base, "type", "playerId"]) &&
        isText(value.playerId);
    case "card-played":
      return hasExactKeys(value, [
        ...base,
        "type",
        "playerId",
        "instanceId",
        "cardId",
        "targets"
      ]) &&
        isText(value.playerId) &&
        isText(value.instanceId, 256) &&
        isText(value.cardId, 256) &&
        isTargetArray(value.targets);
    case "prompt-created":
      return hasExactKeys(value, [
        ...base,
        "type",
        "promptId",
        "ownerPlayerId",
        "stateVersion",
        "optional",
        "targetPolicy"
      ]) &&
        isText(value.promptId, 256) &&
        isText(value.ownerPlayerId) &&
        isSafeInteger(value.stateVersion) &&
        typeof value.optional === "boolean" &&
        isFullProductTargetPolicy(value.targetPolicy);
    case "prompt-answered":
      return hasExactKeys(value, [
        ...base,
        "type",
        "promptId",
        "playerId",
        "optionId",
        "targets"
      ]) &&
        isText(value.promptId, 256) &&
        isText(value.playerId) &&
        isText(value.optionId, 256) &&
        isTargetArray(value.targets);
    case "priority-passed":
      return hasExactKeys(value, [...base, "type", "playerId"]) &&
        isText(value.playerId);
    case "game-ended":
      return hasExactKeys(value, [...base, "type", "winnerPlayerId"]) &&
        isText(value.winnerPlayerId);
    default:
      return false;
  }
}

export function isFullProductGameEvent(value: unknown): value is FullProductGameEvent {
  return isRecord(value) &&
    typeof value.type === "string" &&
    isEventShape(value);
}

function isProjectionObject(
  value: unknown,
  viewerPlayerId: string | null,
  playerIds: readonly string[]
): value is FullProductProjectionObject {
  return isRecord(value) &&
    hasExactKeys(
      value,
      [
        "objectId",
        "cardId",
        "zone",
        "controllerId",
        "ownerPlayerId",
        "faceUp",
        "visibility"
      ],
      ["counters", "damage"]
    ) &&
    isText(value.objectId, 256) &&
    isText(value.cardId, 256) &&
    isProjectionZone(value.zone) &&
    isText(value.controllerId) &&
    isText(value.ownerPlayerId) &&
    playerIds.includes(value.controllerId) &&
    playerIds.includes(value.ownerPlayerId) &&
    value.faceUp === true &&
    (value.visibility === "public" || value.visibility === "private") &&
    (value.counters === undefined || isCounterMap(value.counters)) &&
    (value.damage === undefined || isSafeInteger(value.damage)) &&
    (value.visibility === "public"
      ? value.zone !== "hand" && value.zone !== "deck" && value.zone !== "rune-deck"
      : viewerPlayerId !== null &&
        value.zone === "hand" &&
        value.ownerPlayerId === viewerPlayerId);
}

function isPlayerProjection(
  value: unknown,
  viewerPlayerId: string | null
): value is FullProductPlayerProjection {
  return isRecord(value) &&
    hasExactKeys(value, [
      "id",
      "name",
      "score",
      "energy",
      "power",
      "handCount",
      "zoneCounts",
      "playableInstanceIds"
    ]) &&
    isText(value.id) &&
    isText(value.name, 128) &&
    isSafeInteger(value.score) &&
    isSafeInteger(value.energy) &&
    isCounterMap(value.power) &&
    isSafeInteger(value.handCount) &&
    isRecord(value.zoneCounts) &&
    Object.entries(value.zoneCounts).every(([zone, count]) =>
      isProjectionZone(zone) && isSafeInteger(count)) &&
    (value.playableInstanceIds === null ||
      (isUniqueStringArray(value.playableInstanceIds, 256) &&
        (viewerPlayerId === null || value.id === viewerPlayerId)));
}

function isContiguousEventWindow(
  events: readonly { seq: number }[],
  afterEventSeq: number,
  nextEventSeq: number
): boolean {
  let expected = afterEventSeq + 1;
  for (const event of events) {
    if (event.seq !== expected || event.seq > nextEventSeq) return false;
    expected += 1;
  }
  return expected === nextEventSeq + 1;
}

export function isFullProductProjection(
  value: unknown
): value is FullProductProjection {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, [
      "projectionContract",
      "protocolVersion",
      "rulesetId",
      "viewerPlayerId",
      "version",
      "eventSeq",
      "phase",
      "turnNumber",
      "activePlayerId",
      "priorityPlayerId",
      "winnerPlayerId",
      "waitingForPlayerId",
      "prompt",
      "players",
      "objects",
      "events"
    ])) return false;
  if (value.projectionContract !== FULL_PRODUCT_PROJECTION_CONTRACT) return false;
  if (value.protocolVersion !== FULL_PRODUCT_PROTOCOL_VERSION) return false;
  if (value.rulesetId !== FULL_PRODUCT_RULESET_ID) return false;
  if (value.viewerPlayerId !== null && !isText(value.viewerPlayerId)) return false;
  if (!isSafeInteger(value.version)) return false;
  if (!isSafeInteger(value.eventSeq)) return false;
  if (value.phase !== "main" && value.phase !== "ended") return false;
  if (!isSafeInteger(value.turnNumber, 1)) return false;
  if (!isText(value.activePlayerId)) return false;
  if (!isText(value.priorityPlayerId)) return false;
  if (value.winnerPlayerId !== null && !isText(value.winnerPlayerId)) return false;
  if ((value.prompt === null) !== (value.waitingForPlayerId === null)) return false;
  if (value.waitingForPlayerId !== null && !isText(value.waitingForPlayerId)) return false;
  if (value.prompt !== null && !isFullProductPrompt(value.prompt)) return false;
  if (!Array.isArray(value.players) || (value.players as unknown[]).length !== 2) return false;
  if (!(value.players as unknown[]).every(player =>
      isPlayerProjection(player, value.viewerPlayerId as string | null))) return false;
  if (!Array.isArray(value.objects)) return false;
  if (!(value.objects as unknown[]).every(object =>
      isProjectionObject(object, value.viewerPlayerId as string | null,
        (value.players as FullProductPlayerProjection[]).map(player => player.id)))) return false;
  if (!Array.isArray(value.events) ||
      !(value.events as unknown[]).every(isFullProductGameEvent)) return false;

  const players = value.players as FullProductPlayerProjection[];
  const playerIds = players.map(player => player.id);
  const viewerPlayerId = value.viewerPlayerId as string | null;
  const objects = value.objects as FullProductProjectionObject[];
  const events = value.events as FullProductGameEvent[];
  if (new Set(playerIds).size !== 2 ||
      !playerIds.includes(value.activePlayerId as string) ||
      !playerIds.includes(value.priorityPlayerId as string) ||
      (value.winnerPlayerId !== null &&
        !playerIds.includes(value.winnerPlayerId as string)) ||
      (value.waitingForPlayerId !== null &&
        !playerIds.includes(value.waitingForPlayerId as string)) ||
      (viewerPlayerId !== null && !playerIds.includes(viewerPlayerId))) {
    return false;
  }

  if (value.prompt !== null) {
    const prompt = value.prompt as FullProductPrompt;
    if (viewerPlayerId !== null && viewerPlayerId !== prompt.ownerPlayerId) {
      return false;
    }
    if (prompt.ownerPlayerId !== value.waitingForPlayerId) {
      return false;
    }
  }

  if (new Set(objects.map(object => object.objectId)).size !== objects.length) {
    return false;
  }

  const viewer = players.find(player => player.id === viewerPlayerId) ?? null;
  if (viewer === null) {
    if (objects.some(object => object.visibility === "private") ||
        players.some(player => player.playableInstanceIds !== null)) {
      return false;
    }
  } else {
    const handObjects = objects.filter(object =>
      object.zone === "hand" && object.ownerPlayerId === viewer.id);
    if (viewer.handCount !== handObjects.length ||
        (viewer.playableInstanceIds !== null &&
          !viewer.playableInstanceIds.every(instanceId =>
            handObjects.some(object => object.objectId === instanceId)))) {
      return false;
    }
    if (players.some(player =>
      player.id !== viewer.id && player.playableInstanceIds !== null)) {
      return false;
    }
  }

  if (objects.some(object =>
      object.zone !== "hand" &&
      playerIds.includes(object.ownerPlayerId) &&
      !playerIds.includes(object.controllerId))) {
    return false;
  }

  return isContiguousEventWindow(events, 0, value.eventSeq as number) &&
    events.every(event =>
      event.turnNumber <= (value.turnNumber as number) &&
      playerIds.includes(event.activePlayerId) &&
      playerIds.includes(event.priorityPlayerId)) &&
    (value.phase === "ended"
      ? value.winnerPlayerId !== null && events.at(-1)?.type === "game-ended"
      : value.winnerPlayerId === null && events.every(event =>
          event.type !== "game-ended"));
}

export function isCompatibleFullProductProtocolVersion(
  value: unknown
): value is FullProductCompatibilityVersion {
  return typeof value === "string" &&
    (FULL_PRODUCT_COMPATIBLE_PROTOCOL_VERSIONS as readonly string[])
      .includes(value);
}

export function isFullProductResumeRequest(
  value: unknown
): value is FullProductResumeRequest {
  return isRecord(value) &&
    hasExactKeys(value, [
      "type",
      "protocolVersion",
      "roomId",
      "resumeToken",
      "afterEventSeq",
      "afterRoomEventSeq"
    ]) &&
    value.type === "resume" &&
    isCompatibleFullProductProtocolVersion(value.protocolVersion) &&
    isText(value.roomId, 64) &&
    isText(value.resumeToken, 128) &&
    isSafeInteger(value.afterEventSeq) &&
    isSafeInteger(value.afterRoomEventSeq);
}

export function isFullProductResumeBackfill(
  value: unknown
): value is FullProductResumeBackfill {
  if (!(isRecord(value) &&
    hasExactKeys(value, [
      "type",
      "roomId",
      "projection",
      "afterEventSeq",
      "nextEventSeq",
      "events",
      "roomVersion",
      "afterRoomEventSeq",
      "nextRoomEventSeq"
    ]) &&
    value.type === "resume-backfill" &&
    isText(value.roomId, 64) &&
    isFullProductProjection(value.projection) &&
    isSafeInteger(value.afterEventSeq) &&
    isSafeInteger(value.nextEventSeq) &&
    (value.afterEventSeq as number) <= (value.nextEventSeq as number) &&
    Array.isArray(value.events) &&
    (value.events as unknown[]).every(isFullProductGameEvent) &&
    isSafeInteger(value.roomVersion) &&
    isSafeInteger(value.afterRoomEventSeq) &&
    isSafeInteger(value.nextRoomEventSeq) &&
    (value.afterRoomEventSeq as number) <=
      (value.nextRoomEventSeq as number))) {
    return false;
  }

  const projection = value.projection as FullProductProjection;
  return projection.eventSeq === (value.nextEventSeq as number) &&
    isContiguousEventWindow(
      value.events as FullProductGameEvent[],
      value.afterEventSeq as number,
      value.nextEventSeq as number
    );
}

export function isFullProductCommandReceipt(
  value: unknown
): value is FullProductCommandReceipt {
  return isRecord(value) &&
    hasExactKeys(value, [
      "type",
      "requestId",
      "commandId",
      "duplicate",
      "appliedVersion",
      "eventSeq",
      "roomVersion",
      "roomEventSeq"
    ]) &&
    value.type === "command-result" &&
    isText(value.requestId, 256) &&
    isText(value.commandId, 256) &&
    typeof value.duplicate === "boolean" &&
    isSafeInteger(value.appliedVersion) &&
    isSafeInteger(value.eventSeq) &&
    isSafeInteger(value.roomVersion) &&
    isSafeInteger(value.roomEventSeq);
}

function sameTargets(
  left: readonly FullProductTargetSelection[],
  right: readonly FullProductTargetSelection[]
): boolean {
  return left.length === right.length &&
    left.every((target, index) =>
      target.targetKind === right[index]?.targetKind &&
      target.targetId === right[index]?.targetId);
}

export function isSameFullProductCommandIntent(
  left: FullProductCommandEnvelope,
  right: FullProductCommandEnvelope
): boolean {
  if (left.commandId !== right.commandId ||
      left.command.type !== right.command.type) {
    return false;
  }

  switch (left.command.type) {
    case "pass":
    case "concede":
      return true;
    case "play-card":
      return right.command.type === "play-card" &&
        left.command.instanceId === right.command.instanceId &&
        sameTargets(left.command.targets, right.command.targets);
    case "respond-to-prompt":
      return right.command.type === "respond-to-prompt" &&
        left.command.promptId === right.command.promptId &&
        left.command.optionId === right.command.optionId &&
        sameTargets(left.command.targets, right.command.targets);
  }
}

export const FULL_PRODUCT_LEGACY_PROJECTION_CONTRACT = PROJECTION_SCHEMA_V1;
