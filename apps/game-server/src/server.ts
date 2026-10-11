import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  isClientMessage,
  type ClientSession,
  type ClientToServerMessage,
  type ServerToClientMessage
} from "@riftbound/protocol";
import {
  isManifestImageAvailable,
  loadCardCatalogRuntime,
  normalizeDeckRequest,
  readManifestImage,
  type CardCatalogRuntime,
} from "./card-catalog.js";
import { validateConstructedDeck } from "./constructed-policy.js";
import { createRoomId, GameRoom, RoomError } from "./room.js";

export interface GameServerOptions {
  host?: string;
  port?: number;
  roomIdFactory?: () => string;
  catalogPath?: string;
  imagesDirectory?: string;
  catalog?: unknown;
  deckRules?: CardCatalogRuntime["deckRules"];
}

export interface GameServer {
  readonly httpServer: HttpServer;
  readonly rooms: ReadonlyMap<string, GameRoom>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface SocketContext {
  handshaken: boolean;
  session?: ClientSession;
  connectionId: string;
}

const MAX_DECK_REQUEST_BYTES = 64 * 1024;
const PUBLIC_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
} as const satisfies Record<string, string>;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const makeRoomId = options.roomIdFactory ?? createRoomId;
  const rooms = new Map<string, GameRoom>();

  const serverWithCatalog = {
    runtime: null as CardCatalogRuntime | null,
    ready: null as Promise<void> | null
  };

  const loadCatalog = (): Promise<void> => {
    serverWithCatalog.ready ??= loadCardCatalogRuntime({
      catalogPath: options.catalogPath,
      imagesDirectory: options.imagesDirectory,
      catalog: options.catalog,
      deckRules: options.deckRules
    }).then(runtime => {
      serverWithCatalog.runtime = runtime;
    }).catch(error => {
      serverWithCatalog.ready = null;
      throw error;
    });
    return serverWithCatalog.ready;
  };

  const requireCatalog = (): CardCatalogRuntime => {
    const runtime = serverWithCatalog.runtime;
    if (runtime === null) {
      throw new Error("The card catalog has not finished loading.");
    }
    return runtime;
  };

  const sendJson = (
    response: ServerResponse,
    status: number,
    value: unknown
  ): void => {
    response.writeHead(status, {
      "content-type": "application/json",
      ...PUBLIC_CORS_HEADERS
    });
    response.end(JSON.stringify(value));
  };

  const sendCatalogUnavailable = (
    response: ServerResponse,
    error: unknown
  ): void => {
    sendJson(response, 503, {
      error: "catalog-unavailable",
      message: error instanceof Error
        ? error.message
        : "The card catalog is unavailable."
    });
  };

  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
      return;
    }

    let pathname: string;
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? host}`
      );
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(response, 400, { error: "invalid-url-encoding" });
      return;
    }

    if (request.method === "OPTIONS" &&
        (pathname === "/api/cards" ||
          pathname === "/api/decks/validate" ||
          pathname.startsWith("/api/card-images/"))) {
      response.writeHead(204, PUBLIC_CORS_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && pathname === "/api/cards") {
      loadCatalog().then(() => {
        const runtime = requireCatalog();
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...PUBLIC_CORS_HEADERS
        });
        response.end(runtime.publicCatalogJson);
      }).catch(error => {
        sendJson(response, 503, {
          error: "catalog-unavailable",
          message: error instanceof Error
            ? error.message
            : "The card catalog is unavailable."
        });
      });
      return;
    }

    if (request.method === "GET" &&
        pathname.startsWith("/api/card-images/")) {
      const printingId = pathname.slice("/api/card-images/".length);
      loadCatalog().then(() => {
        const runtime = requireCatalog();
        if (!isManifestImageAvailable(runtime, printingId)) {
          sendJson(response, 404, { error: "image-not-found" });
          return;
        }

        return readManifestImage(runtime, printingId).then(result => {
          if (result === null) {
            sendJson(response, 404, { error: "image-not-found" });
            return;
          }
          response.writeHead(200, {
            "content-type": result.entry.contentType,
            "content-length": result.bytes.byteLength,
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            ...PUBLIC_CORS_HEADERS
          });
          response.end(result.bytes);
        });
      }).catch(error => {
        sendJson(response, 503, {
          error: "catalog-unavailable",
          message: error instanceof Error
            ? error.message
            : "The card catalog is unavailable."
        });
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/decks/validate") {
      readRequestBytes(request, MAX_DECK_REQUEST_BYTES).then(body => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          sendJson(response, 400, {
            error: "invalid-json",
            message: "The request body must be valid JSON."
          });
          return;
        }

        const deck = normalizeDeckRequest(parsed);
        if (deck === null) {
          sendJson(response, 400, {
            error: "invalid-deck-request",
            message:
              "The request body must be { deck: { zone: [{ cardId, quantity }] } }."
          });
          return;
        }

        return loadCatalog().then(() => {
          const runtime = requireCatalog();
          const result = validateConstructedDeck(
            deck,
            runtime.validationCards,
            runtime.constructedRules
          );
          sendJson(response, 200, result);
        }).catch(error => {
          sendCatalogUnavailable(response, error);
        });
      }).catch(error => {
        if (error instanceof RequestTooLargeError) {
          request.on("data", () => {});
          request.resume();
          sendJson(response, 413, {
            error: "payload-too-large",
            message: "The deck validation request is too large."
          });
          return;
        }
        sendJson(response, 400, {
          error: "invalid-request",
          message: error instanceof Error
            ? error.message
            : "The request body could not be read."
        });
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  const webSocketServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, websocket => {
      webSocketServer.emit("connection", websocket, request);
    });
  });

  webSocketServer.on("connection", websocket => {
    const context: SocketContext = {
      handshaken: false,
      connectionId: randomUUID()
    };

    const send = (message: ServerToClientMessage): void => {
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify(message));
      }
    };

    websocket.on("message", raw => {
      handleInbound(websocket, raw, context, send, rooms, makeRoomId);
    });

    websocket.on("close", () => {
      const session = context.session;
      if (!session) return;

      const room = rooms.get(session.roomId);
      if (!room) return;

      if (room.disconnect(session.playerId, context.connectionId)) {
        room.broadcastRoom();
      }
    });
  });

  return {
    httpServer,
    rooms,
    async start() {
      // Catalog routes load lazily so a missing data snapshot cannot take down
      // the existing WebSocket service.
      loadCatalog();
      void serverWithCatalog.ready?.catch(() => undefined);
      await new Promise(resolve => {
        httpServer.listen(port, host, () => resolve(undefined));
      });
    },
    async stop() {
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise(resolve => webSocketServer.close(() => resolve(undefined)));
      await new Promise((resolve, reject) => {
        httpServer.close(cause => (cause ? reject(cause) : resolve(undefined)));
      });
    }
  };
}

class RequestTooLargeError extends Error {}

function readRequestBytes(
  request: IncomingMessage,
  maximumBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    request.once("error", reject);
    request.on("data", chunk => {
      received += chunk.byteLength;
      if (received > maximumBytes) {
        request.removeAllListeners("data");
        request.removeAllListeners("end");
          request.on("data", () => {});
          request.resume();
        reject(new RequestTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

function handleInbound(
  websocket: WebSocket,
  raw: unknown,
  context: SocketContext,
  send: (message: ServerToClientMessage) => void,
  rooms: Map<string, GameRoom>,
  makeRoomId: () => string
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    send({ type: "error", code: "protocol-error", message: "Message must be valid JSON" });
    return;
  }

  if (!isClientMessage(parsed)) {
    send({ type: "error", code: "protocol-error", message: "Invalid protocol message" });
    return;
  }

  try {
    if (!context.handshaken &&
        (parsed.type === "create-room" ||
          parsed.type === "join-room" ||
          parsed.type === "command")) {
      throw new RoomError("Send hello before any other message", "handshake-required");
    }
    if (context.handshaken &&
        parsed.type === "hello" &&
        (context.session !== undefined ||
          parsed.roomId === undefined ||
          parsed.resumeToken === undefined)) {
      throw new RoomError("The socket has already completed its handshake", "protocol-error");
    }

    switch (parsed.type) {
      case "hello":
        handleHello(parsed, context, send, rooms);
        return;

      case "create-room": {
        if (context.session) {
          throw new RoomError("Socket already has a room session", "already-in-room");
        }

        const room = new GameRoom(makeRoomId());
        rooms.set(room.roomId, room);
        const connection = room.join(parsed.playerName, send, context.connectionId);
        const session = sessionFor(room, connection);
        context.session = session;

        sendWelcome(send, session, false);
        send({ type: "room", room: room.roomView() });
        send({
          type: "request-result",
          requestId: parsed.requestId,
          ok: true
        });
        return;
      }

      case "join-room": {
        if (context.session) {
          throw new RoomError("Socket already has a room session", "already-in-room");
        }

        const room = requireRoom(rooms, parsed.roomId);
        const connection = room.join(parsed.playerName, send, context.connectionId);
        const session = sessionFor(room, connection);
        context.session = session;

        sendWelcome(send, session, false);
        send({ type: "room", room: room.roomView() });
        send({
          type: "request-result",
          requestId: parsed.requestId,
          ok: true
        });

        if (room.playerCount === 2 && room.status === "waiting") {
          room.start();
          room.broadcastRoom();
          room.broadcastProjections();
        }
        return;
      }

      case "command": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }

        const room = requireRoom(rooms, session.roomId);
        room.submit(
          session,
          context.connectionId,
          parsed.command,
          parsed.commandId,
          parsed.expectedVersion,
          parsed.requestId,
          send
        );
        return;
      }

      case "ping":
        send({ type: "pong" });
        return;
    }
  } catch (caught) {
    const requestId = "requestId" in parsed ? parsed.requestId : undefined;
    sendError(send, caught, requestId);
  }
}

function handleHello(
  inbound: Extract<ClientToServerMessage, { type: "hello" }>,
  context: SocketContext,
  send: (message: ServerToClientMessage) => void,
  rooms: Map<string, GameRoom>
): void {
  if (inbound.protocolVersion !== PROTOCOL_VERSION) {
    throw new RoomError("Unsupported protocol version", "protocol-error");
  }

  if (inbound.roomId === undefined && inbound.resumeToken === undefined) {
    context.handshaken = true;
    send({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
    return;
  }

  const room = requireRoom(rooms, inbound.roomId!);
  const connection = room.reconnect(
    inbound.resumeToken!,
    send,
    context.connectionId
  );
  if (!connection) {
    throw new RoomError("Invalid resume token", "invalid-token");
  }

  const session = sessionFor(room, connection);
  context.handshaken = true;
  context.session = session;

  sendWelcome(send, session, true);
  send({ type: "room", room: room.roomView() });
  room.sendProjection(session.playerId, send);
  room.broadcastRoom();
}

function sessionFor(room: GameRoom, connection: {
  readonly playerId: string;
  readonly resumeToken: string;
}): ClientSession {
  return {
    roomId: room.roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
}

function sendWelcome(
  send: (message: ServerToClientMessage) => void,
  session: ClientSession,
  resumed: boolean
): void {
  send({
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    session,
    resumed
  });
}

function requireRoom(rooms: ReadonlyMap<string, GameRoom>, roomId: string): GameRoom {
  const room = rooms.get(roomId);
  if (!room) throw new RoomError("Room not found", "room-not-found");
  return room;
}

function sendError(
  send: (message: ServerToClientMessage) => void,
  caught: unknown,
  requestId?: string
): void {
  const message = caught instanceof Error ? caught.message : "Request failed";
  const code = caught instanceof RoomError ? caught.code : "command-rejected";
  send({ type: "error", ...(requestId ? { requestId } : {}), code, message });
}
