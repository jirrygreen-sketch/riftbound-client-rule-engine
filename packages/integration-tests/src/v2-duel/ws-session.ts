import type { ClientSession, RoomDeckSubmission, RoomView } from "../../../protocol/src/index.js";
import {
  PROTOCOL_V2_VERSION,
  isV2Projection
} from "../../../protocol/src/v2/index.js";
import type {
  V2Command,
  V2CommandReceipt,
  V2Projection
} from "../../../protocol/src/v2/index.js";

type ServerPacket = Record<string, unknown>;

export class V2CommandFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stateVersion: number,
    readonly eventSeq: number
  ) {
    super(message);
    this.name = "V2CommandFailure";
  }
}

interface RequestReceipt {
  readonly type: "request-result";
  readonly requestId: string;
  readonly ok: boolean;
  readonly roomVersion?: number;
}

export interface V2WebSocketSessionSnapshot {
  readonly session: ClientSession;
  readonly room: RoomView;
  readonly projection: V2Projection | null;
}

function record(value: unknown): value is ServerPacket {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function opaqueTrace(packet: ServerPacket): ServerPacket {
  const clone = structuredClone(packet) as ServerPacket;
  delete clone.projection;
  delete clone.room;
  delete clone.deck;
  delete clone.cardId;
  delete clone.resumeToken;
  return clone;
}

export class V2WebSocketSession {
  private readonly messages: ServerPacket[] = [];
  private readonly traffic: Record<string, unknown>[] = [];
  private readonly waiters = new Set<() => void>();
  private sequence = 0;
  private state: V2WebSocketSessionSnapshot | null = null;
  private alive = false;
  private arrival = 0;
  private pendingReceiptArrival: number | null = null;
  private readonly arrivalById = new WeakMap<object, number>();
  private readonly receiptArrivals = new Map<string, number>();

  private constructor(
    readonly name: string,
    private readonly socket: WebSocket,
    private readonly onProjection: (projection: V2Projection) => void
  ) {
    socket.addEventListener("close", () => {
      this.alive = false;
      this.traffic.push({ type: "socket-close", readyState: socket.readyState });
    });
    socket.addEventListener("message", event => {
      let packet: unknown;
      try { packet = JSON.parse(String(event.data)); }
      catch { throw new Error(`${name}: server sent invalid JSON`); }
      if (!record(packet) || typeof packet.type !== "string") {
        throw new Error(`${name}: server sent a non-object packet`);
      }
      const current = this.state;
      const messageArrival = ++this.arrival;
      this.arrivalById.set(packet, messageArrival);
      if (packet.type === "command-receipt") {
        if (typeof packet.commandId === "string") this.receiptArrivals.set(packet.commandId, messageArrival);
        if (typeof packet.requestId === "string") this.receiptArrivals.set(packet.requestId, messageArrival);
      }
      this.traffic.push(opaqueTrace(packet));
      if (packet.type === "welcome" && record(packet.session)) {
        const session = packet.session as unknown as ClientSession;
        this.state = current === null ? {
          session,
          room: currentRoomFromNothing(),
          projection: null
        } : { ...current, session };
      } else if (packet.type === "room" && record(packet.room)) {
        const room = packet.room as unknown as RoomView;
        const session = current?.session ?? this.state?.session;
        if (!session) throw new Error(`${name}: room arrived before session`);
        this.state = {
          session,
          room,
          projection: current?.projection ?? this.state?.projection ?? null
        };
      } else if (packet.type === "projection") {
        if (!isV2Projection(packet.projection)) {
          throw new Error(`${name}: invalid V2 projection`);
        }
        onProjection(packet.projection);
        if (!this.state) throw new Error(`${name}: projection arrived before session/room`);
        this.state = { ...this.state, projection: packet.projection };
      }
      this.messages.push(packet);
      for (const wake of this.waiters) wake();
    });
  }

  static async connect(
    url: string,
    name: string,
    onProjection: (projection: V2Projection) => void
  ): Promise<V2WebSocketSession> {
    const socket = new WebSocket(url);
    const session = new V2WebSocketSession(name, socket, onProjection);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`${name}: unable to connect to ${url}`)), { once: true });
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION }));
    await session.wait(packet => packet.type === "welcome" && packet.session === undefined,
      5_000, "V2 welcome");
    session.alive = true;
    return session;
  }

  public closeImmediately(): void {
    this.alive = false;
    try { this.socket.close(); } catch { /* already closed */ }
  }

  get snapshot(): V2WebSocketSessionSnapshot {
    if (!this.state || !this.state.room.roomId) throw new Error(`${this.name}: session state is unavailable`);
    return this.state;
  }

  async createRoom(playerName: string): Promise<void> {
    const requestId = this.nextId("create");
    this.send({ type: "create-room", requestId, playerName, rulesetId: "riftbound-duel" });
    await this.waitRequest(requestId);
    await this.wait(packet => packet.type === "welcome" && record(packet.session),
      5_000, `${playerName} room session`);
    await this.wait(packet => packet.type === "room" && record(packet.room),
      5_000, `${playerName} initial room`);
    // A join by the other client can be broadcast before this stream consumes
    // the creator's initial room packet. Drain through the latest public room
    // snapshot so the next deck submission uses the acknowledged authority.
    await new Promise(resolve => setTimeout(resolve, 25));
    await this.awaitRoomVersion();
  }

  async joinRoom(roomId: string, playerName: string): Promise<void> {
    const requestId = this.nextId("join");
    this.send({ type: "join-room", requestId, roomId, playerName });
    await this.wait(packet => packet.type === "welcome" && record(packet.session),
      5_000, `${playerName} room session`);
    await this.waitRequest(requestId);
    await this.wait(packet => packet.type === "room" &&
      record(packet.room) && Array.isArray(packet.room.players) && packet.room.players.length === 2,
      5_000, `${playerName} two-player room`);
    // Both seats receive a post-join room broadcast. Let the socket deliver
    // that packet before deriving the deck request's optimistic room version.
    await new Promise(resolve => setTimeout(resolve, 25));
    await this.awaitRoomVersion();
  }

  async submitDeck(deck: RoomDeckSubmission): Promise<void> {
    await this.waitForRoomUpdate();
    await this.refreshRoom();
    const requestId = this.nextId("deck");
    const packet = { type: "submit-deck", requestId,
      expectedRoomVersion: this.snapshot.room.roomVersion, deck };
    this.send(packet);
    await this.withStaleVersionRetry(packet);
    await this.wait(packet => packet.type === "room" && record(packet.room) &&
      Array.isArray(packet.room.players) && packet.room.players.some(player =>
        record(player) && player.id === this.snapshot.session.playerId && player.deckSubmitted === true),
      5_000, `${this.name} deck acknowledgement`);
  }
  async setReady(): Promise<void> {
    await this.waitForRoomUpdate();
    await this.refreshRoom();
    const requestId = this.nextId("ready");
    const packet = { type: "set-ready", requestId,
      expectedRoomVersion: this.snapshot.room.roomVersion, ready: true };
    this.send(packet);
    await this.withStaleVersionRetry(packet);
  }

  async sendCommand(command: V2Command, requestedTimeoutMs = 15_000): Promise<V2CommandReceipt> {
    const startIndex = this.messages.length;
    this.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION, command });
    const deadline = Date.now() + Math.max(1, requestedTimeoutMs);
    for (;;) {
      const index = this.messages.findIndex((candidate, index) => index >= startIndex &&
        candidate.type === "command-receipt" &&
        (candidate.commandId === command.commandId || candidate.requestId === command.commandId));
      if (index >= 0) {
        const receipt = this.messages.splice(index, 1)[0] as unknown as V2CommandReceipt;
        // A per-viewer projection can be dispatched before this client's
        // receipt. Preserve it; the transaction commits the state and outbox
        // together, and waitForProjectionAfter() applies the acknowledged
        // stateVersion lower bound to queued projections.
        this.pendingReceiptArrival = this.receiptArrivals.get(command.commandId) ??
          this.arrivalById.get(receipt) ?? null;
        this.receiptArrivals.delete(command.commandId);
        if (typeof receipt.commandId === "string") this.receiptArrivals.delete(receipt.commandId);
        return receipt;
      }
      const errorIndex = this.messages.findIndex((candidate, index) => index >= startIndex &&
        candidate.type === "error" &&
        (candidate.requestId === command.commandId || !("requestId" in candidate)));
      if (errorIndex >= 0) {
        const failure = this.messages.splice(errorIndex, 1)[0]!;
        throw new V2CommandFailure(
          typeof failure.code === "string" ? failure.code : "command-rejected",
          typeof failure.message === "string" ? failure.message : "Command rejected",
          this.state?.projection?.stateVersion ?? command.stateVersion,
          this.state?.projection?.eventSeq ?? 0
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(`${this.name}: timed out waiting for ${this.name} receipt ${command.commandId} ` +
          JSON.stringify({ type: command.type, phase: this.state?.projection?.phase,
            stateVersion: this.state?.projection?.stateVersion, priority: this.state?.projection?.priority,
            choice: this.state?.projection?.pendingChoice, combat: this.state?.projection?.combat }));
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /** Timed command receipt. A timeout is a protocol observation, not a
   * synthesized result; callers record it and stop driving that game. */
  async sendCommandWithin(command: V2Command, timeoutMs: number): Promise<V2CommandReceipt> {
    return this.sendCommand(command, timeoutMs);
  }

  /** Refresh both clients from already-queued private V2 projection packets. */
  async syncProjection(): Promise<V2Projection> {
    const queued = this.messages.find(candidate => candidate.type === "projection" &&
      isV2Projection(candidate.projection));
    if (queued) {
      this.messages.splice(this.messages.indexOf(queued), 1);
      this.state = this.state === null ? null : { ...this.state, projection: queued.projection as V2Projection };
    }
    const current = this.state?.projection;
    if (!current) throw new Error(`${this.name}: no projection is available for sync`);
    return current;
  }

  async waitForProjection(
    predicate: (projection: V2Projection) => boolean,
    label: string,
    timeoutMs = 30_000
  ): Promise<V2Projection> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const index = this.messages.findIndex(candidate => candidate.type === "projection" &&
        isV2Projection(candidate.projection) && predicate(candidate.projection));
      if (index >= 0) {
        const projection = this.messages.splice(index, 1)[0]!.projection as V2Projection;
        this.state = this.state === null ? null : { ...this.state, projection };
        return projection;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const packet = await this.wait(candidate => candidate.type === "projection" &&
      isV2Projection(candidate.projection) && predicate(candidate.projection),
      timeoutMs, label);
    return packet.projection as V2Projection;
  }

  /** Wait for the next projection after the command receipt, never reusing
   * the snapshot that preceded the command. */
  async waitForProjectionAfter(commandId: string, timeoutMs = 10_000): Promise<V2Projection> {
    const receiptArrival = this.pendingReceiptArrival;
    this.pendingReceiptArrival = null;
    if (receiptArrival !== null) {
      for (let index = this.messages.length - 1; index >= 0; index -= 1) {
        const packet = this.messages[index]!;
        const packetArrival = this.arrivalById.get(packet);
        if (packetArrival === undefined || packetArrival <= receiptArrival) this.messages.splice(index, 1);
      }
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(candidate => candidate.type === "projection" &&
        isV2Projection(candidate.projection));
      if (index >= 0) {
        const projection = this.messages.splice(index, 1)[0]!.projection as V2Projection;
        // The websocket callback has already committed this projection. Return
        // the queued incarnation so the caller can compare its full clock.
        return projection;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`${this.name}: timed out waiting for projection after ${commandId}`);
  }



  public trace(): readonly Readonly<Record<string, unknown>>[] {
    return this.traffic;
  }

  private send(packet: Readonly<Record<string, unknown>>): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error(`${this.name}: WebSocket is not open`);
    this.socket.send(JSON.stringify(packet));
  }

  private nextId(kind: string): string {
    this.sequence += 1;
    return `v2-duel-${this.name}-${kind}-${this.sequence}`;
  }

  private async awaitRoomVersion(): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.messages.some(packet => packet.type === "room" && record(packet.room))) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const first = this.messages.findIndex(packet => packet.type === "room" && record(packet.room));
    if (first < 0) { await new Promise(resolve => setTimeout(resolve, 0)); return; }
    const latest = this.messages.flatMap((packet, index) =>
      packet.type === "room" && record(packet.room) ? [{ index, room: packet.room as unknown as RoomView }] : []).at(-1)!;
    this.messages.splice(first, latest.index - first + 1);
    this.state = this.state === null ? null : { ...this.state, room: latest.room };
  }

  private async refreshRoom(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 25));
    await this.awaitRoomVersion();
  }

  private async waitForRoomUpdate(): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (this.messages.some(packet => packet.type === "room" && record(packet.room))) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await this.awaitRoomVersion();
  }

  private async waitRequest(requestId: string, timeoutMs = 90_000): Promise<RequestReceipt> {
    const packet = await this.wait(candidate =>
      (candidate.type === "request-result" || candidate.type === "error") &&
      (candidate.requestId === requestId ||
        (candidate.type === "error" && candidate.requestId === undefined)),
      timeoutMs, `${this.name} request ${requestId}`);
    if (packet.type === "error") {
      throw new Error(`${this.name}: ${String(packet.code ?? "request-rejected")}: ${String(packet.message ?? "")}`);
    }
    const receipt = packet as unknown as RequestReceipt;
    if (this.state && typeof receipt.roomVersion === "number") {
      this.state = {
        ...this.state,
        room: { ...this.state.room, roomVersion: receipt.roomVersion }
      };
    }
    return receipt;
  }

  /** Re-send an identical room request after a stale-version ACK race. The
   * request id and payload stay unchanged, so the server's idempotency guard
   * remains the authority for any duplicate delivery. */
  private async retryRoomRequest(packet: Record<string, unknown>): Promise<void> {
    const requestId = String(packet.requestId);
    try { await this.waitRequest(requestId); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("stale-version")) throw error;
      await this.awaitRoomVersion();
      this.send({ ...packet, expectedRoomVersion: this.snapshot.room.roomVersion });
      await this.waitRequest(requestId);
    }
  }

  private async withStaleVersionRetry(packet: Record<string, unknown>): Promise<RequestReceipt> {
    const first = await this.waitRequest(String(packet.requestId)).catch(error => error as Error);
    if (first instanceof Error && first.message.includes("stale-version")) {
      await new Promise(resolve => setTimeout(resolve, 10));
      await this.awaitRoomVersion();
      const retry = { ...packet, requestId: this.nextId("retry"),
        expectedRoomVersion: this.snapshot.room.roomVersion };
      this.send(retry);
      return this.waitRequest(String(retry.requestId));
    }
    if (first instanceof Error) throw first;
    return first;
  }

  private async wait(
    predicate: (packet: ServerPacket) => boolean,
    timeoutMs: number,
    label: string
  ): Promise<ServerPacket> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      let resolveWait: () => void = () => undefined;
      const teardown = () => { this.waiters.delete(wake); clearTimeout(timer); };
      const wake = () => { teardown(); resolveWait(); };
      const timer = setTimeout(wake, Math.max(1, deadline - Date.now()));
      this.waiters.add(wake);
      await new Promise<void>(resolve => { resolveWait = resolve; });
    }
    throw new Error(`${this.name}: timed out waiting for ${label}; queued ${JSON.stringify(this.messages)}`);
  }

  get socketReadyState(): number { return this.alive && this.socket.readyState === WebSocket.OPEN ? 1 : 0; }
}

function currentRoomFromNothing(): RoomView {
  // The welcome packet never exposes the room; this sentinel is replaced by the
  // immediately following public room packet and is never read for authority.
  return { roomId: "", status: "waiting", rulesetId: "riftbound-duel",
    version: 0, roomVersion: 0, roomEventSeq: 0, players: [] };
}
