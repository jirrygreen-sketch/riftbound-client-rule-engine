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
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isClientMessage,
  isDuelCommandMessage,
  isDuelCommandMessageV3Actions1,
  type ClientSession,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandMessage
} from "../../../packages/protocol/dist/v2/index.js";
import {
  isManifestImageAvailable,
  loadCardCatalogRuntime,
  normalizeDeckRequest,
  readManifestImage,
  type CardCatalogLoadOptions,
  type CardCatalogRuntime,
} from "./card-catalog.js";
import { validateConstructedDeck } from "./constructed-policy.js";
import { createRoomId, GameRoom, RoomError, type DuelRoomProfile, type DuelOptionalRoomRuntimeProfile, type DuelRuntimeMode } from "./room.js";
import { DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY } from "./duel/authoritative-runtime-p4.js";
import {
  FileRoomStore,
  QuarantinedRoomError,
  type QuarantinedRoomRecord
} from "./file-room-store.js";
import { InMemoryRoomStore, type RoomStore } from "./room-store.js";
import {
  loadM1PresetCatalog,
  matchingM1Preset,
  m1DeckDigest,
  type M1PresetCatalog
} from "./presets/index.js";

export interface GameServerOptions {
  host?: string;
  port?: number;
  roomIdFactory?: () => string;
  catalogPath?: string;
  imagesDirectory?: string;
  catalog?: unknown;
  deckRules?: CardCatalogRuntime["deckRules"];
  constructedPolicy?: CardCatalogLoadOptions["constructedPolicy"];
  roomStore?: RoomStore;
  storageDirectory?: string;
  /** @deprecated Parsed for compatibility; all Duel rooms use the current runtime. */
  duelRoomProfile?: DuelRoomProfile;
  /** @deprecated Parsed for compatibility; does not affect execution or recovery. */
  duelRuntimeProfile?: DuelOptionalRoomRuntimeProfile;
  /** Explicit rollback switch for protocol-v1 rooms; v2 rooms always use engine-v2. */
  duelRuntimeMode?: DuelRuntimeMode;
  /** Trusted server entropy adapter for deterministic integration runs. Never read from wire. */
  duelRandomIndex?: (exclusiveUpperBound: number) => number;
  /** Beta safety gate. When true, engine-v2 Duel rooms accept only an M1 preset deck. */
  m1PresetsOnly?: boolean;
}

export interface GameServer {
  readonly httpServer: HttpServer;
  readonly rooms: ReadonlyMap<string, GameRoom>;
  readonly quarantinedRooms: readonly QuarantinedRoomRecord[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface SocketContext {
  handshaken: boolean;
  protocolMode: "v1" | "v2";
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
      (options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN && options.duelRuntimeProfile !== DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY))
    throw new TypeError("Invalid optional Unit server execution profile");
  if (options.duelRoomProfile !== undefined || options.duelRuntimeProfile !== undefined) {
    console.warn("[deprecated] duelRoomProfile/duelRuntimeProfile 已忽略；房间统一使用当前 runtime");
  }
  if (options.duelRuntimeMode !== undefined && options.duelRuntimeMode !== "legacy-p4" && options.duelRuntimeMode !== "engine-v2") {
    throw new TypeError("Invalid duel runtime mode");
  }
  const duelRuntimeMode = options.duelRuntimeMode ?? "engine-v2";
  const m1PresetsOnly = options.m1PresetsOnly ?? process.env.RIFTBOUND_M1_PRESETS_ONLY === "1";
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
  let presetCatalogPromise: Promise<M1PresetCatalog> | undefined;

  const loadCatalog = (): Promise<void> => {
    serverWithCatalog.ready ??= loadCardCatalogRuntime({
      catalogPath: options.catalogPath,
      imagesDirectory: options.imagesDirectory,
      catalog: options.catalog,
      deckRules: options.deckRules,
      constructedPolicy: options.constructedPolicy
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

  const loadPresets = (): Promise<M1PresetCatalog> => {
    presetCatalogPromise ??= loadM1PresetCatalog(requireCatalog()).catch(error => {
      presetCatalogPromise = undefined;
      throw error;
    });
    return presetCatalogPromise;
  };

  const roomStore: RoomStore = options.roomStore ??
    (options.storageDirectory
      ? new FileRoomStore(options.storageDirectory, async () => {
          await loadCatalog();
          return requireCatalog();
        })
      : new InMemoryRoomStore());
  let quarantinedRooms: readonly QuarantinedRoomRecord[] = [];

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
      response.end(JSON.stringify({
        status: "ok",
        rooms: rooms.size,
        ...(quarantinedRooms.length === 0 ? {} : {
          quarantinedRooms: quarantinedRooms.map(room => ({
            roomId: room.roomId,
            rulesetId: room.rulesetId,
            rulesetVersion: room.rulesetVersion,
            engineVersion: room.engineVersion,
            protocolVersion: room.protocolVersion,
            reason: room.reason,
            quarantinedAt: room.quarantinedAt
          }))
        })
      }));
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
          pathname === "/api/presets" ||
          pathname === "/api/decks/validate" ||
          pathname.startsWith("/api/card-images/"))) {
      response.writeHead(204, PUBLIC_CORS_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && pathname === "/api/presets") {
      loadCatalog().then(loadPresets).then(catalog => {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...PUBLIC_CORS_HEADERS
        });
        response.end(JSON.stringify(catalog));
      }).catch(error => {
        sendJson(response, 503, {
          error: "m1-preset-catalog-unavailable",
          message: error instanceof Error
            ? error.message
            : "The M1 preset catalog is unavailable."
        });
      });
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
    await Promise.all([...rooms.values()].map(room => room.close()));
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
      protocolMode: "v1",
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
          loadPresets,
          m1PresetsOnly,
          options.duelRandomIndex,
          options.storageDirectory,
          duelRuntimeMode
        )))
        .catch(error => {
          sendError(send, error, maybeV2CommandId(raw));
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
    get quarantinedRooms() { return quarantinedRooms; },
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
              await room.enableDurability(options.storageDirectory);
              rooms.set(room.roomId, room);
            }
          }
          if (roomStore instanceof FileRoomStore) {
            try {
              quarantinedRooms = await roomStore.inspectQuarantined();
            } catch (error) {
              console.error(`[room-restore] quarantine index unavailable: ${errorMessage(error)}`);
              quarantinedRooms = [];
            }
          } else {
            quarantinedRooms = [];
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
            await Promise.all([...rooms.values()].map(room => room.close()));
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
  loadPresets: () => Promise<M1PresetCatalog>,
  m1PresetsOnly: boolean,
  duelRandomIndex?: (exclusiveUpperBound: number) => number,
  storageDirectory?: string,
  duelRuntimeMode?: DuelRuntimeMode
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    send({ type: "error", code: "protocol-error", message: "Message must be valid JSON" });
    return;
  }

  if (isV2CommandMessage(parsed)) {
    if (!context.handshaken || context.protocolMode !== "v2") {
      send({ type: "error", code: "protocol-error", message: "Protocol v2 requires a v2 hello handshake" });
      return;
    }
    const session = context.session;
    if (!session) {
      sendError(
        send,
        new RoomError("No room session is attached to this socket", "command-rejected"),
        parsed.command.commandId
      );
      return;
    }
    const room = await requireRoom(roomStore, rooms, session.roomId);
    try {
      await runRoomTransaction(
        room,
        context,
        send,
        roomStore,
        transactionSend => room.submitEngineV2(
          session,
          context.connectionId,
          parsed.command,
          transactionSend as unknown as (message: unknown) => void
        )
      );
    } catch (caught) {
      sendError(send, caught, parsed.command.commandId);
    }
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
        if (room.runtimeMode !== (parsed.protocolVersion === PROTOCOL_V2_VERSION ? "engine-v2" : "legacy-p4") &&
            room.rulesetId === DUEL_RULESET_ID) {
          throw new RoomError("The room requires a different protocol/runtime version", "protocol-error");
        }
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
        if (rulesetId === DUEL_RULESET_ID && context.protocolMode === "v1" && duelRuntimeMode !== "legacy-p4") {
          throw new RoomError("Protocol v1 Duel rooms require explicit duelRuntimeMode=legacy-p4", "protocol-error");
        }
        const roomId = makeRoomId();
        const catalog = rulesetId === FOUNDATION_RULESET_ID || rulesetId === DUEL_RULESET_ID
          ? await loadCatalog().then(() => requireCatalog())
          : null;
        // Protocol v2 creates an engine-v2 Duel room. A protocol-v1 client
        // keeps the legacy P4 owner so old clients and journals remain
        // readable; a v1 client cannot resume an engine-v2 room (the version
        // check above rejects that mixed session).
        const room = new GameRoom(
          roomId,
          rulesetId,
          catalog ?? undefined,
          duelRandomIndex,
          undefined,
          parsed.constructedRegion ? bindConstructedRegion(parsed.constructedRegion) : undefined,
          undefined,
          context.protocolMode === "v2" ? "engine-v2" : duelRuntimeMode
        );
        await room.enableDurability(storageDirectory);
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

              sendWelcome(transactionSend, session, false,
                context.protocolMode === "v2" ? PROTOCOL_V2_VERSION : PROTOCOL_VERSION);
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
        if (room.runtimeMode !== (context.protocolMode === "v2" ? "engine-v2" : "legacy-p4") &&
            room.rulesetId === DUEL_RULESET_ID) {
          throw new RoomError("The room requires a different protocol/runtime version", "protocol-error");
        }
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

            sendWelcome(transactionSend, session, false,
              context.protocolMode === "v2" ? PROTOCOL_V2_VERSION : PROTOCOL_VERSION);
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
        // Wire guards do not select an executor; the room owns one current runtime.
        if (!isDuelCommandMessage(parsed) && !isDuelCommandMessageV3Actions1(parsed)) {
          throw new RoomError("当前房间尚未启用该对局动作协议", "command-rejected");
        }
        const session = context.session;
        if (!session) {
          throw new RoomError("No room session is attached to this socket", "command-rejected");
        }
        const room = await requireRoom(roomStore, rooms, session.roomId);
        await runRoomTransaction(room, context, send, roomStore, transactionSend => {
          const packet = context.protocolMode === "v1" && isDuelCommandMessage(parsed)
            ? { ...parsed, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 }
            : parsed;
          return room.submitDuel(session, context.connectionId, packet, transactionSend);
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
        if (m1PresetsOnly && room.rulesetId === DUEL_RULESET_ID && room.runtimeMode === "engine-v2") {
          await loadCatalog();
          const presets = await loadPresets();
          if (matchingM1Preset(parsed.deck, presets) === null) {
            throw new RoomError(
              `M1 beta rooms only accept the rumble-sfd or fiora-sfd preset. ` +
                `Deck digest ${m1DeckDigest(parsed.deck)} did not match an available preset.`,
              "invalid-deck"
            );
          }
        }
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
  if (inbound.protocolVersion !== PROTOCOL_VERSION && inbound.protocolVersion !== PROTOCOL_V2_VERSION) {
    throw new RoomError("Unsupported protocol version", "protocol-error");
  }

  context.handshaken = true;
  context.protocolMode = inbound.protocolVersion === PROTOCOL_V2_VERSION ? "v2" : "v1";
  send({ type: "welcome", protocolVersion: inbound.protocolVersion });
}

function handleResumeHello(
  inbound: Extract<ClientToServerMessage, { type: "hello" }>,
  context: SocketContext,
  send: ServerTransport,
  room: GameRoom
): void {
  if (inbound.protocolVersion !== PROTOCOL_VERSION && inbound.protocolVersion !== PROTOCOL_V2_VERSION) {
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
  context.protocolMode = inbound.protocolVersion === PROTOCOL_V2_VERSION ? "v2" : "v1";
  context.session = session;

  sendWelcome(send, session, true, inbound.protocolVersion);
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
 * restore room metadata and live-session bindings. An already confirmed Duel
 * CAS head remains authoritative and can be recovered after a failed metadata save.
 */
async function runRoomTransaction(
  room: GameRoom,
  context: SocketContext,
  transport: ServerTransport,
  store: RoomStore,
  operation: (send: ServerTransport) => void | Promise<void>
): Promise<void> {
  await room.enableDurability();
  const archive = room.exportArchive();
  const revision = roomRevision(room);
  const connections = new Map(room.players);
  const oldSession = context.session;
  const oldHandshake = context.handshaken;
  const oldProtocolMode = context.protocolMode;
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
    if (revision !== roomRevision(room)) {
      await store.save(room);
    }
  } catch (error) {
    room.restoreArchive(archive);
    room.players.clear();
    for (const [playerId, connection] of connections) {
      room.players.set(playerId, connection);
    }
    context.handshaken = oldHandshake;
    context.protocolMode = oldProtocolMode;
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
  resumed: boolean,
  protocolVersion: string = PROTOCOL_VERSION
): void {
  send({
    type: "welcome",
    protocolVersion,
    session,
    resumed
  });
}

async function requireRoom(
  roomStore: RoomStore,
  rooms: Map<string, GameRoom>,
  roomId: string
): Promise<GameRoom> {
  let room: GameRoom | null;
  try {
    room = await roomStore.get(roomId);
  } catch (error) {
    if (error instanceof QuarantinedRoomError) {
      const message = errorMessage(error).replace(/\s+/g, " ").trim().slice(0, 512).trimEnd();
      throw new RoomError(message, "room-not-found");
    }
    throw error;
  }
  if (!room) throw new RoomError("Room not found", "room-not-found");
  rooms.set(room.roomId, room);
  return room;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function maybeV2CommandId(raw: unknown): string | undefined {
  try {
    const value = JSON.parse(String(raw)) as {
      readonly type?: unknown;
      readonly command?: { readonly commandId?: unknown };
    };
    return value.type === "command" && typeof value.command?.commandId === "string" &&
      value.command.commandId.length > 0 && value.command.commandId.length <= 256
      ? value.command.commandId : undefined;
  } catch {
    return undefined;
  }
}

function roomRevision(room: GameRoom): string {
  const clock = room.runtimeClock;
  return JSON.stringify([room.currentRoomVersion, room.currentRoomEventSeq,
    clock.stateVersion, clock.eventSeq, room.currentJournalRevision, room.currentChatSeq]);
}
