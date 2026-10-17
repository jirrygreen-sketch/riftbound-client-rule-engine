import {
  PROTOCOL_V2_VERSION,
  isV2Command,
  isV2ServerMessage,
  type V2Command,
  type V2CommandMessage,
  type V2CommandReceipt,
  type V2Projection,
  type V2ServerMessage
} from "../../../../../packages/protocol/src/v2/index.js";
import type {
  V2CommandRequest,
  V2ResumeCursor,
  V2Socket,
  V2SocketFactory,
  V2TransportError,
  V2TransportEvent,
  V2TransportStatus
} from "./types.js";

const OPEN = 1;

export interface V2TransportOptions {
  readonly url: string;
  readonly socketFactory?: V2SocketFactory;
  readonly reconnect?: boolean;
  readonly maxReconnectAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxCommandRetries?: number;
  readonly commandTimeoutMs?: number;
  readonly commandIdPrefix?: string;
  readonly initialCursor?: Partial<V2ResumeCursor>;
  readonly onEvent?: (event: V2TransportEvent) => void;
}

interface PendingCommand {
  readonly command: V2Command;
  resolve: (receipt: V2CommandReceipt) => void;
  reject: (error: Error) => void;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Protocol v2 client transport.
 *
 * The transport owns command identity and retries, but never applies a game
 * action locally. A command is retried byte-for-byte with the same commandId;
 * the server therefore remains the only place where an action can be applied.
 */
export class V2Transport {
  private readonly url: string;
  private readonly socketFactory: V2SocketFactory;
  private readonly shouldReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxCommandRetries: number;
  private readonly commandTimeoutMs: number;
  private readonly commandIdPrefix: string;
  private readonly listener?: (event: V2TransportEvent) => void;
  private readonly listeners = new Set<(event: V2TransportEvent) => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private socket: V2Socket | null = null;
  private socketGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private commandCounter = 0;
  private manuallyClosed = false;
  private statusValue: V2TransportStatus = "disconnected";
  private cursor: V2ResumeCursor;

  public constructor(options: V2TransportOptions) {
    this.url = options.url;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.shouldReconnect = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 8;
    this.retryDelayMs = Math.max(1, options.retryDelayMs ?? 250);
    this.maxCommandRetries = Math.max(0, options.maxCommandRetries ?? 5);
    this.commandTimeoutMs = Math.max(1, options.commandTimeoutMs ?? 5_000);
    this.commandIdPrefix = options.commandIdPrefix ?? "desktop-v2";
    this.cursor = {
      stateVersion: Math.max(0, options.initialCursor?.stateVersion ?? 0),
      eventSeq: Math.max(0, options.initialCursor?.eventSeq ?? 0)
    };
    this.listener = options.onEvent;
    if (this.listener) this.listeners.add(this.listener);
  }

  public get status(): V2TransportStatus {
    return this.statusValue;
  }

  public get resumeCursor(): V2ResumeCursor {
    return { ...this.cursor };
  }

  public get pendingCommandIds(): readonly string[] {
    return [...this.pending.keys()];
  }

  public subscribe(listener: (event: V2TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public connect(): void {
    if (this.socket !== null && this.statusValue !== "disconnected") return;
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.openSocket(this.statusValue === "disconnected" && this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
  }

  public disconnect(reason = "client disconnect"): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.socketGeneration += 1;
    if (socket !== null) socket.close(1000, reason);
    for (const pending of this.pending.values()) {
      this.clearPendingTimers(pending);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.reconnectAttempts = 0;
    this.setStatus("disconnected");
  }

  /** Build the reconnect URL without exposing any private state. */
  public resumeUrl(): string {
    const url = new URL(this.url, typeof window === "undefined" ? "http://localhost" : window.location.href);
    url.searchParams.set("stateVersion", String(this.cursor.stateVersion));
    url.searchParams.set("eventSeq", String(this.cursor.eventSeq));
    if (/^wss?:/u.test(this.url)) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  }

  public sendCommand(request: V2CommandRequest): Promise<V2CommandReceipt> {
    const command = this.materializeCommand(request);
    if (!isV2Command(command)) {
      const error = this.error("invalid-command", "The command does not satisfy the protocol v2 guard", command);
      this.emit({ type: "error", error });
      return Promise.reject(new Error(error.message));
    }
    const existing = this.pending.get(command.commandId);
    if (existing) return new Promise((resolve, reject) => {
      const originalResolve = existing.resolve;
      const originalReject = existing.reject;
      existing.resolve = receipt => {
        originalResolve(receipt);
        resolve(receipt);
      };
      existing.reject = error => {
        originalReject(error);
        reject(error);
      };
    });

    return new Promise<V2CommandReceipt>((resolve, reject) => {
      const pending: PendingCommand = {
        command,
        resolve,
        reject,
        attempts: 0,
        retryTimer: null,
        timeoutTimer: null
      };
      this.pending.set(command.commandId, pending);
      if (this.socket === null || this.statusValue === "disconnected") this.connect();
      this.trySend(pending);
    });
  }

  /** Feed a parsed or JSON encoded server packet into the transport. */
  public handleIncoming(raw: unknown): boolean {
    let value: unknown = raw;
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        this.rejectMessage(raw, "Server packet is not valid JSON");
        return false;
      }
    }
    if (!isV2ServerMessage(value)) {
      this.rejectMessage(value, "Server packet failed the protocol v2 guard");
      return false;
    }
    this.handleServerMessage(value);
    return true;
  }

  private handleServerMessage(message: V2ServerMessage): void {
    switch (message.type) {
      case "projection":
        this.cursor = {
          stateVersion: Math.max(this.cursor.stateVersion, message.projection.stateVersion),
          eventSeq: Math.max(this.cursor.eventSeq, message.projection.eventSeq)
        };
        this.emit({ type: "projection", projection: message.projection });
        return;
      case "event":
        this.cursor = {
          stateVersion: Math.max(this.cursor.stateVersion, message.event.stateVersion),
          eventSeq: Math.max(this.cursor.eventSeq, message.event.eventSeq)
        };
        this.emit({ type: "event", event: message.event });
        return;
      case "command-receipt":
        this.cursor = {
          stateVersion: Math.max(this.cursor.stateVersion, message.stateVersion),
          eventSeq: Math.max(this.cursor.eventSeq, message.eventSeq)
        };
        this.resolveReceipt(message);
        this.emit({ type: "receipt", receipt: message });
        return;
    }
  }

  private resolveReceipt(receipt: V2CommandReceipt): void {
    const pending = this.pending.get(receipt.commandId);
    if (!pending) return;
    this.pending.delete(receipt.commandId);
    this.clearPendingTimers(pending);
    pending.resolve(receipt);
  }

  private materializeCommand(request: V2CommandRequest): V2Command {
    const input = request as V2Command & Partial<Pick<V2Command, "commandId" | "stateVersion">>;
    return {
      ...input,
      commandId: input.commandId ?? this.nextCommandId(),
      stateVersion: input.stateVersion ?? this.cursor.stateVersion
    } as V2Command;
  }

  private nextCommandId(): string {
    this.commandCounter += 1;
    return `${this.commandIdPrefix}-${this.commandCounter}`;
  }

  private trySend(pending: PendingCommand): void {
    if (!this.pending.has(pending.command.commandId)) return;
    if (this.socket === null || this.statusValue !== "connected") return;
    if (pending.attempts > this.maxCommandRetries) {
      this.pending.delete(pending.command.commandId);
      this.clearPendingTimers(pending);
      pending.reject(new Error(`Command ${pending.command.commandId} exceeded retry limit`));
      this.emit({ type: "error", error: this.error("closed", "Command retry limit exceeded") });
      return;
    }
    const message: V2CommandMessage = {
      type: "command",
      protocolVersion: PROTOCOL_V2_VERSION,
      command: pending.command
    };
    try {
      pending.attempts += 1;
      this.socket.send(JSON.stringify(message));
    } catch (cause) {
      this.emit({ type: "error", error: this.error("socket", "Unable to send command", cause) });
    }
    if (pending.timeoutTimer !== null) clearTimeout(pending.timeoutTimer);
    pending.timeoutTimer = setTimeout(() => {
      pending.timeoutTimer = null;
      if (!this.pending.has(pending.command.commandId)) return;
      if (pending.attempts > this.maxCommandRetries) {
        this.trySend(pending);
        return;
      }
      pending.retryTimer = setTimeout(() => {
        pending.retryTimer = null;
        this.trySend(pending);
      }, this.retryDelayMs);
    }, this.commandTimeoutMs);
  }

  private flushPending(): void {
    for (const pending of this.pending.values()) this.trySend(pending);
  }

  private openSocket(nextStatus: "connecting" | "reconnecting"): void {
    const generation = ++this.socketGeneration;
    this.setStatus(nextStatus);
    let socket: V2Socket;
    try {
      socket = this.socketFactory(this.resumeUrl());
    } catch (cause) {
      this.emit({ type: "error", error: this.error("socket", "Unable to open socket", cause) });
      this.onSocketClosed(generation);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.socketGeneration) return;
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.flushPending();
    };
    socket.onmessage = event => {
      if (generation !== this.socketGeneration) return;
      this.handleIncoming(event.data);
    };
    socket.onerror = event => {
      if (generation !== this.socketGeneration) return;
      this.emit({ type: "error", error: this.error("socket", "Socket error", event) });
    };
    socket.onclose = () => {
      if (generation !== this.socketGeneration) return;
      this.onSocketClosed(generation);
    };
  }

  private onSocketClosed(generation: number): void {
    if (generation !== this.socketGeneration) return;
    this.socket = null;
    if (this.manuallyClosed) {
      this.setStatus("disconnected");
      return;
    }
    if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("disconnected");
      return;
    }
    this.setStatus("reconnecting");
    this.reconnectAttempts += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket("reconnecting");
    }, this.retryDelayMs * Math.min(this.reconnectAttempts, 8));
  }

  private rejectMessage(raw: unknown, message: string): void {
    const error = this.error("invalid-message", message, raw);
    this.emit({ type: "error", error });
  }

  private error(code: V2TransportError["code"], message: string, raw?: unknown): V2TransportError {
    return { code, message, ...(raw === undefined ? {} : { raw }) };
  }

  private emit(event: V2TransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: V2TransportStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.emit({ type: "status", status });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearPendingTimers(pending: PendingCommand): void {
    if (pending.retryTimer !== null) clearTimeout(pending.retryTimer);
    if (pending.timeoutTimer !== null) clearTimeout(pending.timeoutTimer);
    pending.retryTimer = null;
    pending.timeoutTimer = null;
  }
}

function defaultSocketFactory(url: string): V2Socket {
  if (typeof WebSocket === "undefined") throw new Error("A WebSocket implementation is required");
  return new WebSocket(url) as unknown as V2Socket;
}

