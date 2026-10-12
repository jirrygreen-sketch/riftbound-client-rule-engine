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

export interface RoomSeatArchive {
  readonly id: PlayerId;
  readonly name: string;
  readonly resumeToken: string;
  ready: boolean;
  deck: RoomDeckSubmission | null;
}
type Seat = RoomSeatArchive;

export interface ProcessedCommand {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly payloadHash: string;
  readonly appliedVersion: number;
  readonly eventSeq: number;
}

export interface ProcessedRoomRequest {
  readonly playerId: PlayerId;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
}

/** Server-private state. Never send this archive through client transports. */
export interface RoomArchive {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly rulesetId: string;
  readonly seats: readonly RoomSeatArchive[];
  readonly state: GameState | null;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
  readonly roomEventLog: readonly RoomEvent[];
  readonly processedCommands: readonly ProcessedCommand[];
  readonly processedRoomRequests?: readonly ProcessedRoomRequest[];
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
  private readonly processedRoomRequests = new Map<string, ProcessedRoomRequest>();

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

  exportArchive(): RoomArchive {
    return structuredClone({
      schemaVersion: 1,
      roomId: this.roomId,
      rulesetId: this.rulesetId,
      seats: [...this.seats.values()],
      state: this.state,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      roomEventLog: this.roomEventLog,
      processedCommands: [...this.processedCommands.values()],
      processedRoomRequests: [...this.processedRoomRequests.values()]
    });
  }

  static restore(archive: unknown, catalog?: CardCatalogRuntime): GameRoom {
    if (!isRecord(archive)) {
      throw new Error("Invalid server room archive");
    }
    const roomArchive = archive as unknown as RoomArchive;
    const expectedSeatIds: readonly PlayerId[] = roomArchive.seats?.length === 2
      ? ["player-1", "player-2"]
      : roomArchive.seats?.length === 1
        ? ["player-1"]
        : [];
    if (roomArchive.schemaVersion !== 1 ||
        typeof roomArchive.roomId !== "string" || !roomArchive.roomId ||
        typeof roomArchive.rulesetId !== "string" || !roomArchive.rulesetId ||
        !Array.isArray(roomArchive.seats) || roomArchive.seats.length > 2 ||
        roomArchive.seats.some((seat, index) => seat?.id !== expectedSeatIds[index]) ||
        roomArchive.seats.some(seat =>
          typeof seat?.id !== "string" ||
          !expectedSeatIds.includes(seat.id) ||
          typeof seat?.resumeToken !== "string" || !seat.resumeToken ||
          typeof seat?.name !== "string" || !seat.name) ||
        !Number.isSafeInteger(roomArchive.roomVersion) ||
        roomArchive.roomVersion < 1 ||
        !Number.isSafeInteger(roomArchive.roomEventSeq) ||
        roomArchive.roomEventSeq < 0 ||
        !Array.isArray(roomArchive.roomEventLog) ||
        roomArchive.roomEventLog.length !== roomArchive.roomEventSeq ||
        roomArchive.roomEventLog.some((event, index) =>
          event?.seq !== index + 1 || event?.roomId !== roomArchive.roomId) ||
        !Array.isArray(roomArchive.processedCommands) ||
        (roomArchive.processedRoomRequests !== undefined &&
          !Array.isArray(roomArchive.processedRoomRequests))) {
      throw new Error("Invalid server room archive");
    }
    if (!roomArchive.processedCommands.every(command =>
      isRecord(command) &&
      typeof command.commandId === "string" && command.commandId.length > 0 &&
      typeof command.playerId === "string" && expectedSeatIds.includes(command.playerId) &&
      typeof command.payloadHash === "string" && command.payloadHash.length > 0 &&
      typeof command.appliedVersion === "number" &&
      Number.isSafeInteger(command.appliedVersion) && command.appliedVersion >= 0 &&
      typeof command.eventSeq === "number" &&
      Number.isSafeInteger(command.eventSeq) && command.eventSeq >= 0
    ) || new Set(roomArchive.processedCommands.map(command =>
      (command as { commandId?: unknown })?.commandId
    )).size !== roomArchive.processedCommands.length) {
      throw new Error("Room archive contains an invalid processed command");
    }
    const processedRoomRequests = roomArchive.processedRoomRequests ?? [];
    if (!processedRoomRequests.every(request =>
      isRecord(request) &&
      typeof request.requestId === "string" && request.requestId.length > 0 &&
      typeof request.playerId === "string" &&
      expectedSeatIds.includes(request.playerId) &&
      typeof request.payloadHash === "string" && request.payloadHash.length > 0 &&
      typeof request.roomVersion === "number" &&
      Number.isSafeInteger(request.roomVersion) && request.roomVersion >= 1 &&
      typeof request.roomEventSeq === "number" &&
      Number.isSafeInteger(request.roomEventSeq) && request.roomEventSeq >= 0
    ) || new Set(processedRoomRequests.map(request =>
      requestKey(
        (request as ProcessedRoomRequest).playerId,
        (request as ProcessedRoomRequest).requestId
      )
    )).size !== processedRoomRequests.length) {
      throw new Error("Room archive contains an invalid processed room request");
    }
    if (roomArchive.state !== null) {
      if (typeof roomArchive.state !== "object" ||
          Array.isArray(roomArchive.state)) {
        throw new Error("Invalid server room archive");
      }
      const state = roomArchive.state as GameState;
      if (!isRecord(state.rules) ||
          state.rules.rulesetId !== roomArchive.rulesetId ||
          !Array.isArray(state.players) || state.players.length !== 2 ||
          state.players.some(player =>
            !isRecord(player) ||
            !expectedSeatIds.includes(player.id as PlayerId))) {
        throw new Error("Room archive state does not match its seats or rules");
      }
    }
    const room = new GameRoom(roomArchive.roomId, roomArchive.rulesetId, catalog);
    room.restoreArchive(roomArchive);
    return room;
  }

  /** Roll back a failed durable transaction while retaining socket bindings. */
  restoreArchive(archive: RoomArchive): void {
    if (archive.roomId !== this.roomId || archive.rulesetId !== this.rulesetId) {
      throw new Error("Cannot restore a different room");
    }
    const copy = structuredClone(archive);
    this.seats.clear();
    for (const seat of copy.seats) this.seats.set(seat.id, seat);
    this.state = copy.state;
    this.roomVersion = copy.roomVersion;
    this.roomEventSeq = copy.roomEventSeq;
    this.roomEventLog.splice(0, this.roomEventLog.length, ...copy.roomEventLog);
    this.processedCommands.clear();
    for (const command of copy.processedCommands) {
      this.processedCommands.set(command.commandId, command);
    }
    const processedRoomRequests = copy.processedRoomRequests ?? [];
    this.processedRoomRequests.clear();
    for (const request of processedRoomRequests) {
      this.processedRoomRequests.set(requestKey(request.playerId, request.requestId), request);
    }
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

  validateResumeCursors(
    resumeToken: string,
    afterEventSeq?: number,
    afterRoomEventSeq?: number
  ): void {
    const seat = this.authenticate(resumeToken);
    if (!seat) {
      throw new RoomError("Invalid resume token", "invalid-token");
    }

    if (afterEventSeq !== undefined) {
      if (!Number.isSafeInteger(afterEventSeq) || afterEventSeq < 0) {
        throw new RoomError(
          "Event cursor must be a safe non-negative integer",
          "command-rejected"
        );
      }
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

    if (afterRoomEventSeq !== undefined) {
      if (!Number.isSafeInteger(afterRoomEventSeq) || afterRoomEventSeq < 0) {
        throw new RoomError(
          "Room event cursor must be a safe non-negative integer",
          "command-rejected"
        );
      }
      if (afterRoomEventSeq > this.roomEventSeq) {
        throw new RoomError(
          "Room event cursor is ahead of the authoritative log",
          "command-rejected"
        );
      }
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
    const payloadHash = hashRoomRequest("submit-deck", playerId, deck);
    const previous = this.findProcessedRoomRequest(playerId, requestId);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Room request id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        roomVersion: previous.roomVersion,
        roomEventSeq: previous.roomEventSeq,
        duplicate: true
      });
      return;
    }
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

    if (this.canStart()) {
      this.start();
    }

    this.recordProcessedRoomRequest(playerId, requestId, payloadHash);
    transport({
      type: "request-result",
      requestId,
      ok: true,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastRoom();
    if (this.state) this.broadcastProjections();
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
    const payloadHash = hashRoomRequest("set-ready", playerId, ready);
    const previous = this.findProcessedRoomRequest(playerId, requestId);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new RoomError(
          "Room request id was already used with a different payload",
          "idempotency-conflict"
        );
      }

      transport({
        type: "request-result",
        requestId,
        ok: true,
        roomVersion: previous.roomVersion,
        roomEventSeq: previous.roomEventSeq,
        duplicate: true
      });
      return;
    }
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

    if (this.canStart()) {
      this.start();
    }

    this.recordProcessedRoomRequest(playerId, requestId, payloadHash);
    transport({
      type: "request-result",
      requestId,
      ok: true,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq,
      duplicate: false
    });
    this.broadcastRoom();
    if (this.state) this.broadcastProjections();
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
    if (this.state.phase === "ended") this.broadcastRoom();
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

  private findProcessedRoomRequest(
    playerId: PlayerId,
    requestId: string
  ): ProcessedRoomRequest | undefined {
    return this.processedRoomRequests.get(requestKey(playerId, requestId));
  }

  private recordProcessedRoomRequest(
    playerId: PlayerId,
    requestId: string,
    payloadHash: string
  ): void {
    this.processedRoomRequests.set(requestKey(playerId, requestId), {
      playerId,
      requestId,
      payloadHash,
      roomVersion: this.roomVersion,
      roomEventSeq: this.roomEventSeq
    });
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
    case "concede":
      return { type: "concede", playerId };
    case "play-card":
      return {
        type: "play-card",
        playerId,
        instanceId: command.instanceId,
        ...(command.targets === undefined ? {} : { targets: command.targets })
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

function hashRoomRequest(
  requestType: "submit-deck" | "set-ready",
  playerId: PlayerId,
  payload: unknown
): string {
  return createHash("sha256")
    .update(stableStringify({ requestType, playerId, payload }))
    .digest("hex");
}

function requestKey(playerId: PlayerId, requestId: string): string {
  return `${playerId}\0${requestId}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRoomId(): string {
  return randomUUID().slice(0, 8);
}
