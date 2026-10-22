import {
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  V2_ZONES,
  isV2Phase,
  isV2TimingPointId,
  isV2Zone,
  type V2Phase,
  type V2Zone
} from "./constants.js";
import type { V2Event } from "./events.js";
import type { V2Location } from "./commands.js";

export type V2ProjectionVisibility =
  | { readonly visibility: "public" }
  | { readonly visibility: "owner-only"; readonly ownerPlayerId: string }
  | { readonly visibility: "hidden" };

export interface V2ProjectedObject {
  readonly objectId: string;
  readonly zoneEntryId?: number;
  readonly zone: V2Zone;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId?: string;
  readonly cardId?: string;
  readonly name?: string;
  readonly faceDown: boolean;
  readonly visibility: "public" | "owner-only";
  readonly location?: V2Location;
  readonly exhausted?: boolean;
  readonly damage?: number;
  readonly might?: number;
  readonly counters?: Readonly<Record<string, number>>;
}

export interface V2ZoneSnapshot {
  readonly zone: V2Zone;
  readonly ownerPlayerId: string;
  readonly count: number;
  /** Present only when every listed object is visible to the authenticated viewer. */
  readonly objects?: readonly V2ProjectedObject[];
  /** Deck and Rune Deck order is never projected, including to the owner. */
  readonly order?: readonly string[];
}

export interface V2PlayerSnapshot {
  readonly playerId: string;
  readonly name: string;
  readonly score: number;
  readonly energy: number;
  readonly power: Readonly<Record<string, number>>;
  readonly xp: number;
  readonly handCount: number;
  readonly deckCount: number;
  readonly runeDeckCount: number;
  readonly zoneCounts: Readonly<Partial<Record<V2Zone, number>>>;
}

export interface V2ChainItemSnapshot {
  readonly itemId: string;
  readonly controllerPlayerId: string;
  readonly status: "pending" | "finalized" | "resolving";
  readonly kind: "spell" | "unit" | "gear" | "activated" | "triggered" | "add" | "unknown";
  readonly sourceObjectId?: string;
  readonly sourceVisibility?: "public" | "owner-only";
}

export interface V2ChainSnapshot {
  readonly status: "open" | "closed" | "handoff";
  readonly phase: "open" | "finalize" | "execute" | "resolve" | "await-commit" | "handoff";
  readonly priorityPlayerId: string | null;
  readonly focusPlayerId: string | null;
  readonly items: readonly V2ChainItemSnapshot[];
}

export interface V2PrioritySnapshot {
  readonly playerId: string | null;
  readonly focusPlayerId: string | null;
  readonly window: "open" | "closed" | "showdown" | "choice";
}

export interface V2ScoringSnapshot {
  readonly victoryScore: number;
  readonly battlefieldLocationIds: readonly string[];
  readonly players: readonly {
    readonly playerId: string;
    readonly points: number;
    readonly controlledBattlefieldIds: readonly string[];
    readonly scoredBattlefieldLocationIds: readonly string[];
  }[];
}

export interface V2BattlefieldSnapshot {
  readonly battlefieldId: string;
  readonly controllerPlayerId: string | null;
  readonly contestedByPlayerId: string | null;
  readonly staged: "none" | "showdown" | "combat";
  readonly occupantObjectIds: readonly string[];
}

export interface V2CombatSnapshot {
  readonly status: "none" | "active";
  readonly battlefieldId?: string;
  readonly step?: "showdown" | "damage" | "cleanup" | "result" | "control" | "end";
  readonly combatId?: string;
  readonly attackerPlayerId?: string;
  readonly defenderPlayerId?: string;
  readonly damage?: {
    readonly attackerMight: number;
    readonly defenderMight: number;
    readonly attackerSubmitted: boolean;
    readonly expectedPlayerId: string;
  };
}

export interface V2PlayOption {
  readonly cardObjectId: string;
  readonly destination: V2Location;
}

export interface V2MoveOption {
  readonly objectId: string;
  readonly destination: V2Location;
}

export interface V2ActionOptions {
  readonly canEndTurn: boolean;
  /** Present on current servers; older projections omit this extension. */
  readonly canAdvance?: boolean;
  readonly moves: readonly V2MoveOption[];
  /** The viewer can play a hand card without target/payment selections. */
  readonly plays: readonly V2PlayOption[];
}

export interface V2ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly value?: string | number | boolean;
}

export type V2PendingChoice =
  | {
      readonly status: "pending";
      readonly choiceId: string;
      readonly ownerPlayerId: string;
      readonly stateVersion: number;
      readonly kind: "optional" | "mode" | "select-objects" | "order" | "number";
      readonly options?: readonly V2ChoiceOption[];
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly status: "none" };

export interface V2Projection {
  readonly projectionContract: typeof PROTOCOL_V2_PROJECTION_CONTRACT;
  readonly protocolVersion: typeof PROTOCOL_V2_VERSION;
  readonly rulesetVersion: "core-1.5";
  readonly matchId: string;
  readonly viewerPlayerId: string | null;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly phase: V2Phase;
  readonly turnNumber: number;
  readonly activePlayerId: string;
  readonly players: readonly V2PlayerSnapshot[];
  readonly zones: readonly V2ZoneSnapshot[];
  readonly objects: readonly V2ProjectedObject[];
  readonly chain: V2ChainSnapshot;
  readonly priority: V2PrioritySnapshot;
  readonly scoring: V2ScoringSnapshot;
  readonly battlefields: readonly V2BattlefieldSnapshot[];
  readonly combat: V2CombatSnapshot;
  readonly actionOptions: V2ActionOptions;
  readonly pendingChoice: V2PendingChoice;
  readonly winnerPlayerId: string | null;
  readonly events: readonly V2Event[];
}

export type ProtocolV2Projection = V2Projection;
export type V2ProjectionSnapshot = V2Projection;

type Data = Record<string, unknown>;

function data(value: unknown): value is Data {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor?.enumerable === true && "value" in descriptor;
    });
  } catch { return false; }
}
function exact(value: Data, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key));
}
function text(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function map(value: unknown): value is Data {
  return data(value) && Object.entries(value).every(([key, numberValue]) => text(key, 64) && count(numberValue));
}
function ids(value: unknown): value is readonly string[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
    value.every(item => text(item)) && new Set(value).size === value.length;
}
function location(value: unknown): value is V2Location {
  if (!data(value) || typeof value.kind !== "string") return false;
  if (value.kind === "base") return exact(value, ["kind", "playerId"]) && text(value.playerId);
  return value.kind === "battlefield" && exact(value, ["kind", "battlefieldId"]) && text(value.battlefieldId);
}
function visibility(value: unknown): value is "public" | "owner-only" {
  return value === "public" || value === "owner-only";
}
function object(value: unknown, viewer: string | null): value is V2ProjectedObject {
  if (!data(value) || !exact(value, ["objectId", "zone", "ownerPlayerId", "faceDown", "visibility"],
    ["zoneEntryId", "controllerPlayerId", "cardId", "name", "location", "exhausted", "damage", "might", "counters"]) ||
      !text(value.objectId) || !isV2Zone(value.zone) || !text(value.ownerPlayerId) || typeof value.faceDown !== "boolean" ||
      !visibility(value.visibility)) return false;
  if (value.zoneEntryId !== undefined && !count(value.zoneEntryId)) return false;
  if (value.controllerPlayerId !== undefined && !text(value.controllerPlayerId)) return false;
  if (value.cardId !== undefined && !text(value.cardId)) return false;
  if (value.name !== undefined && !text(value.name)) return false;
  if (value.location !== undefined && !location(value.location)) return false;
  if (value.exhausted !== undefined && typeof value.exhausted !== "boolean") return false;
  for (const key of ["damage", "might"] as const) if (value[key] !== undefined && !count(value[key])) return false;
  if (value.counters !== undefined && !map(value.counters)) return false;
  if (value.faceDown && value.cardId !== undefined) return false;
  if ((value.zone === "deck" || value.zone === "rune-deck" || value.zone === "facedown") &&
      (value.cardId !== undefined || value.name !== undefined)) return false;
  if (value.visibility === "owner-only" && value.ownerPlayerId !== viewer) return false;
  if (value.visibility === "public" && value.zone === "hand" && value.ownerPlayerId !== viewer) return false;
  return true;
}
function zone(value: unknown, viewer: string | null): value is V2ZoneSnapshot {
  if (!data(value) || !exact(value, ["zone", "ownerPlayerId", "count"], ["objects", "order"]) ||
      !isV2Zone(value.zone) || !text(value.ownerPlayerId) || !count(value.count)) return false;
  if (value.zone === "deck" || value.zone === "rune-deck" || value.zone === "facedown") {
    if (value.objects !== undefined || value.order !== undefined) return false;
  }
  if (value.order !== undefined && !ids(value.order)) return false;
  if (value.objects !== undefined && (!Array.isArray(value.objects) || !value.objects.every(item => object(item, viewer)))) return false;
  if (value.objects !== undefined && value.objects.length !== value.count) return false;
  if (value.zone === "hand" && value.ownerPlayerId !== viewer && value.objects !== undefined) return false;
  return true;
}
function player(value: unknown): boolean {
  if (!data(value) || !exact(value, ["playerId", "name", "score", "energy", "power", "xp", "handCount", "deckCount", "runeDeckCount", "zoneCounts"]) ||
      !text(value.playerId) || !text(value.name) || !count(value.score) || !count(value.energy) || !map(value.power) ||
      !count(value.xp) || !count(value.handCount) || !count(value.deckCount) || !count(value.runeDeckCount) || !map(value.zoneCounts)) return false;
  return Object.keys(value.zoneCounts).every(key => (V2_ZONES as readonly string[]).includes(key));
}
function chain(value: unknown, viewer: string | null): boolean {
  if (!data(value) || !exact(value, ["status", "phase", "priorityPlayerId", "focusPlayerId", "items"]) ||
      !["open", "closed", "handoff"].includes(value.status as string) ||
      !["open", "finalize", "execute", "resolve", "await-commit", "handoff"].includes(value.phase as string) ||
      (value.priorityPlayerId !== null && !text(value.priorityPlayerId)) ||
      (value.focusPlayerId !== null && !text(value.focusPlayerId)) || !Array.isArray(value.items)) return false;
  return value.items.every(item => {
    if (!data(item) || !exact(item, ["itemId", "controllerPlayerId", "status", "kind"], ["sourceObjectId", "sourceVisibility"]) ||
        !text(item.itemId) || !text(item.controllerPlayerId) || !["pending", "finalized", "resolving"].includes(item.status as string) ||
        !["spell", "unit", "gear", "activated", "triggered", "add", "unknown"].includes(item.kind as string)) return false;
    if (item.sourceObjectId !== undefined && (!text(item.sourceObjectId) || item.sourceVisibility === undefined)) return false;
    if (item.sourceVisibility !== undefined && !visibility(item.sourceVisibility)) return false;
    return item.sourceVisibility !== "owner-only" || viewer === item.controllerPlayerId;
  });
}
function priority(value: unknown): boolean {
  return data(value) && exact(value, ["playerId", "focusPlayerId", "window"]) &&
    (value.playerId === null || text(value.playerId)) && (value.focusPlayerId === null || text(value.focusPlayerId)) &&
    ["open", "closed", "showdown", "choice"].includes(value.window as string);
}
function scoring(value: unknown): boolean {
  if (!data(value) || !exact(value, ["victoryScore", "battlefieldLocationIds", "players"]) || !count(value.victoryScore) ||
      !ids(value.battlefieldLocationIds) || !Array.isArray(value.players)) return false;
  return value.players.every(item => data(item) && exact(item, ["playerId", "points", "controlledBattlefieldIds", "scoredBattlefieldLocationIds"]) &&
    text(item.playerId) && count(item.points) && ids(item.controlledBattlefieldIds) && ids(item.scoredBattlefieldLocationIds));
}
function battlefield(value: unknown): boolean {
  return data(value) && exact(value, ["battlefieldId", "controllerPlayerId", "contestedByPlayerId", "staged", "occupantObjectIds"]) &&
    text(value.battlefieldId) && (value.controllerPlayerId === null || text(value.controllerPlayerId)) &&
    (value.contestedByPlayerId === null || text(value.contestedByPlayerId)) &&
    ["none", "showdown", "combat"].includes(value.staged as string) && ids(value.occupantObjectIds);
}
function combat(value: unknown): boolean {
  if (!data(value) || typeof value.status !== "string") return false;
  if (value.status === "none") return exact(value, ["status"]);
  if (value.status !== "active" || !text(value.battlefieldId) || !text(value.step)) return false;
  if (!exact(value, ["status", "battlefieldId", "step"], ["combatId", "attackerPlayerId", "defenderPlayerId", "damage"]) ||
      !["showdown", "damage", "cleanup", "result", "control", "end"].includes(value.step)) return false;
  const identityPresent = value.combatId !== undefined || value.attackerPlayerId !== undefined || value.defenderPlayerId !== undefined;
  if (!identityPresent) return value.step === "showdown" && value.damage === undefined;
  if (!text(value.combatId) || !text(value.attackerPlayerId) || !text(value.defenderPlayerId)) return false;
  if (value.damage === undefined) return true;
  return data(value.damage) && exact(value.damage,
    ["attackerMight", "defenderMight", "attackerSubmitted", "expectedPlayerId"]) &&
    count(value.damage.attackerMight) && count(value.damage.defenderMight) &&
    typeof value.damage.attackerSubmitted === "boolean" && text(value.damage.expectedPlayerId);
}
function commandLocation(value: unknown): value is V2Location {
  if (!data(value) || typeof value.kind !== "string") return false;
  if (value.kind === "base") return exact(value, ["kind", "playerId"]) && text(value.playerId);
  return value.kind === "battlefield" && exact(value, ["kind", "battlefieldId"]) && text(value.battlefieldId);
}
function playOption(value: unknown): boolean {
  return data(value) && exact(value, ["cardObjectId", "destination"]) &&
    text(value.cardObjectId) && commandLocation(value.destination);
}
function moveOption(value: unknown): boolean {
  return data(value) && exact(value, ["objectId", "destination"]) &&
    text(value.objectId) && commandLocation(value.destination);
}
function actionOptions(value: unknown): boolean {
  return data(value) && exact(value, ["canEndTurn", "moves", "plays"], ["canAdvance"]) &&
    typeof value.canEndTurn === "boolean" && (value.canAdvance === undefined || typeof value.canAdvance === "boolean") &&
    Array.isArray(value.moves) && value.moves.every(moveOption) &&
    Array.isArray(value.plays) && value.plays.every(playOption);
}
function pendingChoice(value: unknown, viewer: string | null): boolean {
  if (!data(value) || !text(value.status, 32)) return false;
  if (value.status === "none") return exact(value, ["status"]);
  if (!exact(value, ["status", "choiceId", "ownerPlayerId", "stateVersion", "kind"], ["options", "min", "max"]) ||
      !text(value.choiceId) || !text(value.ownerPlayerId) || !count(value.stateVersion) ||
      !["optional", "mode", "select-objects", "order", "number"].includes(value.kind as string)) return false;
  if (value.options !== undefined) {
    if (value.ownerPlayerId !== viewer || !Array.isArray(value.options) || value.options.length === 0) return false;
    if (!value.options.every(option => data(option) && exact(option, ["id", "label"], ["value"]) && text(option.id) && text(option.label) &&
      (option.value === undefined || typeof option.value === "string" || typeof option.value === "number" || typeof option.value === "boolean"))) return false;
  }
  if (value.min !== undefined && !count(value.min)) return false;
  if (value.max !== undefined && !count(value.max)) return false;
  return value.min === undefined || value.max === undefined || value.min <= value.max;
}

export function isV2Projection(value: unknown): value is V2Projection {
  if (!data(value) || !exact(value, [
    "projectionContract", "protocolVersion", "rulesetVersion", "matchId", "viewerPlayerId",
    "stateVersion", "eventSeq", "phase", "turnNumber", "activePlayerId", "players", "zones",
    "objects", "chain", "priority", "scoring",
    "pendingChoice", "winnerPlayerId", "events"
  ], ["battlefields", "combat", "actionOptions"]) || value.projectionContract !== PROTOCOL_V2_PROJECTION_CONTRACT || value.protocolVersion !== PROTOCOL_V2_VERSION ||
      value.rulesetVersion !== "core-1.5" || !text(value.matchId) ||
      (value.viewerPlayerId !== null && !text(value.viewerPlayerId)) || !count(value.stateVersion) || !count(value.eventSeq) ||
      !isV2Phase(value.phase) || !count(value.turnNumber) || value.turnNumber < 1 || !text(value.activePlayerId) ||
      !Array.isArray(value.players) || !Array.isArray(value.zones) || !Array.isArray(value.objects) ||
      !Array.isArray(value.events) || (value.winnerPlayerId !== null && !text(value.winnerPlayerId))) return false;
  const viewer = value.viewerPlayerId as string | null;
  if (value.players.length === 0 || !value.players.every(player)) return false;
  const playerIds = value.players.map(item => (item as Data).playerId as string);
  if (!playerIds.includes(value.activePlayerId as string) || new Set(playerIds).size !== playerIds.length) return false;
  if (!value.zones.every(item => zone(item, viewer)) || !value.objects.every(item => object(item, viewer))) return false;
  if (!chain(value.chain, viewer) || !priority(value.priority) || !scoring(value.scoring) ||
      (value.battlefields !== undefined && (!Array.isArray(value.battlefields) || !value.battlefields.every(battlefield))) ||
      (value.combat !== undefined && !combat(value.combat)) ||
      (value.actionOptions !== undefined && !actionOptions(value.actionOptions)) ||
      !pendingChoice(value.pendingChoice, viewer)) return false;
  return value.events.every(item => {
    // Importing the event guard here would introduce a runtime cycle; validate the stable envelope fields.
    if (!data(item) || item.contract !== "riftbound.protocol.v2.event" || !count(item.seq) || !count(item.eventSeq) ||
        !count(item.stateVersion) || !isV2TimingPointId(item.timingPoint) || !data(item.audience) || !data(item.payload)) return false;
    if (item.audience.visibility === "hidden") return false;
    if (item.audience.visibility === "owner-only" &&
        (!text(item.audience.ownerPlayerId) || item.audience.ownerPlayerId !== viewer)) return false;
    return Object.values(item.payload).every(field => data(field) && typeof field.visibility === "string" &&
      (field.visibility === "hidden" || (field.visibility === "public" && Object.hasOwn(field, "value")) ||
        (field.visibility === "owner-only" && text(field.ownerPlayerId) && field.ownerPlayerId === viewer && Object.hasOwn(field, "value"))));
  });
}

export const isProtocolV2Projection = isV2Projection;
export const isV2ProtocolProjection = isV2Projection;
