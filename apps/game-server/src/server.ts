import { bindConstructedRegion, catalogForConstructedRegion, validateRegionalCatalogDeck } from './constructed-regional-context.js';
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DUEL_RULESET_ID,
  FOUNDATION_RULESET_ID,
  RULESET_ID,
  RULESET_IDS,
  PROTOCOL_VERSION,
  isClientMessage,
  isDuelCommandMessage,
  isDuelCommandMessageV3Actions1,
  type ClientSession,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import {
  isManifestImageAvailable,
  loadCardCatalogRuntime,
  normalizeDeckRequest,
  readManifestImage,
  type CardCatalogRuntime,
} from "./card-catalog.js";
import { validateConstructedDeck } from "./constructed-policy.js";
import { createRoomId, GameRoom, RoomError, type DuelRoomProfile, type DuelOptionalRoomRuntimeProfile } from "./room.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY } from "./duel/authoritative-runtime-p4.js";
import { FileRoomStore } from "./file-room-store.js";
import { InMemoryRoomStore, type RoomStore } from "./room-store.js";

export interface GameServerOptions {
  host?: string;
  port?: number;
  roomIdFactory?: () => string;
  catalogPath?: string;
  imagesDirectory?: string;
  catalog?: unknown;
  deckRules?: CardCatalogRuntime["deckRules"];
  roomStore?: RoomStore;
  storageDirectory?: string;
  /** New Duel rooms select one profile. Restored rooms keep their stored profile. */
  duelRoomProfile?: DuelRoomProfile;
  /** Trusted host opt-in for new rooms; a client packet cannot select it. */
  duelRuntimeProfile?: DuelOptionalRoomRuntimeProfile;
  /** Trusted server entropy adapter for deterministic integration runs. Never read from wire. */
  duelRandomIndex?: (exclusiveUpperBound: number) => number;
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
  queue: Promise<void>;
}

type ServerLifecycle =
  | "created"
  | "starting"
  | "started"
  | "stopping"
  | "stopped";

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
  const duelRoomProfile = options.duelRoomProfile ?? "v1";
  if (duelRoomProfile !== "v1" && duelRoomProfile !== "p4") throw new TypeError("Invalid duel room profile");
  if (options.duelRuntimeProfile !== undefined &&
      (duelRoomProfile !== "p4" || options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY))
    throw new TypeError("Invalid optional Unit server execution profile");
  const rooms = new Map<string, GameRoom>();
  const contexts = new Set<SocketContext>();
  let roomMutationQueue: Promise<unknown> = Promise.resolve();
  let stopping = false;
  let lifecycle: ServerLifecycle = "created";
  let startupPromise: Promise<void> | undefined;
  let stopRequested = false;
  let stopCompletion: Promise<void> | undefined;

  const runRoomMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = roomMutationQueue.then(operation, operation);
    roomMutationQueue = result.catch(() => undefined);
    return result;
  };

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

  const roomStore: RoomStore = options.roomStore ??
    (options.storageDirectory
      ? new FileRoomStore(options.storageDirectory, async () => {
          await loadCatalog();
          return requireCatalog();
        })
      : new InMemoryRoomStore());

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
    let regionalQuery: ReturnType<typeof bindConstructedRegion> | undefined;
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? host}`
      );
      pathname = decodeURIComponent(url.pathname);
      if (url.searchParams.has('regionCode') || url.searchParams.has('eventDate')) {
        regionalQuery=bindConstructedRegion({regionCode:url.searchParams.get('regionCode')??'',eventDate:url.searchParams.get('eventDate')??''});
      }
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
        response.end(regionalQuery ? catalogForConstructedRegion(runtime,regionalQuery).publicCatalogJson : runtime.publicCatalogJson);
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
          const result = regionalQuery ? validateRegionalCatalogDeck(runtime,deck,regionalQuery) : validateConstructedDeck(
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

  const cleanup = async (): Promise<void> => {
    const contextSnapshot = [...contexts];
    for (const context of contexts) await context.queue;
    await roomMutationQueue.catch(() => undefined);

    for (const client of webSocketServer.clients) client.terminate();
    await new Promise(resolve => webSocketServer.close(() => resolve(undefined)));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close(cause => (cause ? reject(cause) : resolve()));
      });
    }
    await roomStore.close?.();
    contexts.clear();
    for (const context of contextSnapshot) {
      contexts.delete(context);
    }
    lifecycle = "stopped";
  };

  const finishStop = (): void => {
    stopRequested = true;
    stopping = true;
    stopCompletion ??= cleanup().then(
      () => undefined,
      error => {
        // Keep the main failure visible. A later stop retries only the cleanup
        // work that was not known to have completed.
        stopCompletion = undefined;
        lifecycle = "stopping";
        throw error;
      }
    );
  };

  httpServer.on("upgrade", (request, socket, head) => {
    if (stopping) {
      socket.destroy();
      return;
    }
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
      connectionId: randomUUID(),
      queue: Promise.resolve()
    };
    contexts.add(context);

    const send = (message: ServerToClientMessage): void => {
      if (websocket.readyState === websocket.OPEN) {
        websocket.send(JSON.stringify(message), () => {});
      }
    };

    websocket.on("message", raw => {
      if (stopping) return;
      context.queue = context.queue
        .then(() => runRoomMutation(() => handleInbound(
          raw,
          context,
          send,
          roomStore,
          rooms,
          makeRoomId,
          loadCatalog,
          requireCatalog,
          duelRoomProfile,
          options.duelRandomIndex,
          options.duelRuntimeProfile
        )))
        .catch(error => {
          sendError(send, error);
        });
    });

    websocket.on("close", () => {
      if (stopping) return;
      context.queue = context.queue
        .then(() => runRoomMutation(async () => {
          const session = context.session;
          if (!session) return;
          const room = await requireRoom(roomStore, rooms, session.roomId);
          await runRoomTransaction(
            room,
            context,
            send,
            roomStore,
            () => {
              if (room.disconnect(session.playerId, context.connectionId)) {
                room.broadcastRoom();
              }
            }
          );
        }))
        .catch(() => undefined)
        .finally(() => contexts.delete(context));
    });
  });

  return {
    httpServer,
    rooms,
    async start() {
      if (lifecycle === "started") return;
      if (lifecycle === "starting") return startupPromise;
      if (lifecycle !== "created") {
        throw new Error(`The game server cannot start while ${lifecycle}`);
      }

      lifecycle = "starting";
      startupPromise = (async () => {
        // Catalog routes load lazily so a missing data snapshot cannot take
        // down the existing WebSocket service.
        loadCatalog();
        void serverWithCatalog.ready?.catch(() => undefined);
        try {
          const restoredRooms = await roomStore.list?.();
          if (stopRequested) return;
          if (restoredRooms) {
            for (const room of restoredRooms) {
              rooms.set(room.roomId, room);
            }
          }
          await new Promise<void>((resolve, reject) => {
            httpServer.once("error", reject);
            httpServer.listen(port, host, () => {
              httpServer.off("error", reject);
              resolve();
            });
          });
          if (stopRequested) return;
          lifecycle = "started";
        } catch (error) {
          lifecycle = "stopping";
          let cleanupError: unknown;
          try {
            await roomStore.close?.();
          } catch (caught) {
            cleanupError = caught;
          } finally {
            contexts.clear();
            lifecycle = "stopped";
            stopping = true;
            stopRequested = true;
          }
          if (cleanupError !== undefined && error instanceof Error) {
            error.cause = cleanupError;
          }
          throw error;
        }
      })();
      return startupPromise;
    },
    stop(): Promise<void> {
      finishStop();
      return stopCompletion ?? Promise.resolve();
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

async function handleInbound(
  raw: unknown,
  context: SocketContext,
  send: (message: ServerToClientMessage) => void,
  roomStore: RoomStore,
  rooms: Map<string, GameRoom>,
  makeRoomId: () => string,
  loadCatalog: () => Promise<void>,
  requireCatalog: () => CardCatalogRuntime,
  duelRoomProfile: DuelRoomProfile,
  duelRandomIndex?: (exclusiveUpperBound: number) => number,
  duelRuntimeProfile?: DuelOptionalRoomRuntimeProfile
): Promise<void> {
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
        parsed.type !== "hello" &&
        parsed.type !== "ping") {
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
      case "hello": {
        if (parsed.roomId === undefined && parsed.resumeToken === undefined) {
          await handleHello(parsed, context, send);
          return;
        }

        const room = await requireRoom(roomStore, rooms, parsed.roomId!);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => handleResumeHello(
            parsed,
            context,
            transactionSend,
            room
          )
        );
        return;
      }

      case "create-room": {
        if (context.session) {
          throw new RoomError("Socket already has a room session", "already-in-room");
        }

        const rulesetId = parsed.rulesetId ?? "synthetic-demo";
        if (!(RULESET_IDS as readonly string[]).includes(rulesetId)) {
          throw new RoomError(
            `Unsupported ruleset ${rulesetId}`,
            "command-rejected"
          );
        }
        const roomId = makeRoomId();
        const catalog = rulesetId === FOUNDATION_RULESET_ID || rulesetId === DUEL_RULESET_ID
          ? await loadCatalog().then(() => requireCatalog())
          : null;
        const room = new GameRoom(
          roomId,
          rulesetId,
          catalog ?? undefined,
          duelRandomIndex,
          rulesetId === DUEL_RULESET_ID ? duelRoomProfile : "v1",
          parsed.constructedRegion ? bindConstructedRegion(parsed.constructedRegion) : undefined,
          rulesetId === DUEL_RULESET_ID ? duelRuntimeProfile : undefined
        );
        if (rooms.has(roomId)) {
          throw new RoomError(`Room ${roomId} already exists`, "command-rejected");
        }
        let registered = false;
        try {
          await roomStore.create(room);
          registered = true;
          rooms.set(room.roomId, room);
          await runRoomTransaction(
            room,
            context,
            send,
            roomStore,
            transactionSend => {
              const connection = room.join(
                parsed.playerName,
                transactionSend,
                context.connectionId
              );
              const session = sessionFor(room, connection);
              context.session = session;

              sendWelcome(transactionSend, session, false);
              transactionSend({ type: "room", room: room.roomView() });
              transactionSend({
                type: "request-result",
                requestId: parsed.requestId,
                ok: true
              });
            }
          );
        } catch (error) {
          if (registered) {
            rooms.delete(room.roomId);
            await roomStore.remove(room).catch(() => undefined);
          }
          throw error;
        }
        return;
      }

      case "join-room": {
        if (context.session) {
          throw new RoomError("Socket already has a room session", "already-in-room");
        }

        const room = await requireRoom(roomStore, rooms, parsed.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            const connection = room.join(
              parsed.playerName,
              transactionSend,
              context.connectionId
            );
            const session = sessionFor(room, connection);
            context.session = session;

            sendWelcome(transactionSend, session, false);
            transactionSend({ type: "room", room: room.roomView() });
            transactionSend({
              type: "request-result",
              requestId: parsed.requestId,
              ok: true
            });

            // Join changes roomVersion for both seats, including the joiner.
            room.broadcastRoom();

            if (room.rulesetId === RULESET_ID &&
                room.playerCount === 2 &&
                room.status === "waiting") {
              room.start();
              room.broadcastRoom();
              room.broadcastProjections();
            }
          }
        );
        return;
      }

      case "command": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }

        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            room.submit(
              session,
              context.connectionId,
              parsed.command,
              parsed.commandId,
              parsed.expectedVersion,
              parsed.requestId,
              transactionSend
            );
          }
        );
        return;
      }

      case "duel-command": {
        // The room owns profile selection and never downgrades on a command.
        if (!isDuelCommandMessage(parsed) && !isDuelCommandMessageV3Actions1(parsed)) {
          throw new RoomError("当前房间尚未启用该对局动作协议", "command-rejected");
        }
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }
        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(room, context, send, roomStore, transactionSend => {
          room.submitDuel(session, context.connectionId, parsed, transactionSend);
        });
        return;
      }

      case "room-chat-send": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }
        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            room.sendChat(
              session,
              context.connectionId,
              parsed.messageId,
              parsed.text,
              parsed.requestId,
              transactionSend
            );
          }
        );
        return;
      }

      case "room-chat-sync": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }
        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            room.syncChat(
              session,
              context.connectionId,
              parsed.afterChatSeq,
              parsed.requestId,
              transactionSend
            );
          }
        );
        return;
      }

      case "submit-deck": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }

        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            room.submitDeck(
              session,
              context.connectionId,
              parsed.expectedRoomVersion,
              parsed.deck,
              parsed.requestId,
              transactionSend
            );
          }
        );
        return;
      }

      case "set-ready": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }

        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(
          room,
          context,
          send,
          roomStore,
          transactionSend => {
            room.setReady(
              session,
              context.connectionId,
              parsed.expectedRoomVersion,
              parsed.ready,
              parsed.requestId,
              transactionSend
            );
          }
        );
        return;
      }

      case "sync-events": {
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }

        const room = await requireRoom(roomStore, rooms, session.roomId);
        if (!room.isCurrentConnection(session.playerId, context.connectionId)) {
          throw new RoomError(
            "The session was replaced by a newer connection",
            "session-replaced"
          );
        }
        if (parsed.afterEventSeq !== undefined) {
          room.validateGameEventCursor(
            session,
            context.connectionId,
            parsed.afterEventSeq
          );
        }
        if (parsed.afterRoomEventSeq !== undefined) {
          room.validateRoomEventCursor(parsed.afterRoomEventSeq);
        }

        send({
          type: "request-result",
          requestId: parsed.requestId,
          ok: true
        });
        if (parsed.afterEventSeq !== undefined) {
          room.sendEvents(session, context.connectionId, parsed.afterEventSeq);
        }
        if (parsed.afterRoomEventSeq !== undefined) {
          room.sendRoomEvents(
            session,
            context.connectionId,
            parsed.afterRoomEventSeq
          );
        }
        if (room.rulesetId === DUEL_RULESET_ID && parsed.afterEventSeq === undefined) {
          room.sendProjection(session.playerId, send);
        }
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

async function handleHello(
  inbound: Extract<ClientToServerMessage, { type: "hello" }>,
  context: SocketContext,
  send: ServerTransport
): Promise<void> {
  if (inbound.protocolVersion !== PROTOCOL_VERSION) {
    throw new RoomError("Unsupported protocol version", "protocol-error");
  }

  context.handshaken = true;
  send({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
}

function handleResumeHello(
  inbound: Extract<ClientToServerMessage, { type: "hello" }>,
  context: SocketContext,
  send: ServerTransport,
  room: GameRoom
): void {
  if (inbound.protocolVersion !== PROTOCOL_VERSION) {
    throw new RoomError("Unsupported protocol version", "protocol-error");
  }

  room.validateResumeCursors(
    inbound.resumeToken!,
    inbound.afterEventSeq,
    inbound.afterRoomEventSeq
  );
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
  if (inbound.afterRoomEventSeq !== undefined) {
    room.sendRoomEvents(
      session,
      context.connectionId,
      inbound.afterRoomEventSeq
    );
  }
  if (inbound.afterEventSeq !== undefined) {
    room.sendEvents(session, context.connectionId, inbound.afterEventSeq);
  }
  room.broadcastRoom();
}

/**
 * Buffer every affected transport until the archive is durable. Failed writes
 * restore both authoritative state and the old live-session bindings.
 */
async function runRoomTransaction(
  room: GameRoom,
  context: SocketContext,
  transport: ServerTransport,
  store: RoomStore,
  operation: (send: ServerTransport) => void | Promise<void>
): Promise<void> {
  const archive = room.exportArchive();
  const connections = new Map(room.players);
  const oldSession = context.session;
  const oldHandshake = context.handshaken;
  const outbox: { transport: ServerTransport; message: ServerToClientMessage }[] = [];
  let buffering = true;
  const buffer = (destination: ServerTransport): ServerTransport => message => {
    if (buffering) {
      outbox.push({ transport: destination, message: structuredClone(message) });
    } else {
      destination(message);
    }
  };
  for (const [playerId, connection] of connections) {
    room.players.set(playerId, { ...connection, send: buffer(connection.send) });
  }
  try {
    await operation(buffer(transport));
    if (JSON.stringify(archive) !== JSON.stringify(room.exportArchive())) {
      await store.save(room);
    }
  } catch (error) {
    room.restoreArchive(archive);
    room.players.clear();
    for (const [playerId, connection] of connections) {
      room.players.set(playerId, connection);
    }
    context.handshaken = oldHandshake;
    if (oldSession) context.session = oldSession;
    else delete context.session;
    throw error;
  }

  // Reuse pre-existing transports and let new transports send normally after
  // commit. A network failure after this point must never undo a durable move.
  buffering = false;
  for (const [playerId, connection] of connections) {
    if (room.players.get(playerId)?.connectionId === connection.connectionId) {
      room.players.set(playerId, connection);
    }
  }
  for (const entry of outbox) {
    try {
      entry.transport(entry.message);
    } catch {
      // The persisted receipt can be recovered by the authenticated retry.
    }
  }
  outbox.length = 0;
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

async function requireRoom(
  roomStore: RoomStore,
  rooms: Map<string, GameRoom>,
  roomId: string
): Promise<GameRoom> {
  const room = await roomStore.get(roomId);
  if (!room) throw new RoomError("Room not found", "room-not-found");
  rooms.set(room.roomId, room);
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
