import {
  PROTOCOL_V2_EVENT_CONTRACT,
  PROTOCOL_V2_JOURNAL_FORMAT,
  PROTOCOL_V2_JOURNAL_VERSION,
  PROTOCOL_V2_RULESET_VERSION,
  V2_TIMING_POINT_IDS,
  V2_VISIBILITY_LEVELS,
  isV2TimingPointId,
  type V2TimingPointId,
  type V2VisibilityLevel
} from "./constants.js";

export type V2JsonValue = null | boolean | number | string | readonly V2JsonValue[] | V2JsonObject;
export interface V2JsonObject { readonly [key: string]: V2JsonValue }

export interface V2PublicField<T extends V2JsonValue = V2JsonValue> {
  readonly visibility: "public";
  readonly value: T;
}
export interface V2OwnerOnlyField<T extends V2JsonValue = V2JsonValue> {
  readonly visibility: "owner-only";
  readonly ownerPlayerId: string;
  readonly value: T;
}
export interface V2HiddenField {
  readonly visibility: "hidden";
}
export type V2EventField<T extends V2JsonValue = V2JsonValue> =
  | V2PublicField<T>
  | V2OwnerOnlyField<T>
  | V2HiddenField;

export type V2EventPayload = Readonly<Record<string, V2EventField>>;

export type V2EventAudience =
  | { readonly visibility: "public" }
  | { readonly visibility: "owner-only"; readonly ownerPlayerId: string }
  | { readonly visibility: "hidden" };

/** A journal-compatible event emitted by the engine timing/event pipeline. */
export interface V2EngineEvent {
  readonly contract: typeof PROTOCOL_V2_EVENT_CONTRACT;
  readonly seq: number;
  readonly eventSeq: number;
  readonly stateVersion: number;
  readonly timingPoint: V2TimingPointId;
  readonly audience: V2EventAudience;
  readonly payload: V2EventPayload;
}

export type V2Event = V2EngineEvent;
export type ProtocolV2Event = V2EngineEvent;
export type V2ServerEvent = V2EngineEvent;

export interface V2EventJournalRecord {
  readonly kind: "event";
  readonly contract: typeof PROTOCOL_V2_EVENT_CONTRACT;
  readonly seq: number;
  readonly eventSeq: number;
  readonly stateVersion: number;
  readonly timingPoint: V2TimingPointId;
  readonly audience: V2EventAudience;
  readonly payload: V2EventPayload;
  readonly rulesetVersion: typeof PROTOCOL_V2_RULESET_VERSION;
  readonly journalFormat: typeof PROTOCOL_V2_JOURNAL_FORMAT;
  readonly journalVersion: typeof PROTOCOL_V2_JOURNAL_VERSION;
}

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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function json(value: unknown, depth = 0): value is V2JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).length === value.length + 1 && value.every(item => json(item, depth + 1));
  if (!data(value)) return false;
  return Object.values(value).every(item => json(item, depth + 1));
}

function field(value: unknown): value is V2EventField {
  if (!data(value) || typeof value.visibility !== "string" ||
      !(V2_VISIBILITY_LEVELS as readonly string[]).includes(value.visibility)) return false;
  if (value.visibility === "hidden") return exact(value, ["visibility"]);
  if (value.visibility === "owner-only") {
    return exact(value, ["visibility", "ownerPlayerId", "value"]) && text(value.ownerPlayerId) && json(value.value);
  }
  return exact(value, ["visibility", "value"]) && json(value.value);
}

function payload(value: unknown): value is V2EventPayload {
  return data(value) && Object.values(value).every(field);
}

function audience(value: unknown): value is V2EventAudience {
  if (!data(value) || typeof value.visibility !== "string") return false;
  if (value.visibility === "public") return exact(value, ["visibility"]);
  if (value.visibility === "hidden") return exact(value, ["visibility"]);
  return value.visibility === "owner-only" && exact(value, ["visibility", "ownerPlayerId"]) && text(value.ownerPlayerId);
}

function audiencePayloadCompatible(audienceValue: V2EventAudience, payloadValue: V2EventPayload): boolean {
  return Object.values(payloadValue).every(item => {
    if (audienceValue.visibility === "hidden") return item.visibility === "hidden";
    if (audienceValue.visibility === "owner-only") {
      return item.visibility === "hidden" || item.visibility === "public" ||
        (item.visibility === "owner-only" && item.ownerPlayerId === audienceValue.ownerPlayerId);
    }
    return true;
  });
}

export function isV2EngineEvent(value: unknown): value is V2EngineEvent {
  return data(value) && exact(value, ["contract", "seq", "eventSeq", "stateVersion", "timingPoint", "audience", "payload"]) &&
    value.contract === PROTOCOL_V2_EVENT_CONTRACT && count(value.seq) && value.seq > 0 && count(value.eventSeq) &&
    value.eventSeq > 0 && count(value.stateVersion) && isV2TimingPointId(value.timingPoint) &&
    audience(value.audience) && payload(value.payload) && audiencePayloadCompatible(value.audience, value.payload);
}

export function isV2EventJournalRecord(value: unknown): value is V2EventJournalRecord {
  return data(value) && exact(value, [
    "kind", "contract", "seq", "eventSeq", "stateVersion", "timingPoint", "audience", "payload",
    "rulesetVersion", "journalFormat", "journalVersion"
  ]) && value.kind === "event" && value.contract === PROTOCOL_V2_EVENT_CONTRACT && count(value.seq) && value.seq > 0 && count(value.eventSeq) &&
    value.eventSeq > 0 && count(value.stateVersion) && isV2TimingPointId(value.timingPoint) &&
    audience(value.audience) && payload(value.payload) && audiencePayloadCompatible(value.audience, value.payload) && value.rulesetVersion === PROTOCOL_V2_RULESET_VERSION &&
    value.journalFormat === PROTOCOL_V2_JOURNAL_FORMAT && value.journalVersion === PROTOCOL_V2_JOURNAL_VERSION;
}

export function isV2EventField(value: unknown): value is V2EventField {
  return field(value);
}

export function isV2EventPayload(value: unknown): value is V2EventPayload {
  return payload(value);
}

export const isProtocolV2Event = isV2EngineEvent;
export const isV2ProtocolEvent = isV2EngineEvent;
export const V2_TIMING_POINTS = V2_TIMING_POINT_IDS;
