import {
  isClientMessage,
  isServerMessage,
  type ClientToServerMessage,
  type ServerToClientMessage
} from "@riftbound/protocol";

const DEFAULT_MESSAGE_TIMEOUT_MS = 2_000;

type MessageByType<T extends ServerToClientMessage["type"]> =
  Extract<ServerToClientMessage, { type: T }>;

export class ProtocolWebSocketClient {
  private readonly queued: ServerToClientMessage[] = [];
  private readonly invalidMessages: unknown[] = [];
  private readonly waiters = new Set<() => void>();
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", event => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        parsed = String(event.data);
      }

      if (!isServerMessage(parsed)) {
        this.invalidMessages.push(parsed);
        for (const wake of this.waiters) wake();
        return;
      }

      this.queued.push(parsed);
      for (const wake of this.waiters) wake();
    });
  }

  static async connect(url: string): Promise<ProtocolWebSocketClient> {
    const socket = new WebSocket(url);
    const client = new ProtocolWebSocketClient(socket);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        socket.removeEventListener("open", onOpen);
        reject(new Error(`Unable to connect to ${url}`));
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    });

    return client;
  }

  send(message: ClientToServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Cannot send on a closed WebSocket");
    }
    if (!isClientMessage(message)) {
      throw new Error(`Refusing to send invalid protocol message: ${JSON.stringify(message)}`);
    }
    this.socket.send(JSON.stringify(message));
  }

  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (message: MessageByType<T>) => boolean,
    label: string,
    timeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS
  ): Promise<MessageByType<T>> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (this.invalidMessages.length > 0) {
        throw new Error(
          `Game server sent invalid protocol messages: ${JSON.stringify(this.invalidMessages)}`
        );
      }

      const index = this.queued.findIndex(
        (message): message is MessageByType<T> =>
          message.type === type && predicate(message as MessageByType<T>)
      );
      if (index !== -1) {
        const [message] = this.queued.splice(index, 1);
        return message as MessageByType<T>;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for ${label}. Queued messages: ${JSON.stringify(this.queued)}`
        );
      }

      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          this.waiters.delete(wake);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiters.delete(wake);
          reject(
            new Error(
              `Timed out waiting for ${label}. Queued messages: ${JSON.stringify(this.queued)}`
            )
          );
        }, remaining);
        this.waiters.add(wake);
      });
    }
  }

  close(): void {
    this.socket.close();
  }
}
