import { createHash, randomBytes } from "node:crypto";
import type {
  PlayerId,
  RoomDeckSubmission
} from "@riftbound/protocol";
import { FullProductOrchestrationError } from "./errors.js";
import { sanitizeProjection } from "./projection.js";
import type {
  FullProductRulesRuntime,
  FullProductRuntimeSnapshot
} from "./runtime.js";
import type {
  FullProductClientCommand,
  FullProductCommandReceipt,
  FullProductConnection,
  FullProductDeckValidator,
  FullProductLegalAction,
  FullProductMatchResult,
  FullProductMatchSummary,
  FullProductRoomEvent,
  FullProductRoomReceipt,
  FullProductRoomStatus,
  FullProductRoomView,
  FullProductReplayState,
  FullProductSession
} from "./types.js";
import type { FullProductSanitizedProjection } from "./runtime.js";

interface Seat {
  readonly id: PlayerId;
  readonly name: string;
  readonly resumeToken: string;
  deck: RoomDeckSubmission | null;
  ready: boolean;
  connectionId: string | null;
}

interface ProcessedCommand {
  readonly playerId: PlayerId;
  readonly payloadHash: string;
  readonly appliedVersion: number;
  readonly eventSeq: number;
}

export interface FullProductReconnectionState {
  readonly session: FullProductSession;
  readonly room: FullProductRoomView;
  readonly projection: FullProductSanitizedProjection | null;
  readonly afterEventSeq: number;
  readonly afterRoomEventSeq: number;
  readonly missedEvents: readonly unknown[];
  readonly missedRoomEvents: readonly FullProductRoomEvent[];
}

export interface FullProductOrchestratorOptions {
  readonly roomId: string;
  readonly runtime: FullProductRulesRuntime;
  readonly validateDeck: FullProductDeckValidator;
  readonly firstPlayerId?: PlayerId;
}

export class FullProductRoomOrchestrator {
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly connections = new Map<PlayerId, FullProductConnection>();
  private readonly processedCommands = new Map<string, ProcessedCommand>();
  private readonly roomEventLog: FullProductRoomEvent[] = [];
  private snapshot: FullProductRuntimeSnapshot | null = null;
  private roomVersion = 1;
  private roomEventSeq = 0;
  private matchEndedRecorded = false;

  constructor(private readonly options: FullProductOrchestratorOptions) {
    this.appendRoomEvent({ type: "room-created", playerId: "player-1" });
  }

  get roomId(): string {
    return this.options.roomId;
  }

  get status(): FullProductRoomStatus {
    if (this.snapshot === null) return "waiting";
    return this.snapshot.summary.phase === "ended" ? "ended" : "playing";
  }

  get currentRoomVersion(): number {
    return this.roomVersion;
  }

  get currentRoomEventSeq(): number {
    return this.roomEventSeq;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  get connectedPlayerCount(): number {
    return this.connections.size;
  }

  roomEvents(): readonly FullProductRoomEvent[] {
    return [...this.roomEventLog];
  }

  roomView(): FullProductRoomView {
    return {
      roomId: this.options.roomId,
      status: this.status,
      version: this.snapshot?.summary.version ?? 0,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      players: [...this.seats.values()].map(seat => ({
        id: seat.id,
        name: seat.name,
        connected: this.connections.has(seat.id),
        ready: seat.ready,
        deckSubmitted: seat.deck !== null
      }))
    };
  }

  join(playerName: string, connectionId: string): FullProductConnection {
    if (this.seats.size >= 2) {
      throw new FullProductOrchestrationError(
        "Room already has two players",
        "room-full"
      );
    }

    const playerId: PlayerId = this.seats.size === 0 ? "player-1" : "player-2";
    const resumeToken = randomBytes(24).toString("base64url");
    const connection: FullProductConnection = {
      playerId,
      resumeToken,
      connectionId
    };
    this.seats.set(playerId, {
      id: playerId,
      name: playerName,
      resumeToken,
      deck: null,
      ready: false,
      connectionId
    });
    this.connections.set(playerId, connection);
    this.appendRoomEvent({ type: "player-joined", playerId });
    return connection;
  }

  disconnect(playerId: PlayerId, connectionId: string): boolean {
    const current = this.connections.get(playerId);
    if (!current || current.connectionId !== connectionId) return false;

    this.connections.delete(playerId);
    const seat = this.requireSeat(playerId);
    seat.connectionId = null;
    this.appendRoomEvent({ type: "player-disconnected", playerId });
    return true;
  }

  reconnect(
    resumeToken: string,
    connectionId: string,
    afterEventSeq = 0,
    afterRoomEventSeq = 0
  ): FullProductReconnectionState | null {
    const seat = this.authenticate(resumeToken);
    if (!seat) return null;

    this.validateMatchEventCursor(afterEventSeq);
    this.validateRoomEventCursor(afterRoomEventSeq);
    const connection: FullProductConnection = {
      playerId: seat.id,
      resumeToken: seat.resumeToken,
      connectionId
    };
    this.connections.set(seat.id, connection);
    seat.connectionId = connectionId;
    this.appendRoomEvent({ type: "player-reconnected", playerId: seat.id });

    const projection = this.snapshot === null
      ? null
      : this.projectionFor(seat.id);
    return {
      session: {
        roomId: this.options.roomId,
        playerId: seat.id,
        resumeToken: seat.resumeToken
      },
      room: this.roomView(),
      projection,
      afterEventSeq,
      afterRoomEventSeq,
      missedEvents: projection === null
        ? []
        : projection.events.filter(event => Number(event.seq) > afterEventSeq),
      missedRoomEvents: this.roomEventLog.filter(
        event => event.seq > afterRoomEventSeq
      )
    };
  }

  submitDeck(
    session: FullProductSession,
    connectionId: string,
    expectedRoomVersion: number,
    deck: RoomDeckSubmission
  ): FullProductRoomReceipt {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.snapshot !== null) {
      throw new FullProductOrchestrationError(
        "The match has already started",
        "command-rejected"
      );
    }

    this.requireRoomVersion(expectedRoomVersion);
    const validation = this.options.validateDeck(deck);
    if (!validation.valid) {
      throw new FullProductOrchestrationError(
        validation.issues[0] ?? "The submitted deck is invalid",
        "invalid-deck"
      );
    }

    const seat = this.requireSeat(playerId);
    seat.deck = deck;
    if (seat.ready) {
      seat.ready = false;
      this.appendRoomEvent({
        type: "player-ready",
        playerId,
        ready: false
      });
    }
    this.appendRoomEvent({ type: "deck-submitted", playerId });

    if (this.canStart()) {
      this.startMatch();
    }
    return {
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    };
  }

  setReady(
    session: FullProductSession,
    connectionId: string,
    expectedRoomVersion: number,
    ready: boolean
  ): FullProductRoomReceipt {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.snapshot !== null) {
      throw new FullProductOrchestrationError(
        "The match has already started",
        "command-rejected"
      );
    }

    const seat = this.requireSeat(playerId);
    if (ready && seat.deck === null) {
      throw new FullProductOrchestrationError(
        "Submit a valid deck before becoming ready",
        "invalid-deck"
      );
    }

    this.requireRoomVersion(expectedRoomVersion);
    seat.ready = ready;
    this.appendRoomEvent({ type: "player-ready", playerId, ready });

    if (this.canStart()) {
      this.startMatch();
    }
    return {
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    };
  }

  startMatch(): void {
    if (this.snapshot !== null) {
      throw new FullProductOrchestrationError(
        "The match has already started",
        "command-rejected"
      );
    }
    if (!this.canStart()) {
      throw new FullProductOrchestrationError(
        "Both connected players must submit decks and become ready",
        "command-rejected"
      );
    }

    const seats = [...this.seats.values()].map(seat => ({
      playerId: seat.id,
      name: seat.name,
      deck: seat.deck!
    }));
    const firstPlayerId = this.options.firstPlayerId ?? "player-1";
    if (!seats.some(seat => seat.playerId === firstPlayerId)) {
      throw new FullProductOrchestrationError(
        "The configured first player is not in this room",
        "command-rejected"
      );
    }

    const result = this.options.runtime.createMatch({
      seats,
      firstPlayerId
    });
    this.snapshot = result.snapshot;
    this.appendRoomEvent({ type: "match-started" });
    this.recordMatchEndIfNeeded();
  }

  projectionFor(
    viewerPlayerId: PlayerId | null
  ): FullProductSanitizedProjection {
    if (this.snapshot === null) {
      throw new FullProductOrchestrationError(
        "The match has not started",
        "command-rejected"
      );
    }
    if (viewerPlayerId !== null && !this.seats.has(viewerPlayerId)) {
      throw new FullProductOrchestrationError(
        "The viewer is not in this room",
        "invalid-token"
      );
    }
    return sanitizeProjection(
      this.options.runtime.project(this.snapshot, viewerPlayerId),
      viewerPlayerId
    );
  }

  legalActionsFor(playerId: PlayerId): readonly FullProductLegalAction[] {
    if (this.snapshot === null) {
      throw new FullProductOrchestrationError(
        "The match has not started",
        "command-rejected"
      );
    }
    this.requireSeat(playerId);
    if (this.snapshot.summary.phase === "ended") return [];
    return [
      ...this.options.runtime.listLegalActions(this.snapshot, playerId),
      { type: "concede", playerId }
    ];
  }

  submitCommand(
    session: FullProductSession,
    connectionId: string,
    commandId: string,
    expectedVersion: number,
    command: FullProductClientCommand
  ): FullProductCommandReceipt {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.snapshot === null) {
      throw new FullProductOrchestrationError(
        "The match has not started",
        "command-rejected"
      );
    }
    const payloadHash = hashCommand(this.options.roomId, playerId, command);
    const previous = this.processedCommands.get(commandId);
    if (previous) {
      if (previous.playerId !== playerId || previous.payloadHash !== payloadHash) {
        throw new FullProductOrchestrationError(
          "Command id was already used with a different payload",
          "idempotency-conflict"
        );
      }
      return {
        commandId,
        duplicate: true,
        appliedVersion: previous.appliedVersion,
        eventSeq: previous.eventSeq,
        roomVersion: this.roomVersion,
        roomEventSeq: this.roomEventSeq
      };
    }

    const summary = this.snapshot.summary;
    if (summary.phase === "ended") {
      throw new FullProductOrchestrationError(
        "The match has already ended",
        "game_ended"
      );
    }

    if (expectedVersion !== summary.version) {
      throw new FullProductOrchestrationError(
        `Expected version ${expectedVersion}, but authoritative version is ${summary.version}`,
        "stale-version"
      );
    }

    const legalActions = command.type === "concede"
      ? [{ type: "concede" as const, playerId }]
      : this.options.runtime.listLegalActions(this.snapshot, playerId);
    if (!legalActions.some(action => matchesLegalAction(action, command))) {
      throw new FullProductOrchestrationError(
        "The command is not currently legal",
        "invalid_command"
      );
    }

    const result = this.options.runtime.submitCommand(this.snapshot, {
      ...command,
      playerId
    });
    if (result.error) {
      throw new FullProductOrchestrationError(
        result.error.message,
        result.error.code
      );
    }

    this.snapshot = result.snapshot;
    const appliedVersion = result.snapshot.summary.version;
    const eventSeq = result.snapshot.summary.eventSeq;
    this.processedCommands.set(commandId, {
      playerId,
      payloadHash,
      appliedVersion,
      eventSeq
    });
    this.recordMatchEndIfNeeded();

    return {
      commandId,
      duplicate: false,
      appliedVersion,
      eventSeq,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    };
  }

  matchResult(): FullProductMatchResult | null {
    if (this.snapshot === null) return null;
    return this.options.runtime.matchResult(this.snapshot);
  }

  summary(): FullProductMatchSummary | null {
    return this.snapshot ? { ...this.snapshot.summary } : null;
  }

  isCurrentConnection(playerId: PlayerId, connectionId: string): boolean {
    return this.connections.get(playerId)?.connectionId === connectionId;
  }

  sendMatchEvents(
    session: FullProductSession,
    connectionId: string,
    afterEventSeq: number,
    afterRoomEventSeq = 0
  ): FullProductReplayState {
    const playerId = this.requireCurrentSession(session, connectionId);
    this.validateMatchEventCursor(afterEventSeq);
    this.validateRoomEventCursor(afterRoomEventSeq);
    const projection = this.projectionFor(playerId);
    return {
      events: projection.events.filter(
        event => Number(event.seq) > afterEventSeq
      ),
      nextEventSeq: projection.eventSeq,
      roomEvents: this.roomEventLog.filter(
        event => event.seq > afterRoomEventSeq
      ),
      nextRoomEventSeq: this.currentRoomEventSeq
    };
  }

  sendRoomEvents(afterRoomEventSeq: number): FullProductReplayState {
    this.validateRoomEventCursor(afterRoomEventSeq);
    return {
      events: [],
      nextEventSeq: this.snapshot?.summary.eventSeq ?? 0,
      roomEvents: this.roomEventLog.filter(
        event => event.seq > afterRoomEventSeq
      ),
      nextRoomEventSeq: this.currentRoomEventSeq
    };
  }

  private recordMatchEndIfNeeded(): void {
    if (this.snapshot?.summary.phase !== "ended" || this.matchEndedRecorded) {
      return;
    }
    this.matchEndedRecorded = true;
    this.appendRoomEvent({
      type: "match-ended",
      winnerPlayerId: this.snapshot.summary.winnerPlayerId,
      playerId: this.snapshot.summary.winnerPlayerId ?? this.snapshot.summary.activePlayerId
    });
  }

  private canStart(): boolean {
    return this.seats.size === 2 &&
      [...this.seats.values()].every(seat =>
        seat.ready &&
        seat.deck !== null &&
        this.connections.has(seat.id)
      );
  }

  private appendRoomEvent(
    event: DistributiveOmit<FullProductRoomEvent, "seq" | "roomId">
  ): void {
    this.roomEventSeq += 1;
    this.roomVersion += 1;
    this.roomEventLog.push({
      ...event,
      seq: this.roomEventSeq,
      roomId: this.options.roomId
    } as FullProductRoomEvent);
  }

  private requireRoomVersion(expectedRoomVersion: number): void {
    if (expectedRoomVersion !== this.roomVersion) {
      throw new FullProductOrchestrationError(
        `Expected room version ${expectedRoomVersion}, but authoritative room version is ${this.roomVersion}`,
        "stale-version"
      );
    }
  }

  private validateMatchEventCursor(afterEventSeq: number): void {
    const currentEventSeq = this.snapshot?.summary.eventSeq ?? 0;
    if (afterEventSeq < 0 || afterEventSeq > currentEventSeq) {
      throw new FullProductOrchestrationError(
        "Event cursor is outside the authoritative log",
        "command-rejected"
      );
    }
  }

  private validateRoomEventCursor(afterRoomEventSeq: number): void {
    if (afterRoomEventSeq < 0 || afterRoomEventSeq > this.roomEventSeq) {
      throw new FullProductOrchestrationError(
        "Room event cursor is outside the authoritative log",
        "command-rejected"
      );
    }
  }

  private requireSeat(playerId: PlayerId): Seat {
    const seat = this.seats.get(playerId);
    if (!seat) {
      throw new FullProductOrchestrationError(
        "Invalid player session",
        "invalid-token"
      );
    }
    return seat;
  }

  private authenticate(token: string): Seat | null {
    for (const seat of this.seats.values()) {
      if (timingSafeEqual(token, seat.resumeToken)) return seat;
    }
    return null;
  }

  private requireCurrentSession(
    session: FullProductSession,
    connectionId: string
  ): PlayerId {
    if (session.roomId !== this.options.roomId) {
      throw new FullProductOrchestrationError(
        "Session belongs to another room",
        "invalid-token"
      );
    }
    const seat = this.requireSeat(session.playerId);
    if (!timingSafeEqual(session.resumeToken, seat.resumeToken)) {
      throw new FullProductOrchestrationError(
        "Invalid player session",
        "invalid-token"
      );
    }
    if (!this.isCurrentConnection(session.playerId, connectionId)) {
      throw new FullProductOrchestrationError(
        "The session was replaced by a newer connection",
        "session-replaced"
      );
    }
    return seat.id;
  }
}

function matchesLegalAction(
  action: FullProductLegalAction,
  command: FullProductClientCommand
): boolean {
  if (action.type !== command.type) return false;
  if (command.type === "pass" || command.type === "concede") return true;
  if (command.type === "play-card") {
    return action.instanceId === command.instanceId;
  }
  return action.promptId === command.promptId &&
    action.optionId === command.optionId;
}

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;

function hashCommand(
  roomId: string,
  playerId: PlayerId,
  command: FullProductClientCommand
): string {
  return createHash("sha256")
    .update(stableStringify({ roomId, playerId, command }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function timingSafeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < actual.length; index += 1) {
    result |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
}
