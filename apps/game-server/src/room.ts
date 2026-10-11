import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createInitialGame,
  createRoomSnapshot,
  projectGame,
  submitCommand,
  type GameState
} from "@riftbound/engine-core";
import {
  RULESET_ID,
  type ClientSession,
  type Command,
  type ErrorCode,
  type GameProjection,
  type PlayerCommand,
  type PlayerId,
  type RoomPlayer,
  type RoomSnapshot,
  type RoomView,
  type ServerTransport
} from "@riftbound/protocol";

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
}

interface ProcessedCommand {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly payloadHash: string;
  readonly appliedVersion: number;
  readonly eventSeq: number;
}

/**
 * An in-memory room. Room state disappears when the process exits; there is no
 * persistence or cross-process recovery in this service.
 */
export class GameRoom {
  readonly players = new Map<PlayerId, RoomConnection>();
  readonly processedCommands = new Map<string, ProcessedCommand>();

  private readonly seats = new Map<PlayerId, Seat>();
  private state: GameState | null = null;

  constructor(readonly roomId: string) {}

  get isFull(): boolean {
    return this.seats.size >= 2;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  get connectedPlayerCount(): number {
    return this.players.size;
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

    this.seats.set(playerId, { id: playerId, name: playerName, resumeToken });
    this.players.set(playerId, connection);
    return connection;
  }

  start(): void {
    if (this.seats.size !== 2) {
      throw new RoomError("Room needs two players", "command-rejected");
    }
    if (this.state) {
      throw new RoomError("Game already started", "command-rejected");
    }

    const players = [...this.seats.values()].map((seat) => ({
      id: seat.id,
      name: seat.name
    }));
    this.state = createInitialGame({ players });
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
    if (projection) transport({ type: "projection", roomId: this.roomId, projection });
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
      rulesetId: RULESET_ID,
      players: this.roomPlayers()
    };
  }

  broadcastRoom(): void {
    const room = this.roomView();
    for (const connection of this.players.values()) {
      connection.send({ type: "room", room });
    }
  }

  snapshot(viewerPlayerId: PlayerId | null = null): RoomSnapshot | null {
    if (!this.state) return null;

    const snapshot = createRoomSnapshot(this.state, this.roomId, viewerPlayerId);
    return {
      ...snapshot,
      players: this.roomPlayers()
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
    const playerId = this.requireSession(session);
    if (!this.isCurrentConnection(playerId, connectionId)) {
      throw new RoomError("The session was replaced by a newer connection", "session-replaced");
    }
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
      duplicate: false
    });
    this.broadcastProjections();
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
    return [...this.seats.values()].map((seat) => ({
      id: seat.id,
      name: seat.name,
      connected: this.players.has(seat.id)
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
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
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
