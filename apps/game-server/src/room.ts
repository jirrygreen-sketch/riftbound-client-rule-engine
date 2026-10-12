import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createInitialGame,
  createRoomSnapshot,
  projectGame,
  submitCommand,
  type GameState
} from "@riftbound/engine-core";
import {
  FOUNDATION_RULESET_ID,
  RULESET_ID,
  type ClientSession,
  type Command,
  type ErrorCode,
  type GameProjection,
  type PlayerCommand,
  type PlayerId,
  type RoomDeckSubmission,
  type RoomEvent,
  type RoomPlayer,
  type RoomSnapshot,
  type RoomView,
  type ServerTransport
} from "@riftbound/protocol";
import {
  normalizeDeckRequest,
  validateCatalogDeck,
  type CardCatalogRuntime
} from "./card-catalog.js";
import { createFoundationGame } from "./foundation-game.js";

export interface RoomConnection {
  readonly playerId: PlayerId;
  readonly resumeToken: string;
  readonly connectionId: string;
  readonly send: ServerTransport;
}

interface Seat {
  readonly id: PlayerId;
  readonly name: string;
  readonly resumeToken: string;
  ready: boolean;
  deck: RoomDeckSubmission | null;
}

interface ProcessedCommand {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly payloadHash: string;
  readonly appliedVersion: number;
  readonly eventSeq: number;
}

type DistributiveOmit<T, Keys extends keyof T> = T extends unknown
  ? Omit<T, Keys>
  : never;

/**
 * Server-owned room orchestration. Engine state remains authoritative and
 * starts immediately for the synthetic demo or after ready decks for the
 * foundation ruleset.
 */
export class GameRoom {
  readonly players = new Map<PlayerId, RoomConnection>();
  readonly processedCommands = new Map<string, ProcessedCommand>();

  private readonly seats = new Map<PlayerId, Seat>();
  private state: GameState | null = null;
  private roomVersion = 1;
  private roomEventSeq = 0;
  private readonly roomEventLog: RoomEvent[] = [];

  constructor(
    readonly roomId: string,
    readonly rulesetId: string = RULESET_ID,
    private readonly catalog?: CardCatalogRuntime
  ) {
    if (rulesetId !== RULESET_ID && rulesetId !== FOUNDATION_RULESET_ID) {
      throw new RoomError(
        `Unsupported ruleset ${rulesetId}`,
        "command-rejected"
      );
    }
    this.appendRoomEvent({ type: "room-created", playerId: "player-1" });
  }

  get isFull(): boolean {
    return this.seats.size >= 2;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  get connectedPlayerCount(): number {
    return this.players.size;
  }

  get currentRoomVersion(): number {
    return this.roomVersion;
  }

  get currentRoomEventSeq(): number {
    return this.roomEventSeq;
  }

  roomEvents(): readonly RoomEvent[] {
    return [...this.roomEventLog];
  }

  get status(): RoomView["status"] {
    if (this.state?.phase === "ended") return "ended";
    if (this.state) return "playing";
    return "waiting";
  }

  join(
    playerName: string,
    transport: ServerTransport,
    connectionId: string = randomUUID()
  ): RoomConnection {
    if (this.seats.size >= 2) {
      throw new RoomError("Room already has two players", "room-full");
    }

    const playerId: PlayerId = this.seats.size === 0 ? "player-1" : "player-2";
    const resumeToken = randomBytes(24).toString("base64url");
    const connection: RoomConnection = {
      playerId,
      resumeToken,
      connectionId,
      send: transport
    };

    this.seats.set(playerId, {
      id: playerId,
      name: playerName,
      resumeToken,
      ready: false,
      deck: null
    });
    this.players.set(playerId, connection);
    this.appendRoomEvent({ type: "player-joined", playerId });
    return connection;
  }

  start(): void {
    if (this.seats.size !== 2) {
      throw new RoomError("Room needs two players", "command-rejected");
    }
    if (this.state) {
      throw new RoomError("Game already started", "command-rejected");
    }

    if (this.rulesetId === FOUNDATION_RULESET_ID) {
      if (this.seats.size !== 2) {
        throw new RoomError("Room needs two players", "command-rejected");
      }
      if (!this.catalog) {
        throw new RoomError("The card catalog is unavailable", "command-rejected");
      }
      const seats = [...this.seats.values()].map(seat => {
        if (!seat.deck) {
          throw new RoomError("Every player must submit a deck", "invalid-deck");
        }
        if (!seat.ready) {
          throw new RoomError("Every player must be ready", "command-rejected");
        }
        if (!this.players.has(seat.id)) {
          throw new RoomError("Every player must be connected", "command-rejected");
        }
        return {
          id: seat.id,
          name: seat.name,
          deck: seat.deck
        };
      });
      this.state = createFoundationGame(
        seats,
        this.catalog.publicCatalog.cards
      );
    } else {
      const players = [...this.seats.values()].map(seat => ({
        id: seat.id,
        name: seat.name
      }));
      this.state = createInitialGame({
        players
      });
    }
    this.appendRoomEvent({ type: "game-started" });
  }

  authenticate(token: string): Seat | null {
    for (const seat of this.seats.values()) {
      if (timingSafeEqual(token, seat.resumeToken)) return seat;
    }
    return null;
  }

  reconnect(
    resumeToken: string,
    transport: ServerTransport,
    connectionId: string
  ): RoomConnection | null {
    const seat = this.authenticate(resumeToken);
    if (!seat) return null;

    const connection: RoomConnection = {
      playerId: seat.id,
      resumeToken: seat.resumeToken,
      connectionId,
      send: transport
    };
    this.players.set(seat.id, connection);
    this.appendRoomEvent({ type: "player-reconnected", playerId: seat.id });
    return connection;
  }

  /**
   * Remove a connection only if it is still the active one. This prevents a
   * delayed close event from an old socket evicting a newly resumed socket.
   */
  disconnect(playerId: PlayerId, connectionId: string): boolean {
    const current = this.players.get(playerId);
    if (!current || current.connectionId !== connectionId) return false;

    this.players.delete(playerId);
    this.appendRoomEvent({ type: "player-disconnected", playerId });
    return true;
  }

  isCurrentConnection(playerId: PlayerId, connectionId: string): boolean {
    return this.players.get(playerId)?.connectionId === connectionId;
  }

  projectionFor(playerId: PlayerId): GameProjection | null {
    return this.state ? projectGame(this.state, playerId) : null;
  }

  sendProjection(playerId: PlayerId, transport: ServerTransport): void {
    const projection = this.projectionFor(playerId);
    if (projection) {
      transport({ type: "projection", roomId: this.roomId, projection });
    }
  }

  broadcastProjections(): void {
    if (!this.state) return;

    for (const [playerId, connection] of this.players) {
      connection.send({
        type: "projection",
        roomId: this.roomId,
        projection: projectGame(this.state, playerId)
      });
    }
  }

  roomView(): RoomView {
    return {
      roomId: this.roomId,
      status: this.status,
      rulesetId: this.rulesetId,
      version: this.state?.version ?? 0,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      players: this.roomPlayers()
    };
  }

  broadcastRoom(): void {
    const room = this.roomView();
    for (const connection of this.players.values()) {
      connection.send({ type: "room", room });
    }
  }

  sendEvents(
    session: ClientSession,
    connectionId: string,
    afterEventSeq: number
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (!this.state) {
      throw new RoomError(
        "Game events are not available before the game starts",
        "command-rejected"
      );
    }
    if (afterEventSeq > this.state.eventSeq) {
      throw new RoomError(
        "Event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }

    this.players.get(playerId)?.send({
      type: "events",
      roomId: this.roomId,
      afterEventSeq,
      nextEventSeq: this.state.eventSeq,
      version: this.state.version,
      events: projectGame(this.state, playerId).events.filter(
        event => event.seq > afterEventSeq
      )
    });
  }

  sendRoomEvents(
    session: ClientSession,
    connectionId: string,
    afterRoomEventSeq: number
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (afterRoomEventSeq > this.roomEventSeq) {
      throw new RoomError(
        "Room event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }

    this.players.get(playerId)?.send({
      type: "room-events",
      roomId: this.roomId,
      afterRoomEventSeq,
      nextRoomEventSeq: this.roomEventSeq,
      roomVersion: this.roomVersion,
      events: this.roomEventLog.filter(event => event.seq > afterRoomEventSeq)
    });
  }

  validateGameEventCursor(
    session: ClientSession,
    connectionId: string,
    afterEventSeq: number
  ): void {
    this.requireCurrentSession(session, connectionId);
    if (!this.state) {
      throw new RoomError(
        "Game events are not available before the game starts",
        "command-rejected"
      );
    }
    if (afterEventSeq > this.state.eventSeq) {
      throw new RoomError(
        "Event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }
  }

  validateRoomEventCursor(afterRoomEventSeq: number): void {
    if (afterRoomEventSeq > this.roomEventSeq) {
      throw new RoomError(
        "Room event cursor is ahead of the authoritative log",
        "command-rejected"
      );
    }
  }

  submitDeck(
    session: ClientSession,
    connectionId: string,
    expectedRoomVersion: number,
    deck: RoomDeckSubmission,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.state) {
      throw new RoomError("The game has already started", "command-rejected");
    }
    if (this.rulesetId === FOUNDATION_RULESET_ID && !this.catalog) {
      throw new RoomError(
        "The card catalog is unavailable",
        "command-rejected"
      );
    }

    const normalized = normalizeDeckRequest({ deck });
    if (!normalized) {
      throw new RoomError("The deck payload is invalid", "invalid-deck");
    }

    if (this.catalog) {
      const validation = validateCatalogDeck(this.catalog, normalized);
      if (!validation.valid) {
        throw new RoomError(
          validation.issues[0]?.message ?? "The deck is invalid",
          "invalid-deck"
        );
      }
    }

    this.requireRoomVersion(expectedRoomVersion);
    const seat = this.requireSeat(playerId);
    seat.deck = normalized;
    if (seat.ready) {
      seat.ready = false;
      this.appendRoomEvent({ type: "player-ready", playerId, ready: false });
    }
    this.appendRoomEvent({ type: "deck-submitted", playerId });

    this.sendRoomReceipt(requestId, transport);
    this.broadcastRoom();

    if (this.canStart()) {
      this.start();
      this.broadcastRoom();
      this.broadcastProjections();
    }
  }

  setReady(
    session: ClientSession,
    connectionId: string,
    expectedRoomVersion: number,
    ready: boolean,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (this.state) {
      throw new RoomError("The game has already started", "command-rejected");
    }

    const seat = this.requireSeat(playerId);
    if (ready && !seat.deck) {
      throw new RoomError(
        "Submit a valid deck before becoming ready",
        "invalid-deck"
      );
    }

    this.requireRoomVersion(expectedRoomVersion);
    seat.ready = ready;
    this.appendRoomEvent({ type: "player-ready", playerId, ready });

    this.sendRoomReceipt(requestId, transport);
    this.broadcastRoom();

    if (this.canStart()) {
      this.start();
      this.broadcastRoom();
      this.broadcastProjections();
    }
  }

  snapshot(viewerPlayerId: PlayerId | null = null): RoomSnapshot | null {
    if (!this.state) return null;

    const snapshot = createRoomSnapshot(this.state, this.roomId, viewerPlayerId);
    return {
      ...snapshot,
      players: this.roomPlayers(),
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      roomEvents: [...this.roomEventLog]
    };
  }

  submit(
    session: ClientSession,
    connectionId: string,
    command: PlayerCommand,
    commandId: string,
    expectedVersion: number,
    requestId: string,
    transport: ServerTransport
  ): void {
    const playerId = this.requireCurrentSession(session, connectionId);
    if (!this.state) {
      throw new RoomError("Game has not started", "command-rejected");
    }

    const payloadHash = hashCommand(this.roomId, playerId, command);
    const previous = this.processedCommands.get(commandId);
    if (previous) {
      if (previous.playerId !== playerId || previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Command id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        commandId,
        appliedVersion: previous.appliedVersion,
        eventSeq: previous.eventSeq,
        roomVersion: this.roomVersion,
        roomEventSeq: this.roomEventSeq,
        duplicate: true
      });
      this.sendProjection(playerId, transport);
      return;
    }

    if (expectedVersion !== this.state.version) {
      throw new RoomError(
        `Expected version ${expectedVersion}, but authoritative version is ${this.state.version}`,
        "stale-version"
      );
    }

    const actorCommand = commandWithActor(command, playerId);
    const result = submitCommand(this.state, actorCommand);
    if (result.error) {
      throw new RoomError(result.error.message, result.error.code);
    }

    this.state = result.state;
    const appliedVersion = result.state.version;
    const eventSeq = result.state.eventSeq;
    this.processedCommands.set(commandId, {
      commandId,
      playerId,
      payloadHash,
      appliedVersion,
      eventSeq
    });

    transport({
      type: "request-result",
      requestId,
      ok: true,
      commandId,
      appliedVersion,
      eventSeq,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastProjections();
  }

  private canStart(): boolean {
    return this.rulesetId === FOUNDATION_RULESET_ID &&
      this.seats.size === 2 &&
      [...this.seats.values()].every(seat =>
        seat.ready &&
        seat.deck !== null &&
        this.players.has(seat.id)
      );
  }

  private appendRoomEvent(
    event: DistributiveOmit<RoomEvent, "roomId" | "seq">
  ): void {
    this.roomEventSeq += 1;
    this.roomVersion += 1;
    this.roomEventLog.push({
      ...event,
      seq: this.roomEventSeq,
      roomId: this.roomId
    });
  }

  private sendRoomReceipt(
    requestId: string,
    transport: ServerTransport
  ): void {
    transport({
      type: "request-result",
      requestId,
      ok: true,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    });
  }

  private requireSeat(playerId: PlayerId): Seat {
    const seat = this.seats.get(playerId);
    if (!seat) {
      throw new RoomError("Invalid player session", "invalid-token");
    }
    return seat;
  }

  private requireRoomVersion(expectedRoomVersion: number): void {
    if (expectedRoomVersion !== this.roomVersion) {
      throw new RoomError(
        `Expected room version ${expectedRoomVersion}, but authoritative room version is ${this.roomVersion}`,
        "stale-version"
      );
    }
  }

  private requireCurrentSession(
    session: ClientSession,
    connectionId: string
  ): PlayerId {
    const playerId = this.requireSession(session);
    if (!this.isCurrentConnection(playerId, connectionId)) {
      throw new RoomError(
        "The session was replaced by a newer connection",
        "session-replaced"
      );
    }
    return playerId;
  }

  private requireSession(session: ClientSession): PlayerId {
    if (session.roomId !== this.roomId) {
      throw new RoomError("Session belongs to another room", "invalid-token");
    }

    const seat = this.seats.get(session.playerId);
    if (!seat || !timingSafeEqual(session.resumeToken, seat.resumeToken)) {
      throw new RoomError("Invalid player session", "invalid-token");
    }

    return seat.id;
  }

  private roomPlayers(): readonly RoomPlayer[] {
    return [...this.seats.values()].map(seat => ({
      id: seat.id,
      name: seat.name,
      connected: this.players.has(seat.id),
      ready: seat.ready,
      deckSubmitted: seat.deck !== null
    }));
  }
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode
  ) {
    super(message);
    this.name = "RoomError";
  }
}

function commandWithActor(command: PlayerCommand, playerId: PlayerId): Command {
  switch (command.type) {
    case "pass":
      return { type: "pass", playerId };
    case "play-card":
      return {
        type: "play-card",
        playerId,
        instanceId: command.instanceId
      };
    case "respond-to-prompt":
      return {
        type: "respond-to-prompt",
        playerId,
        promptId: command.promptId,
        optionId: command.optionId,
        ...(command.stateVersion === undefined
          ? {}
          : { stateVersion: command.stateVersion })
      };
  }
}

function hashCommand(
  roomId: string,
  playerId: PlayerId,
  command: PlayerCommand
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
  for (let index = 0; index < actual.length; index++) {
    result |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
}

export function createRoomId(): string {
  return randomUUID().slice(0, 8);
}
