import {
  isV2EngineEvent,
  isV2Projection,
  isV2ServerMessage,
  type V2EngineEvent,
  type V2Projection,
  type V2ServerMessage
} from "../../../../../packages/protocol/src/v2/index.js";
import {
  createV2ChoiceUiState,
  updateV2ChoiceUiState,
  type V2ChoiceUiState
} from "./choice.js";
import type {
  V2ApplyResult,
  V2ClientConnectionStatus,
  V2ClientState,
  V2StateOptions
} from "./types.js";

export function createV2ClientState(options: V2StateOptions = {}): V2ClientState {
  const pendingChoice = { status: "none" } as const;
  return {
    viewerPlayerId: options.viewerPlayerId ?? null,
    projection: null,
    stateVersion: 0,
    eventSeq: 0,
    events: [],
    bufferedEvents: [],
    choice: createV2ChoiceUiState(pendingChoice, {
      viewerPlayerId: options.viewerPlayerId,
      timeoutMs: options.choiceTimeoutMs,
      now: options.now
    }),
    connectionStatus: "disconnected",
    lastError: null,
    rejectedMessages: 0
  };
}

export function applyV2ServerMessage(
  state: V2ClientState,
  raw: unknown,
  options: Pick<V2StateOptions, "choiceTimeoutMs" | "now"> = {}
): V2ApplyResult {
  if (!isV2ServerMessage(raw)) return rejected(state, "Server packet failed the protocol v2 guard");
  if (raw.type === "projection") return applyV2Projection(state, raw.projection, options);
  if (raw.type === "event") return applyV2Event(state, raw.event);
  return applyV2ReceiptCursor(state, raw.stateVersion, raw.eventSeq);
}

export function applyV2Projection(
  state: V2ClientState,
  projection: V2Projection,
  options: Pick<V2StateOptions, "choiceTimeoutMs" | "now"> = {}
): V2ApplyResult {
  if (!isV2Projection(projection)) return rejected(state, "Projection failed the protocol v2 guard");
  if (state.viewerPlayerId !== null && projection.viewerPlayerId !== state.viewerPlayerId) {
    return rejected(state, "Projection belongs to a different viewer");
  }
  if (state.projection !== null && projection.matchId !== state.projection.matchId) {
    return rejected(state, "Projection belongs to a different match");
  }
  if (state.projection !== null && isStaleProjection(state, projection)) {
    return { accepted: false, duplicate: true, buffered: false, reason: "Stale projection", state };
  }

  const existing = new Map<number, V2EngineEvent>();
  for (const event of state.events) existing.set(event.eventSeq, event);
  for (const event of projection.events) if (isV2EngineEvent(event)) existing.set(event.eventSeq, event);
  for (const event of state.bufferedEvents) if (event.eventSeq > projection.eventSeq) existing.set(event.eventSeq, event);
  const events = [...existing.values()].sort((a, b) => a.eventSeq - b.eventSeq);
  const buffered = events.filter(event => event.eventSeq > projection.eventSeq);
  const nextChoice = updateV2ChoiceUiState(state.choice, projection.pendingChoice, {
    viewerPlayerId: state.viewerPlayerId,
    timeoutMs: options.choiceTimeoutMs,
    now: options.now
  });
  const next: V2ClientState = {
    ...state,
    projection,
    stateVersion: Math.max(state.stateVersion, projection.stateVersion),
    eventSeq: Math.max(state.eventSeq, projection.eventSeq),
    events,
    bufferedEvents: buffered,
    choice: nextChoice,
    lastError: null
  };
  return { accepted: true, duplicate: false, buffered: buffered.length > 0, state: next };
}

export function applyV2Event(state: V2ClientState, event: V2EngineEvent): V2ApplyResult {
  if (!isV2EngineEvent(event)) return rejected(state, "Event failed the protocol v2 guard");
  if (!eventVisibleToViewer(event, state.viewerPlayerId)) {
    return rejected(state, "Event is not addressed to this viewer");
  }
  if (event.eventSeq <= state.eventSeq || state.events.some(candidate => candidate.eventSeq === event.eventSeq) ||
    state.bufferedEvents.some(candidate => candidate.eventSeq === event.eventSeq)) {
    return { accepted: false, duplicate: true, buffered: false, reason: "Duplicate event", state };
  }

  const incoming = [...state.bufferedEvents, event].sort((a, b) => a.eventSeq - b.eventSeq);
  const contiguous: V2EngineEvent[] = [];
  let cursor = state.eventSeq;
  for (const candidate of incoming) {
    if (candidate.eventSeq !== cursor + 1) break;
    contiguous.push(candidate);
    cursor = candidate.eventSeq;
  }
  const contiguousIds = new Set(contiguous.map(candidate => candidate.eventSeq));
  const buffered = incoming.filter(candidate => !contiguousIds.has(candidate.eventSeq));
  const events = mergeEvents(state.events, contiguous);
  const next: V2ClientState = {
    ...state,
    stateVersion: Math.max(state.stateVersion, event.stateVersion),
    eventSeq: cursor,
    events,
    bufferedEvents: buffered,
    lastError: null
  };
  return {
    accepted: true,
    duplicate: false,
    buffered: contiguous.length === 0,
    state: next
  };
}

export function setV2ConnectionStatus(
  state: V2ClientState,
  connectionStatus: V2ClientConnectionStatus
): V2ClientState {
  return { ...state, connectionStatus };
}

export function refreshV2Choice(
  state: V2ClientState,
  options: { readonly now?: number; readonly choiceTimeoutMs?: number } = {}
): V2ClientState {
  if (state.projection === null) return state;
  const choice = updateV2ChoiceUiState(state.choice, state.projection.pendingChoice, {
    viewerPlayerId: state.viewerPlayerId,
    now: options.now,
    timeoutMs: options.choiceTimeoutMs
  });
  return { ...state, choice };
}

function applyV2ReceiptCursor(state: V2ClientState, stateVersion: number, eventSeq: number): V2ApplyResult {
  const next: V2ClientState = {
    ...state,
    stateVersion: Math.max(state.stateVersion, stateVersion),
    eventSeq: Math.max(state.eventSeq, eventSeq),
    lastError: null
  };
  return { accepted: true, duplicate: false, buffered: false, state: next };
}

function isStaleProjection(state: V2ClientState, projection: V2Projection): boolean {
  return projection.stateVersion < state.stateVersion ||
    (projection.stateVersion === state.stateVersion && projection.eventSeq < state.eventSeq);
}

function mergeEvents(existing: readonly V2EngineEvent[], incoming: readonly V2EngineEvent[]): readonly V2EngineEvent[] {
  const bySeq = new Map<number, V2EngineEvent>();
  for (const event of existing) bySeq.set(event.eventSeq, event);
  for (const event of incoming) bySeq.set(event.eventSeq, event);
  return [...bySeq.values()].sort((a, b) => a.eventSeq - b.eventSeq);
}

function eventVisibleToViewer(event: V2EngineEvent, viewer: string | null): boolean {
  if (event.audience.visibility === "hidden") return false;
  if (event.audience.visibility === "owner-only" && event.audience.ownerPlayerId !== viewer) return false;
  return Object.values(event.payload).every(field =>
    field.visibility !== "owner-only" || field.ownerPlayerId === viewer
  );
}

function rejected(state: V2ClientState, reason: string): V2ApplyResult {
  const next = {
    ...state,
    lastError: reason,
    rejectedMessages: state.rejectedMessages + 1
  };
  return { accepted: false, duplicate: false, buffered: false, reason, state: next };
}

export class V2ClientStateStore {
  private stateValue: V2ClientState;
  private readonly listeners = new Set<(state: V2ClientState, result?: V2ApplyResult) => void>();
  private readonly choiceTimeoutMs?: number;

  public constructor(options: V2StateOptions = {}) {
    this.stateValue = createV2ClientState(options);
    this.choiceTimeoutMs = options.choiceTimeoutMs;
  }

  public get state(): V2ClientState {
    return this.stateValue;
  }

  public subscribe(listener: (state: V2ClientState, result?: V2ApplyResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public apply(raw: unknown, now?: number): V2ApplyResult {
    const result = applyV2ServerMessage(this.stateValue, raw, {
      choiceTimeoutMs: this.choiceTimeoutMs,
      now
    });
    this.stateValue = result.state;
    for (const listener of this.listeners) listener(this.stateValue, result);
    return result;
  }

  public setConnectionStatus(status: V2ClientConnectionStatus): void {
    this.stateValue = setV2ConnectionStatus(this.stateValue, status);
    for (const listener of this.listeners) listener(this.stateValue);
  }

  public refreshChoice(now?: number): void {
    this.stateValue = refreshV2Choice(this.stateValue, { now, choiceTimeoutMs: this.choiceTimeoutMs });
    for (const listener of this.listeners) listener(this.stateValue);
  }
}

export const reduceV2ServerMessage = applyV2ServerMessage;
export const applyV2ProjectionMessage = applyV2Projection;
export const applyV2EventMessage = applyV2Event;
export const V2ProjectionStore = V2ClientStateStore;

