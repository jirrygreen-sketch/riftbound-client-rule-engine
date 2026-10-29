import {
  isOwnerDeckConfirmationMessage,
  type ClientSession,
  type OwnerDeckConfirmationMessage,
  type RoomDeckSubmission,
  type RoomView
} from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2EngineEvent,
  isV2Projection,
  type V2EngineEvent,
  type V2CommandReceipt,
  type V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";
import {
  createV2ClientState,
  V2ClientStateStore,
  type V2ClientState
} from "../../state/v2";
import { appendClientLog } from "../../diagnostics/client-log";
import { appendMatchLog, setActiveMatchRoom, type DiagnosticStorage } from "../../diagnostics/match-log";
import { sanitizeDiagnosticRecord, safeErrorMessage } from "../../diagnostics/redaction";
import type {
  V2CommandRequest,
  V2Socket,
  V2SocketFactory
} from "../../transport/v2";
import { DEFAULT_WS_SERVER_URL } from "../../net/server-defaults";

const DUEL_RULESET_ID = "riftbound-duel";
const DEFAULT_SERVER_URL = DEFAULT_WS_SERVER_URL;

export interface V2MatchSessionOptions {
  readonly serverUrl: string;
  readonly socketFactory?: V2SocketFactory;
  readonly requestTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly choiceTimeoutMs?: number;
  readonly reconnectDelayMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly diagnosticStorage?: DiagnosticStorage | null;
}

export interface V2MatchSessionSnapshot {
  readonly state: V2ClientState;
  readonly room: RoomView | null;
  readonly session: ClientSession | null;
  readonly pendingCommandIds: readonly string[];
  readonly error: string | null;
  readonly reconnectUrl: string;
  readonly lastReceipt: V2CommandReceipt | null;
}

interface RequestResult {
  readonly type: "request-result";
  readonly requestId: string;
  readonly ok: true;
  readonly roomVersion?: number;
}

interface PendingRoomRequest {
  readonly packet: Readonly<Record<string, unknown>>;
  readonly resumable: boolean;
  readonly resolve: (result: RequestResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingCommand {
  readonly packet: Record<string, unknown>;
  readonly commandId: string;
  readonly waiters: Array<{
    readonly resolve: (receipt: V2CommandReceipt) => void;
    readonly reject: (error: Error) => void;
  }>;
  timer: ReturnType<typeof setTimeout>;
  attempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClientSession(value: unknown): value is ClientSession {
  return isRecord(value) && typeof value.roomId === "string" &&
    typeof value.playerId === "string" && typeof value.resumeToken === "string";
}

function isRoomView(value: unknown): value is RoomView {
  return isRecord(value) && typeof value.roomId === "string" &&
    (value.status === "waiting" || value.status === "playing" || value.status === "ended") &&
    typeof value.rulesetId === "string" && typeof value.roomVersion === "number" &&
    Array.isArray(value.players) && value.players.every(player => isRecord(player) &&
      typeof player.id === "string" && typeof player.name === "string" &&
      typeof player.connected === "boolean" && typeof player.ready === "boolean" &&
      typeof player.deckSubmitted === "boolean");
}

function isRequestResult(value: unknown): value is RequestResult {
  return isRecord(value) && value.type === "request-result" &&
    typeof value.requestId === "string" && value.ok === true;
}

function isServerError(value: unknown): value is {
  readonly type: "error";
  readonly requestId?: string;
  readonly code: string;
  readonly message: string;
} {
  return isRecord(value) && value.type === "error" && typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.requestId === undefined || typeof value.requestId === "string");
}

function isWelcome(value: unknown): value is {
  readonly type: "welcome";
  readonly protocolVersion: string;
  readonly session?: ClientSession;
  readonly resumed?: boolean;
} {
  return isRecord(value) && value.type === "welcome" &&
    value.protocolVersion === PROTOCOL_V2_VERSION &&
    (value.session === undefined || isClientSession(value.session));
}

function isBackgroundPacket(value: unknown): value is
  | { readonly type: "projection"; readonly projection: V2Projection }
  | { readonly type: "event" }
  | { readonly type: "command-receipt"; readonly commandId: string; readonly accepted: boolean; readonly rejection: string | null } {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "projection") return isV2Projection(value.projection);
  if (value.type === "event") return isV2EngineEvent(value.event);
  return value.type === "command-receipt" && isV2CommandReceipt(value);
}

/**
 * Waiting-room resume also receives the server's private owner-deck echo.
 * V2 does not derive deck legality from it, but the existing protocol packet
 * is part of that recovery response and must not be treated as transport data
 * loss. Restrict what is ignored to the exact owner/room authenticated by the
 * live V2 session; all other server packets still fail closed.
 */
function isMatchingOwnerEcho(
  value: unknown,
  session: ClientSession | null
): value is OwnerDeckConfirmationMessage {
  return session !== null && isOwnerDeckConfirmationMessage(value) &&
    value.roomId === session.roomId && value.playerId === session.playerId;
}

export function normalizeV2ServerUrl(input: string): string {
  const trimmed = input.trim() || DEFAULT_SERVER_URL;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)
    ? trimmed
    : `ws://${trimmed.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("V2 服务地址不是有效 URL。");
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("V2 服务地址必须使用 ws:// 或 wss://。");
  }
  if (!url.hostname) throw new Error("V2 服务地址缺少主机名。");
  if (!url.pathname || url.pathname === "/") url.pathname = "/ws";
  else if (!/\/ws\/?$/iu.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/ws`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** URL carries no authority; the server authenticates via a V2 hello packet. */
export function buildV2RoomUrl(serverUrl: string): string {
  return normalizeV2ServerUrl(serverUrl);
}

export function buildV2Hello(
  session: ClientSession | null = null,
  cursor: { readonly eventSeq?: number } = {}
): Record<string, unknown> {
  return {
    type: "hello",
    protocolVersion: PROTOCOL_V2_VERSION,
    ...(session === null ? {} : {
      roomId: session.roomId,
      resumeToken: session.resumeToken,
      // Preserve the established v2 resume shape. A waiting room has no
      // authoritative game event yet, so its cursor is validly zero; the
      // server accepts that absent-log state for engine-v2 rooms (RIFT-1021).
      afterEventSeq: Math.max(0, cursor.eventSeq ?? 0)
    })
  };
}

/**
 * V2-first room and match session. It sends protocol v2 hello before every
 * room request, keeps command ids stable across reconnect, and never mutates
 * authoritative game state locally.
 */
export class V2MatchSessionController {
  private readonly url: string;
  private readonly socketFactory: V2SocketFactory;
  private readonly requestTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly choiceTimeoutMs?: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly listeners = new Set<(snapshot: V2MatchSessionSnapshot) => void>();
  private readonly diagnosticStorage: DiagnosticStorage | null;
  private readonly pendingRequests = new Map<string, PendingRoomRequest>();
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly recordedProjectionEvents = new Map<string, Set<number>>();
  private store: V2ClientStateStore;
  private socket: V2Socket | null = null;
  private session: ClientSession | null = null;
  private room: RoomView | null = null;
  private error: string | null = null;
  private lastReceipt: V2CommandReceipt | null = null;
  private manuallyClosed = true;
  private ready = false;
  private socketGeneration = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private choiceTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;

  public constructor(options: V2MatchSessionOptions, initialSession: ClientSession | null = null) {
    this.url = normalizeV2ServerUrl(options.serverUrl);
    this.socketFactory = options.socketFactory ?? (url => new WebSocket(url) as unknown as V2Socket);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 10_000);
    this.commandTimeoutMs = Math.max(1, options.commandTimeoutMs ?? 5_000);
    this.choiceTimeoutMs = options.choiceTimeoutMs;
    this.diagnosticStorage = options.diagnosticStorage ??
      (typeof localStorage === "undefined" ? null : localStorage);
    this.reconnectDelayMs = Math.max(0, options.reconnectDelayMs ?? 250);
    this.maxReconnectAttempts = Math.max(0, options.maxReconnectAttempts ?? 8);
    this.session = initialSession;
    this.store = new V2ClientStateStore({
      viewerPlayerId: initialSession?.playerId ?? null,
      choiceTimeoutMs: this.choiceTimeoutMs
    });
  }

  public get snapshot(): V2MatchSessionSnapshot {
    return {
      state: this.store.state,
      room: this.room,
      session: this.session,
      pendingCommandIds: [...this.pendingCommands.keys()],
      error: this.error,
      reconnectUrl: this.url,
      lastReceipt: this.lastReceipt
    };
  }

  public subscribe(listener: (snapshot: V2MatchSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  public start(): void {
    if (!this.manuallyClosed && this.socket !== null) return;
    this.manuallyClosed = false;
    if (this.choiceTimer === null) {
      this.choiceTimer = setInterval(() => {
        this.store.refreshChoice();
        this.emit();
      }, 500);
    }
    this.openSocket();
  }

  public get currentSession(): ClientSession | null {
    return this.session;
  }

  public connect(): void {
    if (this.socket !== null) return;
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.openSocket();
  }

  public stop(reason = "V2 session stopped"): void {
    this.manuallyClosed = true;
    this.ready = false;
    this.socketGeneration += 1;
    this.clearReconnectTimer();
    if (this.choiceTimer !== null) clearInterval(this.choiceTimer);
    this.choiceTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.close(1000, reason); } catch { /* socket already closed */ }
    }
    this.rejectPending(new Error(reason));
    this.store.setConnectionStatus("disconnected");
    this.recordStatus("disconnected", reason);
    this.emit();
  }

  public async createRoom(playerName: string): Promise<RoomView> {
    this.recordMatch("command", { type: "create-room", playerName: playerName.trim() || "玩家" }, false);
    await this.request({
      type: "create-room",
      playerName: playerName.trim() || "玩家",
      rulesetId: DUEL_RULESET_ID
    }, false);
    return this.requireRoom();
  }

  public discardRecoverySession(): void {
    this.session = null;
    this.room = null;
    this.ready = false;
    const socket = this.socket;
    this.socket = null;
    this.socketGeneration += 1;
    if (socket) {
      try { socket.close(1000, "discard v2 recovery session"); } catch { /* already closed */ }
    }
    this.rejectPending(new Error("已清除无效的 V2 恢复会话。"));
    this.store = new V2ClientStateStore({ choiceTimeoutMs: this.choiceTimeoutMs });
    this.emit();
    this.manuallyClosed = false;
    this.openSocket();
  }

  public async joinRoom(roomId: string, playerName: string): Promise<RoomView> {
    const normalized = roomId.trim();
    if (!normalized) throw new Error("请输入房间号。");
    this.recordMatch("command", { type: "join-room", roomId: normalized,
      playerName: playerName.trim() || "玩家" }, false);
    await this.request({
      type: "join-room",
      roomId: normalized,
      playerName: playerName.trim() || "玩家"
    }, false);
    return this.requireRoom();
  }

  public async submitDeck(deck: RoomDeckSubmission): Promise<RoomView> {
    const room = this.requireRoom();
    this.recordMatch("command", { type: "submit-deck", expectedRoomVersion: room.roomVersion,
      deck: sanitizeDiagnosticRecord(deck) });
    await this.request({
      type: "submit-deck",
      expectedRoomVersion: room.roomVersion,
      deck
    }, true);
    return this.requireRoom();
  }

  public async setReady(ready: boolean): Promise<RoomView> {
    const room = this.requireRoom();
    this.recordMatch("command", { type: "set-ready", expectedRoomVersion: room.roomVersion, ready });
    await this.request({
      type: "set-ready",
      expectedRoomVersion: room.roomVersion,
      ready
    }, true);
    return this.requireRoom();
  }

  public sendCommand(input: V2CommandRequest): Promise<V2CommandReceipt> {
    if (!this.ready) {
      const error = new Error("V2 握手尚未完成。");
      this.recordError(error);
      return Promise.reject(error);
    }
    const commandId = "commandId" in input && typeof input.commandId === "string"
      ? input.commandId
      : this.nextId("command");
    const existing = this.pendingCommands.get(commandId);
    if (existing) return new Promise((resolve, reject) => {
      existing.waiters.push({ resolve, reject });
    });
    const packet = {
      ...input,
      commandId,
      stateVersion: input.stateVersion ?? this.store.state.stateVersion
    };
    this.recordMatch("command", packet);
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        packet,
        commandId,
        waiters: [{ resolve, reject }],
        timer: setTimeout(() => undefined, 1),
        attempts: 0
      };
      clearTimeout(pending.timer);
      this.pendingCommands.set(commandId, pending);
      this.transmitCommand(pending);
      this.emit();
    });
  }

  private async request(
    packet: Readonly<Record<string, unknown>>,
    resumable: boolean
  ): Promise<RequestResult> {
    if (!this.ready) throw new Error("V2 握手尚未完成。");
    const requestId = this.nextId(String(packet.type));
    const fullPacket = { ...packet, requestId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        const error = new Error(`V2 请求 ${requestId} 超时。`);
        this.recordError(error, { requestId, type: String(packet.type) });
        reject(error);
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { packet: fullPacket, resumable, resolve, reject, timer });
      try {
        this.send(fullPacket);
      } catch (caught) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        const error = caught instanceof Error ? caught : new Error(String(caught));
        this.recordError(error, { requestId, type: String(packet.type) });
        reject(error);
      }
    });
  }

  private openSocket(): void {
    if (this.manuallyClosed) return;
    this.clearReconnectTimer();
    const generation = ++this.socketGeneration;
    let socket: V2Socket;
    try {
      socket = this.socketFactory(this.url);
    } catch (caught) {
      this.fail(caught instanceof Error ? caught.message : "无法创建 V2 WebSocket。");
      return;
    }
    this.socket = socket;
    this.ready = false;
    this.store.setConnectionStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.recordStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.emit();
    socket.onopen = () => {
      if (this.socket !== socket || this.socketGeneration !== generation || this.manuallyClosed) return;
      this.send(buildV2Hello(this.session, {
        eventSeq: this.store.state.eventSeq
      }));
    };
    socket.onmessage = event => {
      if (this.socket !== socket || this.socketGeneration !== generation) return;
      this.handleIncoming(event.data);
    };
    socket.onerror = () => {
      if (this.socket === socket && this.socketGeneration === generation) this.fail("V2 WebSocket 连接错误。");
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.socketGeneration !== generation) return;
      this.socket = null;
      this.ready = false;
      if (this.manuallyClosed) return;
      this.dropPendingNonResumableRequests();
      this.store.setConnectionStatus("reconnecting");
      this.recordStatus("reconnecting", "WebSocket closed");
      this.emit();
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.store.setConnectionStatus("disconnected");
        this.fail("V2 重连次数已用尽。");
        return;
      }
      this.reconnectAttempts += 1;
      const delay = Math.min(2_000, this.reconnectDelayMs * this.reconnectAttempts);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.openSocket();
      }, delay);
    };
  }

  private handleIncoming(raw: unknown): void {
    let packet: unknown = raw;
    if (typeof raw === "string") {
      try {
        packet = JSON.parse(raw) as unknown;
      } catch {
        this.fail("V2 服务端返回了无效 JSON。");
        return;
      }
    }
    if (isWelcome(packet)) {
      if (packet.session) {
        const viewerChanged = this.session?.playerId !== packet.session.playerId;
        this.session = packet.session;
        if (viewerChanged) {
          this.store = new V2ClientStateStore({
            viewerPlayerId: packet.session.playerId,
            choiceTimeoutMs: this.choiceTimeoutMs
          });
        }
      }
      this.ready = true;
      this.reconnectAttempts = 0;
      this.error = null;
      this.store.setConnectionStatus("connected");
      this.recordStatus("connected");
      this.flushPending();
      this.emit();
      return;
    }
    if (isRequestResult(packet)) {
      const pending = this.pendingRequests.get(packet.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(packet.requestId);
        pending.resolve(packet);
      }
      this.emit();
      return;
    }
    if (isRecord(packet) && packet.type === "room" && isRoomView(packet.room)) {
      this.room = packet.room;
      setActiveMatchRoom(this.diagnosticStorage, packet.room.roomId);
      appendMatchLog(this.diagnosticStorage, {
        roomId: packet.room.roomId,
        matchId: this.store.state.projection?.matchId ?? null,
        viewerPlayerId: this.session?.playerId ?? null,
        kind: "status",
        payload: { status: packet.room.status, roomVersion: packet.room.roomVersion }
      });
      this.emit();
      return;
    }
    if (isServerError(packet)) {
      this.fail(packet.message, {
        code: packet.code,
        requestId: packet.requestId ?? null
      });
      if (packet.requestId) {
        const pending = this.pendingRequests.get(packet.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(packet.requestId);
          pending.reject(new Error(packet.message));
        }
      }
      if (!packet.requestId && this.session !== null &&
          (packet.code === "invalid-token" || packet.code === "room-not-found")) {
        this.manuallyClosed = false;
        this.discardRecoverySession();
      }
      return;
    }
    if (isMatchingOwnerEcho(packet, this.session)) return;
    if (!isBackgroundPacket(packet)) {
      this.fail("V2 服务端返回了未识别数据包。");
      return;
    }
    if (packet.type === "command-receipt") {
      const receipt = packet as V2CommandReceipt;
      this.lastReceipt = receipt;
      this.recordMatch("receipt", receipt, true, receipt.stateVersion, receipt.eventSeq);
      if (!receipt.accepted) {
        const reason = receipt.rejection ?? "服务端拒绝该命令。";
        this.error = reason;
        appendClientLog({ level: "error", source: "v2-session", message: reason,
          data: { commandId: receipt.commandId } });
        this.recordMatch("error", { commandId: receipt.commandId,
          message: reason, rejection: receipt.rejection }, true,
          receipt.stateVersion, receipt.eventSeq);
      }
      const pending = this.pendingCommands.get(receipt.commandId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(receipt.commandId);
        if (receipt.accepted) {
          for (const waiter of pending.waiters) waiter.resolve(receipt);
        }
        else {
          const reason = receipt.rejection ?? "服务端拒绝该命令。";
          for (const waiter of pending.waiters) waiter.reject(new Error(reason));
        }
      }
    }
    const applied = this.store.apply(packet);
    if (isRecord(packet) && packet.type === "projection" && isV2Projection(packet.projection)) {
      const projection = packet.projection;
      this.recordMatch("projection", {
        stateVersion: projection.stateVersion,
        eventSeq: projection.eventSeq,
        phase: projection.phase,
        turnNumber: projection.turnNumber,
        activePlayerId: projection.activePlayerId,
        pendingChoice: projection.pendingChoice.status === "pending"
          ? {
              status: "pending",
              choiceId: projection.pendingChoice.choiceId,
              kind: projection.pendingChoice.kind,
              ownerPlayerId: projection.pendingChoice.ownerPlayerId
            }
          : { status: "none" }
      }, true, projection.stateVersion, projection.eventSeq);
      this.recordProjectionEvents(projection);
    }
    if (isRecord(packet) && packet.type === "event") {
      const eventValue = (packet as Record<string, unknown>).event;
      if (isV2EngineEvent(eventValue)) {
        const engineEvent = eventValue as V2EngineEvent;
        const matchId = this.store.state.projection?.matchId ?? this.room?.roomId ?? "unmatched";
        this.recordEngineEvent(matchId, engineEvent);
      }
    }
    if (!applied.accepted && applied.reason && applied.reason !== "Stale projection") {
      this.error = applied.reason;
      this.recordError(new Error(applied.reason), { type: String((packet as Record<string, unknown>).type) });
    }
    this.emit();
  }

  private transmitCommand(pending: PendingCommand): void {
    if (pending.attempts > 4) {
      this.pendingCommands.delete(pending.commandId);
      clearTimeout(pending.timer);
      const message = `命令 ${pending.commandId} 超过重试上限。`;
      this.error = message;
      for (const waiter of pending.waiters) waiter.reject(new Error(message));
      this.emit();
      return;
    }
    pending.attempts += 1;
    try {
      this.send({
        type: "command",
        protocolVersion: PROTOCOL_V2_VERSION,
        command: pending.packet
      });
    } catch {
      // Reconnect will send the same command id and packet again.
      appendClientLog({ level: "warn", source: "v2-session",
        message: `V2 命令 ${pending.commandId} 发送失败，等待重连后重试。`,
        data: { commandId: pending.commandId, attempt: pending.attempts } });
      return;
    }
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (this.pendingCommands.has(pending.commandId)) this.transmitCommand(pending);
    }, this.commandTimeoutMs);
  }

  private flushPending(): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.resumable) {
        try { this.send(pending.packet); } catch { return; }
      }
    }
    for (const pending of this.pendingCommands.values()) this.transmitCommand(pending);
  }

  private send(packet: Readonly<Record<string, unknown>>): void {
    if (!this.socket) throw new Error("V2 WebSocket 未连接。");
    this.socket.send(JSON.stringify(packet));
  }

  private requireRoom(): RoomView {
    if (!this.room) throw new Error("服务端尚未返回房间状态。");
    return this.room;
  }

  private nextId(kind: string): string {
    this.idCounter += 1;
    return `desktop-v2-${kind}-${Date.now()}-${this.idCounter}`;
  }

  private fail(message: string, data?: unknown): void {
    this.error = message;
    this.recordError(new Error(message), data);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private recordStatus(status: string, detail?: string): void {
    const roomId = this.room?.roomId ?? this.session?.roomId ?? null;
    appendClientLog({
      level: status === "connected" ? "info" : "warn",
      source: "v2-session",
      message: `V2 会话连接状态：${status}`,
      data: {
        status,
        ...(detail === undefined ? {} : { detail }),
        roomId,
        matchId: this.store.state.projection?.matchId ?? null
      }
    });
    this.recordMatch("status", {
      connectionStatus: status,
      ...(detail === undefined ? {} : { detail })
    }, false);
  }

  private recordError(error: unknown, data?: unknown): void {
    const message = safeErrorMessage(error);
    appendClientLog({
      level: "error",
      source: "v2-session",
      message,
      data: sanitizeDiagnosticRecord({
        ...(data === undefined ? {} : { data }),
        roomId: this.room?.roomId ?? this.session?.roomId ?? null
      })
    });
    this.recordMatch("error", {
      message,
      ...(data === undefined ? {} : { data })
    }, false);
  }

  private recordMatch(
    kind: "projection" | "event" | "command" | "receipt" | "error" | "status",
    payload: unknown,
    _requireRoom = true,
    stateVersion?: number,
    eventSeq?: number
  ): void {
    const roomId = this.room?.roomId ?? this.session?.roomId ?? null;
    if (roomId === null) return;
    appendMatchLog(this.diagnosticStorage, {
      roomId,
      matchId: this.store.state.projection?.matchId ?? null,
      viewerPlayerId: this.session?.playerId ?? null,
      kind,
      payload,
      ...(stateVersion === undefined ? {} : { stateVersion }),
      ...(eventSeq === undefined ? {} : { eventSeq })
    });
  }

  private recordProjectionEvents(projection: V2Projection): void {
    for (const event of projection.events) {
      this.recordEngineEvent(projection.matchId, event);
    }
  }

  private recordEngineEvent(matchId: string, event: V2EngineEvent): void {
    const seen = this.recordedProjectionEvents.get(matchId) ?? new Set<number>();
    if (seen.has(event.eventSeq)) return;
    seen.add(event.eventSeq);
    this.recordedProjectionEvents.set(matchId, seen);
    this.recordMatch("event", event, true, event.stateVersion, event.eventSeq);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private dropPendingNonResumableRequests(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.resumable) continue;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error("连接中断，请重新发起建房或加入请求。"));
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      for (const waiter of pending.waiters) waiter.reject(error);
    }
    this.pendingRequests.clear();
    this.pendingCommands.clear();
  }
}

/** Visible UI hook for the deferred protocol fields that do not exist yet. */
export const V2_DEFERRED_UI_HOOKS = Object.freeze([
  "play-card-placement-and-target-candidates",
  "combat-advancement-in-this-runtime"
] as const);

export function createV2MatchSessionController(
  options: V2MatchSessionOptions,
  initialSession: ClientSession | null = null
): V2MatchSessionController {
  return new V2MatchSessionController(options, initialSession);
}

export { createV2ClientState };
