import { PROTOCOL_V2_COMMAND_CONTRACT, PROTOCOL_V2_EVENT_CONTRACT, PROTOCOL_V2_PROJECTION_CONTRACT, PROTOCOL_V2_VERSION } from "./constants.js";
import type { V2Command, V2CommandEnvelope } from "./commands.js";
import { isV2Command, isV2CommandEnvelope } from "./command-guards.js";
import type { V2EngineEvent } from "./events.js";
import { isV2EngineEvent } from "./events.js";
import type { V2Projection } from "./projection.js";
import { isV2Projection } from "./projection.js";

export interface V2CommandMessage {
  readonly type: "command";
  readonly protocolVersion: typeof PROTOCOL_V2_VERSION;
  readonly command: V2Command;
}

export interface V2ProjectionMessage {
  readonly type: "projection";
  readonly protocolVersion: typeof PROTOCOL_V2_VERSION;
  readonly projection: V2Projection;
}

export interface V2EventMessage {
  readonly type: "event";
  readonly protocolVersion: typeof PROTOCOL_V2_VERSION;
  readonly event: V2EngineEvent;
}

export interface V2CommandReceipt {
  readonly type: "command-receipt";
  readonly protocolVersion: typeof PROTOCOL_V2_VERSION;
  readonly commandId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly rejection: string | null;
}

export type V2ClientMessage = V2CommandMessage;
export type V2ServerMessage = V2ProjectionMessage | V2EventMessage | V2CommandReceipt;

type Data = Record<string, unknown>;
function data(value: unknown): value is Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Reflect.ownKeys(value).every(key => typeof key === "string" && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
function exact(value: Data, required: readonly string[]): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key));
}
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

export function isV2CommandMessage(value: unknown): value is V2CommandMessage {
  return data(value) && exact(value, ["type", "protocolVersion", "command"]) && value.type === "command" &&
    value.protocolVersion === PROTOCOL_V2_VERSION && isV2Command(value.command);
}
export function isV2ProjectionMessage(value: unknown): value is V2ProjectionMessage {
  return data(value) && exact(value, ["type", "protocolVersion", "projection"]) && value.type === "projection" &&
    value.protocolVersion === PROTOCOL_V2_VERSION && isV2Projection(value.projection);
}
export function isV2EventMessage(value: unknown): value is V2EventMessage {
  return data(value) && exact(value, ["type", "protocolVersion", "event"]) && value.type === "event" &&
    value.protocolVersion === PROTOCOL_V2_VERSION && isV2EngineEvent(value.event);
}
export function isV2CommandReceipt(value: unknown): value is V2CommandReceipt {
  return data(value) && exact(value, ["type", "protocolVersion", "commandId", "stateVersion", "eventSeq", "accepted", "duplicate", "rejection"]) &&
    value.type === "command-receipt" && value.protocolVersion === PROTOCOL_V2_VERSION && text(value.commandId) &&
    count(value.stateVersion) && count(value.eventSeq) && typeof value.accepted === "boolean" && typeof value.duplicate === "boolean" &&
    (value.rejection === null || text(value.rejection));
}
export function isV2ClientMessage(value: unknown): value is V2ClientMessage { return isV2CommandMessage(value); }
export function isV2ServerMessage(value: unknown): value is V2ServerMessage {
  return isV2ProjectionMessage(value) || isV2EventMessage(value) || isV2CommandReceipt(value);
}

/** Explicit contract tags used by routers when dispatching v2 packets. */
export const V2_TRANSPORT_CONTRACTS = Object.freeze({
  command: PROTOCOL_V2_COMMAND_CONTRACT,
  event: PROTOCOL_V2_EVENT_CONTRACT,
  projection: PROTOCOL_V2_PROJECTION_CONTRACT
});

export type { V2CommandEnvelope };
export { isV2CommandEnvelope };
