import {
  OFFICIAL_RULESET_ID,
  PROTOCOL_VERSION,
  RULESET_ID,
  isServerMessage,
  type ClientSession,
  type ClientToServerMessage,
  type CommandTarget,
  type GameProjection,
  type GameEvent,
  type PlayerCommand,
  type RoomDeckSubmission,
  type RoomEvent,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";

export type GameClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface GameClientHandlers {
  onStatus: (status: GameClientStatus) => void;
  onSession: (session: ClientSession | null) => void;
  onProjection: (projection: GameProjection | null) => void;
  onError: (message: string) => void;
  onRoom: (roomId: string | null) => void;
  onRoomView?: (room: RoomView | null) => void;
  onEvents?: (events: readonly GameEvent[]) => void;
  onRoomEvents?: (events: readonly RoomEvent[]) => void;
  onHandshake: (ready: boolean) => void;
  onPendingCommand?: (pending: boolean) => void;
  onPendingRequest?: (pending: boolean) => void;
}

export type CreateRoomRuleset = typeof OFFICIAL_RULESET_ID | typeof RULESET_ID;

export interface StoredSession extends ClientSession {
  serverUrl: string;
}

interface PendingCommand {
  requestId: string;
  readonly commandId: string;
  readonly command: PlayerCommand;
  attempt: number;
  retryDue: boolean;
  timeoutTimer: number | null;
}

interface PendingRoomRequest {
  readonly requestId: string;
  timeoutTimer: number | null;
}

const STORAGE_KEY = "riftbound.desktop-client.session";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787/ws";
const MAX_RECONNECT_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 50_000;
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_ATTEMPTS = 3;
const ROOM_REQUEST_TIMEOUT_MS = 10_000;

export class GameClient {
  status: GameClientStatus = "idle";

  private socket: WebSocket | null = null;
  private serverUrl = "";
  private session: StoredSession | null;
  private latestProjectionVersion: number | null = null;
  private roomVersion: number | null = null;
  private latestEventSeq: number | null = null;
  private latestRoomEventSeq: number | null = null;
  private pendingCommand: PendingCommand | null = null;
  private pendingRoomRequest: PendingRoomRequest | null = null;
  private requestSeq = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastPongAt = 0;
  private intentionallyClosed = false;
  private handshakeReady = false;

  constructor(private readonly handlers: GameClientHandlers) {
    this.session = readStoredSession();
  }

  connect(input: string): void {
    const normalizedUrl = normalizeServerUrl(input);
    if (!normalizedUrl) {
      this.handlers.onError("服务地址无效，请检查后重试。");
      return;
    }

    this.serverUrl = normalizedUrl;
    this.intentionallyClosed = false;
    this.reconnectAttempt = 0;
    if (this.session && this.session.serverUrl !== normalizedUrl) {
      this.applySession(null);
      this.clearPendingCommand();
    }
    this.setHandshakeReady(false);
    this.preparePendingCommandForRetry();
    this.latestProjectionVersion = null;
    this.handlers.onProjection(null);
    this.clearPendingRequest();
    this.openSocket("connecting");
  }

  resumeStoredSession(): boolean {
    if (!this.session) return false;
    this.connect(this.session.serverUrl);
    return true;
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  createRoom(
    playerName: string,
    ruleset: CreateRoomRuleset = OFFICIAL_RULESET_ID
  ): boolean {
    const name = requirePlayerName(playerName);
    if (!name) {
      this.handlers.onError("昵称无效，请重新输入。");
      return false;
    }

    return this.send({
      type: "create-room",
      requestId: this.nextRequestId("create"),
      playerName: name,
      rulesetId: ruleset
    });
  }

  joinRoom(playerName: string, roomId: string): boolean {
    const name = requirePlayerName(playerName);
    const normalizedRoomId = roomId.trim();
    if (!name) {
      this.handlers.onError("昵称无效，请重新输入。");
      return false;
    }
    if (!normalizedRoomId) {
      this.handlers.onError("请输入房间号。");
      return false;
    }

    return this.send({
      type: "join-room",
      requestId: this.nextRequestId("join"),
      roomId: normalizedRoomId,
      playerName: name
    });
  }

  pass(): boolean {
    return this.sendCommand({ type: "pass" });
  }

  playCard(instanceId: string, targets?: readonly CommandTarget[]): boolean {
    if (!instanceId) {
      this.handlers.onError("手牌实例无效，无法打出。");
      return false;
    }
    return this.sendCommand({
      type: "play-card",
      instanceId,
      ...(targets === undefined ? {} : { targets })
    });
  }

  submitPlayerCommand(command: PlayerCommand): boolean {
    return this.sendCommand(command);
  }

  concede(): boolean {
    return this.sendCommand({ type: "concede" });
  }

  respondPrompt(
    promptId: string,
    optionId: string,
    stateVersion?: number
  ): boolean {
    if (!promptId || !optionId) {
      this.handlers.onError("选择项无效。");
      return false;
    }
    return this.sendCommand({
      type: "respond-to-prompt",
      promptId,
      optionId,
      ...(stateVersion === undefined ? {} : { stateVersion })
    });
  }

  submitDeck(deck: RoomDeckSubmission): boolean {
    const normalized = normalizeRoomDeck(deck);
    if (!normalized) {
      this.handlers.onError("卡组数据无效，无法提交。");
      return false;
    }
    if (this.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法提交卡组。");
      return false;
    }

    return this.sendTrackedRequest({
      type: "submit-deck",
      requestId: this.nextRequestId("submit-deck"),
      expectedRoomVersion: this.roomVersion,
      deck: normalized
    });
  }

  setReady(ready: boolean): boolean {
    if (this.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法切换准备状态。");
      return false;
    }
    return this.sendTrackedRequest({
      type: "set-ready",
      requestId: this.nextRequestId("set-ready"),
      expectedRoomVersion: this.roomVersion,
      ready
    });
  }

  syncEvents(): boolean {
    if (!this.session) {
      this.handlers.onError("尚未进入房间，无法同步事件。");
      return false;
    }
    return this.send({
      type: "sync-events",
      requestId: this.nextRequestId("sync-events"),
      ...(this.latestEventSeq === null
        ? {}
        : { afterEventSeq: this.latestEventSeq }),
      ...(this.latestRoomEventSeq === null
        ? {}
        : { afterRoomEventSeq: this.latestRoomEventSeq })
    });
  }

  private sendTrackedRequest(message: ClientToServerMessage): boolean {
    if (this.pendingRoomRequest !== null) {
      this.handlers.onError("上一项房间请求仍在处理中，请稍候。");
      return false;
    }
    if (message.type !== "submit-deck" && message.type !== "set-ready") {
      return this.send(message);
    }

    this.pendingRoomRequest = {
      requestId: message.requestId,
      timeoutTimer: null
    };
    this.handlers.onPendingRequest?.(true);
    if (!this.send(message)) {
      this.clearPendingRequest();
      return false;
    }
    this.pendingRoomRequest.timeoutTimer = setTimer(() => {
      const pending = this.pendingRoomRequest;
      if (!pending || pending.requestId !== message.requestId) return;
      this.clearPendingRequest();
      this.handlers.onError("房间请求确认超时，请重试。");
    }, ROOM_REQUEST_TIMEOUT_MS);
    return true;
  }

  private sendCommand(command: PlayerCommand): boolean {
    if (this.pendingCommand) {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    if (!this.session) {
      this.handlers.onError("尚未进入房间，操作未发送。");
      return false;
    }
    if (this.latestProjectionVersion === null) {
      this.handlers.onError("尚未收到牌桌状态，请稍后再试。");
      return false;
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch {
      this.handlers.onError("当前环境无法创建安全操作标识，请刷新后重试。");
      return false;
    }

    const requestId = this.nextRequestId("command");
    const message: ClientToServerMessage = {
      type: "command",
      requestId,
      commandId,
      expectedVersion: this.latestProjectionVersion,
      command
    };

    this.pendingCommand = {
      requestId,
      commandId,
      command,
      attempt: 1,
      retryDue: false,
      timeoutTimer: null
    };
    this.handlers.onPendingCommand?.(true);

    if (!this.send(message)) {
      this.clearPendingCommand();
      return false;
    }

    this.pendingCommand.timeoutTimer = setTimer(() => {
      const pending = this.pendingCommand;
      if (!pending || pending.commandId !== commandId) return;
      this.retryPendingCommand(true);
    }, COMMAND_TIMEOUT_MS);
    return true;
  }

  private nextRequestId(prefix: string): string {
    this.requestSeq += 1;
    return `${prefix}-${this.requestSeq}`;
  }

  private openSocket(status: GameClientStatus): void {
    if (!this.serverUrl) return;

    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.preparePendingCommandForRetry();
    this.latestProjectionVersion = null;
    if (status === "connecting") {
      this.handlers.onProjection(null);
    }

    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.setStatus(status);

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.serverUrl);
    } catch {
      this.handlers.onError("无法连接游戏服务端，请检查地址后重试。");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.sendHello();
    });

    socket.addEventListener("message", event => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      this.setHandshakeReady(false);
      this.preparePendingCommandForRetry();
      this.latestProjectionVersion = null;
      if (this.intentionallyClosed) {
        this.setStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      this.setHandshakeReady(false);
      this.preparePendingCommandForRetry();
      this.handlers.onError("无法连接游戏服务端，请检查地址或稍后重试。");
    });
  }

  private sendHello(): void {
    const resume =
      this.session?.serverUrl === this.serverUrl
        ? {
            roomId: this.session.roomId,
            resumeToken: this.session.resumeToken
          }
        : {};

    this.sendRaw({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      ...resume,
      ...(resume.roomId === undefined
        ? {}
        : {
            ...(this.latestEventSeq === null
              ? {}
              : { afterEventSeq: this.latestEventSeq }),
            ...(this.latestRoomEventSeq === null
              ? {}
              : { afterRoomEventSeq: this.latestRoomEventSeq })
          })
    });
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      this.handlers.onError("服务端返回了无法识别的数据。");
      return;
    }

    if (!isServerMessage(parsed)) {
      this.handlers.onError("服务端返回了无法识别的消息。");
      return;
    }

    switch (parsed.type) {
      case "welcome": {
        if (parsed.protocolVersion !== PROTOCOL_VERSION) {
          this.stopForProtocolMismatch();
          return;
        }

        this.reconnectAttempt = 0;
        this.lastPongAt = Date.now();
        if (parsed.session) {
          this.applySession({ ...parsed.session, serverUrl: this.serverUrl });
        } else if (this.session?.serverUrl === this.serverUrl) {
          this.applySession(null);
        }
        this.setHandshakeReady(true);
        this.startHeartbeat();
        this.setStatus("connected");
        this.retryPendingCommand();
        return;
      }
      case "request-result": {
        const pending = this.pendingCommand;
        if (this.pendingRoomRequest?.requestId === parsed.requestId) {
          this.clearPendingRequest();
        }
        if (
          pending &&
          (parsed.commandId === pending.commandId ||
            parsed.requestId === pending.requestId)
        ) {
          this.clearPendingCommand();
          if (parsed.appliedVersion !== undefined) {
            this.latestProjectionVersion = null;
          }
        }
        return;
      }
      case "room":
        this.roomVersion = parsed.room.roomVersion;
        this.latestRoomEventSeq = parsed.room.roomEventSeq;
        this.handlers.onRoom(parsed.room.roomId);
        this.handlers.onRoomView?.(parsed.room);
        return;
      case "projection":
        this.latestProjectionVersion = parsed.projection.version;
        this.latestEventSeq = Math.max(this.latestEventSeq ?? 0, parsed.projection.eventSeq);
        this.handlers.onProjection(parsed.projection);
        this.handlers.onRoom(parsed.roomId);
        this.retryPendingCommand();
        return;
      case "events": {
        this.latestEventSeq = Math.max(
          this.latestEventSeq ?? parsed.afterEventSeq,
          parsed.nextEventSeq
        );
        this.handlers.onEvents?.(parsed.events);
        return;
      }
      case "room-events": {
        this.latestRoomEventSeq = Math.max(
          this.latestRoomEventSeq ?? parsed.afterRoomEventSeq,
          parsed.nextRoomEventSeq
        );
        this.handlers.onRoomEvents?.(parsed.events);
        return;
      }
      case "error":
        this.handleServerError(parsed);
        return;
      case "pong":
        this.lastPongAt = Date.now();
        return;
    }
  }

  private handleServerError(
    message: Extract<ServerToClientMessage, { type: "error" }>
  ): void {
    const pending = this.pendingCommand;
    if (
      this.pendingRoomRequest !== null &&
      message.requestId === this.pendingRoomRequest.requestId
    ) {
      this.clearPendingRequest();
    }
    const pendingAffected =
      pending !== null &&
      (message.requestId === pending.requestId ||
        message.code === "session-replaced" ||
        message.code === "invalid-token" ||
        message.code === "room-not-found");

    if (pendingAffected) this.clearPendingCommand();

    switch (message.code) {
      case "invalid-token":
      case "room-not-found":
        this.handlers.onError("原房间已不可用，正在准备新的房间连接。");
        this.reconnectWithoutSession();
        return;
      case "session-replaced":
        this.handlers.onError("当前连接已被新的会话替换，已停止自动重连。");
        this.stopAfterSessionReplaced();
        return;
      case "stale-version":
        if (pendingAffected) this.latestProjectionVersion = null;
        this.handlers.onError("牌桌状态已更新，请重试刚才的操作。");
        return;
      case "idempotency-conflict":
        this.handlers.onError("该操作与已发送的操作冲突，请重试。");
        return;
      case "handshake-required":
        this.handlers.onError("连接尚未就绪，请重试。");
        return;
      case "protocol-error":
        this.handlers.onError("客户端与服务端通信不兼容，请检查版本。");
        return;
      case "room-full":
        this.handlers.onError("房间人数已满，无法加入。");
        return;
      case "invalid-deck":
        this.handlers.onError("卡组未通过服务端校验，请调整后再提交。");
        return;
      case "already-in-room":
        this.handlers.onError("当前连接已经进入房间。");
        return;
      case "invalid_command":
        this.handlers.onError("当前操作不符合规则，请重试。");
        return;
      case "not_your_turn":
        this.handlers.onError("尚未轮到你的回合。");
        return;
      case "prompt_required":
        this.handlers.onError("请先响应当前选择。");
        return;
      case "prompt_not_found":
      case "prompt_expired":
        this.handlers.onError("该选择已失效，请等待牌桌更新。");
        return;
      case "invalid_prompt_answer":
        this.handlers.onError("当前选择无效，请重新选择。");
        return;
      case "card_not_found":
        this.handlers.onError("该卡牌已不在手牌中。");
        return;
      case "not_enough_mana":
        this.handlers.onError("资源不足，无法执行该操作。");
        return;
      case "game_ended":
        this.handlers.onError("对局已经结束。");
        return;
      case "command-rejected":
        this.handlers.onError("服务端未接受该操作，请重试。");
        return;
      case "capacity-exceeded":
        this.handlers.onError("服务端当前繁忙，请稍后重试。");
        return;
      default:
        this.handlers.onError("操作失败，请稍后重试。");
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || !this.serverUrl) return;

    this.reconnectAttempt += 1;
    const capped = Math.min(
      500 * 2 ** Math.max(0, this.reconnectAttempt - 1),
      MAX_RECONNECT_DELAY_MS
    );
    const jitter = Math.floor(Math.random() * 250);
    const delay = capped + jitter;

    this.clearReconnectTimer();
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimer(() => {
      this.openSocket("reconnecting");
    }, delay);
  }

  private reconnectWithoutSession(): void {
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.applySession(null);
    this.handlers.onProjection(null);
    this.stopHeartbeat();
    this.intentionallyClosed = false;
    this.reconnectAttempt = 0;
    this.openSocket("reconnecting");
  }

  private stopAfterSessionReplaced(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.applySession(null);
    this.handlers.onProjection(null);

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  private stopForProtocolMismatch(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.handlers.onError("客户端与服务端版本不兼容，请更新后重试。");
    this.handlers.onProjection(null);

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        this.socket.close();
        return;
      }
      this.sendRaw({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearIntervalTimer(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private preparePendingCommandForRetry(): void {
    this.clearPendingRequest();
    const pending = this.pendingCommand;
    if (!pending) return;

    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    pending.timeoutTimer = null;
    pending.retryDue = true;
  }

  private retryPendingCommand(force = false): void {
    const pending = this.pendingCommand;
    if (!pending || (!force && !pending.retryDue) || !this.session) return;
    if (this.status !== "connected" || !this.handshakeReady) return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    if (pending.attempt >= MAX_COMMAND_ATTEMPTS) {
      this.clearPendingCommand();
      this.handlers.onError("操作确认超时，请重试。");
      return;
    }
    if (this.latestProjectionVersion === null) return;

    pending.attempt += 1;
    pending.retryDue = false;
    const requestId = this.nextRequestId("command");
    pending.requestId = requestId;
    if (!this.send({
      type: "command",
      requestId,
      commandId: pending.commandId,
      expectedVersion: this.latestProjectionVersion,
      command: pending.command
    })) {
      this.preparePendingCommandForRetry();
      return;
    }

    pending.timeoutTimer = setTimer(() => {
      const current = this.pendingCommand;
      if (!current || current.commandId !== pending.commandId) return;
      this.retryPendingCommand(true);
    }, COMMAND_TIMEOUT_MS);
  }

  private clearPendingCommand(): void {
    const pending = this.pendingCommand;
    if (!pending) return;

    this.pendingCommand = null;
    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    this.handlers.onPendingCommand?.(false);
  }

  private clearPendingRequest(): void {
    const pending = this.pendingRoomRequest;
    if (!pending) return;
    this.pendingRoomRequest = null;
    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    this.handlers.onPendingRequest?.(false);
  }

  private setStatus(status: GameClientStatus): void {
    this.status = status;
    this.handlers.onStatus(status);
  }

  private setHandshakeReady(ready: boolean): void {
    if (this.handshakeReady === ready) return;
    this.handshakeReady = ready;
    this.handlers.onHandshake(ready);
  }

  private send(message: ClientToServerMessage): boolean {
    if (
      this.status !== "connected" ||
      !this.handshakeReady ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      this.handlers.onError("连接未就绪，操作未发送。");
      return false;
    }
    return this.sendRaw(message);
  }

  private sendRaw(message: ClientToServerMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.handlers.onError("连接未就绪，操作未发送。");
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private applySession(session: StoredSession | null): void {
    this.session = session;
    writeSession(session);
    this.handlers.onSession(session);
    this.handlers.onRoom(session?.roomId ?? null);
    this.handlers.onRoomView?.(null);
  }
}

function normalizeRoomDeck(deck: RoomDeckSubmission): RoomDeckSubmission | null {
  if (typeof deck !== "object" || deck === null) return null;
  const result: Record<string, { cardId: string; quantity: number }[]> = {};
  for (const [zone, entries] of Object.entries(deck)) {
    if (!Array.isArray(entries)) return null;
    const normalizedEntries: { cardId: string; quantity: number }[] = [];
    for (const entry of entries) {
      if (
        typeof entry?.cardId !== "string" ||
        !entry.cardId ||
        typeof entry.quantity !== "number" ||
        !Number.isSafeInteger(entry.quantity) ||
        entry.quantity <= 0
      ) return null;
      normalizedEntries.push({ cardId: entry.cardId, quantity: entry.quantity });
    }
    result[zone] = normalizedEntries;
  }
  return result;
}

function requirePlayerName(input: string): string | null {
  const name = input.trim();
  if (!name || name.length > 32) return null;
  return name;
}

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return globalThis.crypto.randomUUID();
}

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.playerId !== "string" ||
      typeof value.resumeToken !== "string" ||
      typeof value.roomId !== "string" ||
      typeof value.serverUrl !== "string"
    ) {
      return null;
    }
    return {
      playerId: value.playerId,
      resumeToken: value.resumeToken,
      roomId: value.roomId,
      serverUrl: value.serverUrl
    };
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Resume storage is best-effort; the server can always issue a fresh session.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim() || DEFAULT_SERVER_URL;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `ws://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }

  if (!url.hostname) return null;

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  } else if (!/\/ws\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  }
  url.hash = "";
  return url.toString();
}

function setTimer(callback: () => void, delay: number): number {
  return globalThis.setTimeout(callback, delay) as unknown as number;
}

function clearTimer(handle: number): void {
  globalThis.clearTimeout(handle);
}

function setInterval(callback: () => void, delay: number): number {
  return globalThis.setInterval(callback, delay) as unknown as number;
}

function clearIntervalTimer(handle: number): void {
  globalThis.clearInterval(handle);
}
