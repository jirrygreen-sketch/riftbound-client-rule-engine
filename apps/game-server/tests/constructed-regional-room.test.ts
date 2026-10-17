/**
 * Regional Constructed room acceptance — real server wiring.
 *
 * These cases exercise the ACTUAL server-owned regional path end to end:
 * `GameRoom` construction with a bound region context, real deck validation,
 * real P4 recording/restore, and the real WebSocket create-room selector.
 *
 * Scope note on fixtures: the deck/catalog used here is the tracked
 * `tests/duel/fixtures/p4-runtime-catalog.ts` (+its 56-card representative
 * submission). Its ability text is a controlled fixture and is NOT an official
 * semantics claim. What IS real is the availability machinery under test:
 * `setCode` values (`ogn`/`unl`), the server-owned `CONSTRUCTED_RELEASE_SCHEDULE`
 * (ROW `ogn` confirmed, CN `ogn`/`ogs` unknown) and the bound region context.
 * Dates below (2026-10-14) are the current event date used for ROW availability
 * and are read through the real server module, not invented here.
 */
import { describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID,
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isJournal,
  isServerMessage,
  type ClientSession,
  type DuelCommandMessageV3Actions1,
  type ServerToClientMessage
} from "@riftbound/protocol";
import {
  loadCardCatalogRuntime,
  type CardCatalogRuntime
} from "../src/card-catalog.js";
import { GameRoom, RoomError, type RoomArchive } from "../src/room.js";
import {
  CONSTRUCTED_RELEASE_SCHEDULE_DIGEST,
  bindConstructedRegion,
  catalogForConstructedRegion,
  validateRegionalCatalogDeck
} from "../src/constructed-regional-context.js";
import { p4RuntimeFixtureCatalog } from "./duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "./duel/fixtures/setup-adapter-catalog.js";

const EVENT_DATE = "2026-10-14";
const ROW = bindConstructedRegion({ regionCode: "ROW", eventDate: EVENT_DATE });
const CN = bindConstructedRegion({ regionCode: "CN", eventDate: EVENT_DATE });
const DECK = setupAdapterFixtureDecks.a.submission;

let runtimePromise: Promise<CardCatalogRuntime> | null = null;
function runtime(): Promise<CardCatalogRuntime> {
  runtimePromise ??= loadCardCatalogRuntime({
    catalog: p4RuntimeFixtureCatalog, constructedPolicy: { asOf: EVENT_DATE }
  });
  return runtimePromise;
}

function deckCardCount(): number {
  const zones = [DECK.mainDeck, DECK.runes, DECK.legend, DECK.champion, DECK.battlefields, DECK.sideboard];
  return zones.flatMap(zone => zone ?? []).reduce((total, entry) => total + entry.quantity, 0);
}

interface Booted {
  readonly room: GameRoom;
  readonly sockets: readonly { readonly connectionId: string; readonly playerId: string }[];
  readonly sessions: readonly ClientSession[];
  readonly send: readonly ((message: ServerToClientMessage) => void)[];
  readonly outbox: readonly ServerToClientMessage[][];
}

function boot(catalog: CardCatalogRuntime, region?: ReturnType<typeof bindConstructedRegion>): Booted {
  const room = new GameRoom("constructed-regional-room", DUEL_RULESET_ID, catalog, () => 0, "p4", region);
  const outbox: ServerToClientMessage[][] = [[], []];
  const send = outbox.map(list => (message: ServerToClientMessage) => {
    expect(isServerMessage(message)).toBe(true);
    list.push(message);
  });
  const sockets = [room.join("Alice", send[0]!, "a"), room.join("Bob", send[1]!, "b")];
  const sessions = sockets.map(socket => ({
    roomId: room.roomId,
    playerId: socket.playerId,
    resumeToken: socket.resumeToken
  }));
  return { room, sockets, sessions, send, outbox };
}

function playBoth(h: Booted, deck = DECK): void {
  for (const index of [0, 1] as const) {
    h.room.submitDeck(h.sessions[index]!, h.sockets[index]!.connectionId,
      h.room.currentRoomVersion, deck, `deck-${index}`, h.send[index]!);
    h.room.setReady(h.sessions[index]!, h.sockets[index]!.connectionId,
      h.room.currentRoomVersion, true, `ready-${index}`, h.send[index]!);
  }
}

function mulliganToMain(h: Booted): void {
  const owner = () => {
    let packet: ServerToClientMessage | undefined;
    h.room.sendProjection(h.sessions[0]!.playerId, message => { packet = message; });
    if (packet?.type !== "duel-projection") throw new Error("duel projection required");
    const projection = packet.projection as { match: { stage: string; setup?: { currentMulliganOwner: string } } };
    return projection;
  };
  for (let n = 0; n < 2; n += 1) {
    const current = owner().match.setup?.currentMulliganOwner;
    if (current === undefined) throw new Error("setup owner required");
    const index = h.sessions.findIndex(session => session.playerId === current);
    const packet: DuelCommandMessageV3Actions1 = {
      type: "duel-command", requestId: `mulligan-${n}`, commandId: `mulligan-${n}`,
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      expectedVersion: h.room.roomView().version,
      command: { type: "mulligan", selectedUIDs: [] }
    };
    h.room.submitDuel(h.sessions[index]!, h.sockets[index]!.connectionId, packet, h.send[index]!);
  }
}

function projectionJson(room: GameRoom, playerId: string): string {
  let packet: ServerToClientMessage | undefined;
  room.sendProjection(playerId, message => { packet = message; });
  return JSON.stringify(packet);
}

describe("regional constructed room", () => {
  it("starts a ROW room with the real 56-card standard fixture deck on the event date", async () => {
    const catalog = await runtime();
    expect(deckCardCount()).toBe(56);
    expect(validateRegionalCatalogDeck(catalog, DECK, ROW).valid).toBe(true);
    const h = boot(catalog, ROW);
    expect(h.room.status).toBe("waiting");
    playBoth(h);
    expect(h.room.status).toBe("playing");
    const archive = h.room.exportArchive();
    expect(archive.constructedRegion?.regionCode).toBe("ROW");
    expect(isJournal(archive.journal)).toBe(true);
  });

  it("keeps a CN room creatable but rejects the same deck while OGN/OGS launch is unknown", async () => {
    const catalog = await runtime();
    const h = boot(catalog, CN);
    expect(h.room.status).toBe("waiting");
    let captured: unknown;
    try {
      h.room.submitDeck(h.sessions[0]!, h.sockets[0]!.connectionId,
        h.room.currentRoomVersion, DECK, "cn-deck", h.send[0]!);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(RoomError);
    expect((captured as RoomError).code).toBe("invalid-deck");
    expect(h.room.status).toBe("waiting");
    const validation = validateRegionalCatalogDeck(catalog, DECK, CN);
    expect(validation.valid).toBe(false);
    expect(validation.issues.every(issue => issue.code === "regional_availability_unconfirmed")).toBe(true);
  });

  it("observes different availability for the identical deck by region", async () => {
    const catalog = await runtime();
    const row = validateRegionalCatalogDeck(catalog, DECK, ROW);
    const cn = validateRegionalCatalogDeck(catalog, DECK, CN);
    expect(row.valid).toBe(true);
    expect(cn.valid).toBe(false);
    const rowCatalog = catalogForConstructedRegion(catalog, ROW);
    const cnCatalog = catalogForConstructedRegion(catalog, CN);
    expect(rowCatalog.constructedRules.policy.policyScope).not.toBe(cnCatalog.constructedRules.policy.policyScope);
    expect(rowCatalog.constructedRules.policy.policyScope).toContain(":ROW:");
    expect(cnCatalog.constructedRules.policy.policyScope).toContain(":CN:");
  });

  it("gates availability on the event-local date and rejects impossible dates", async () => {
    const catalog = await runtime();
    const dayBefore = bindConstructedRegion({ regionCode: "ROW", eventDate: "2025-10-30" });
    expect(validateRegionalCatalogDeck(catalog, DECK, dayBefore).valid).toBe(false);
    const onRelease = bindConstructedRegion({ regionCode: "ROW", eventDate: "2026-05-08" });
    expect(validateRegionalCatalogDeck(catalog, DECK, onRelease).valid).toBe(true);
    expect(() => bindConstructedRegion({ regionCode: "ROW", eventDate: "2026-02-30" })).toThrow();
    expect(() => bindConstructedRegion({ regionCode: "XX", eventDate: EVENT_DATE })).toThrow();
  });

  it("restores an unstarted regional archive in the same region but rejects a different region", async () => {
    const catalog = await runtime();
    const h = boot(catalog, ROW);
    h.room.submitDeck(h.sessions[0]!, h.sockets[0]!.connectionId,
      h.room.currentRoomVersion, DECK, "p1-deck", h.send[0]!);
    expect(h.room.status).toBe("waiting");
    const archive = h.room.exportArchive();
    expect(archive.journal).toBeNull();
    const restored = GameRoom.restore(archive, catalog);
    expect(restored.constructedRegion?.regionCode).toBe("ROW");
    expect(restored.status).toBe("waiting");
    const reRegion = structuredClone(archive) as RoomArchive;
    (reRegion as { constructedRegion: { regionCode: string } }).constructedRegion.regionCode = "CN";
    expect(() => GameRoom.restore(reRegion, catalog)).toThrow();
  });

  it("restores a started current-journal regional archive with matching replay views and trusted-source rejection", async () => {
    const catalog = await runtime();
    const h = boot(catalog, ROW);
    playBoth(h);
    mulliganToMain(h);
    expect(h.room.status).toBe("playing");
    const archive = h.room.exportArchive();
    expect(isJournal(archive.journal)).toBe(true);

    const restored = GameRoom.restore(archive, catalog);
    expect(restored.constructedRegion?.regionCode).toBe("ROW");
    expect(restored.status).toBe("playing");
    expect(projectionJson(restored, h.sessions[0]!.playerId))
      .toBe(projectionJson(h.room, h.sessions[0]!.playerId));
    expect(projectionJson(restored, h.sessions[1]!.playerId))
      .toBe(projectionJson(h.room, h.sessions[1]!.playerId));

    // A changed region context must be rejected even though the journal bytes
    // (and therefore any self-derived digest) are untouched: the trusted
    // schedule source and the deck's regional legality both refuse it.
    const reRegion = structuredClone(archive) as RoomArchive;
    (reRegion as { constructedRegion: { regionCode: string } }).constructedRegion.regionCode = "CN";
    expect(() => GameRoom.restore(reRegion, catalog)).toThrow();

    // Server-owned provenance cannot be client-forged: rewriting the source
    // digest or version is refused by verifyConstructedRegion.
    const forgedDigest = structuredClone(archive) as RoomArchive;
    (forgedDigest as { constructedRegion: { scheduleDigest: string } }).constructedRegion.scheduleDigest =
      `sha256:${"0".repeat(64)}`;
    expect(() => GameRoom.restore(forgedDigest, catalog)).toThrow();

    const forgedVersion = structuredClone(archive) as RoomArchive;
    (forgedVersion as { constructedRegion: { scheduleVersion: string } }).constructedRegion.scheduleVersion =
      "forged-schedule-version";
    expect(() => GameRoom.restore(forgedVersion, catalog)).toThrow();

    // Moving the event-local date to a different release fact is refused even
    // though the archive bytes (and any self-derived digest) stay consistent.
    const forgedDate = structuredClone(archive) as RoomArchive;
    (forgedDate as { constructedRegion: { eventDate: string } }).constructedRegion.eventDate = "2026-05-08";
    expect(() => GameRoom.restore(forgedDate, catalog)).toThrow();

    // Removing the region context from a started current archive is refused.
    const stripped = structuredClone(archive) as unknown as Record<string, unknown>;
    delete stripped.constructedRegion;
    expect(() => GameRoom.restore(stripped, catalog)).toThrow();

    expect(CONSTRUCTED_RELEASE_SCHEDULE_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("keeps a legacy region-less room on the current journal format and original behavior", async () => {
    const catalog = await runtime();
    const h = boot(catalog);
    expect(h.room.constructedRegion).toBeUndefined();
    playBoth(h);
    expect(h.room.status).toBe("playing");
    const archive = h.room.exportArchive();
    expect(archive.constructedRegion).toBeUndefined();
    expect(isJournal(archive.journal)).toBe(true);
    const restored = GameRoom.restore(archive, catalog);
    expect(restored.constructedRegion).toBeUndefined();
    expect(restored.status).toBe("playing");
    expect(isJournal(restored.exportArchive().journal)).toBe(true);
  });
});

describe("regional constructed room over the real WebSocket selector", () => {
  it("binds the server schedule for a real region select and rejects a forged selector", async () => {
    const catalog = await runtime();
    const { createGameServer } = await import("../src/server.js");
    const { InMemoryRoomStore } = await import("../src/room-store.js");
    const { WebSocket } = await import("ws");
    const { PROTOCOL_VERSION } = await import("@riftbound/protocol");

    const server = createGameServer({
      port: Number(process.env.SWARM_PORT_BASE ?? 31780),
      constructedPolicy: { asOf: EVENT_DATE },
      catalog: p4RuntimeFixtureCatalog, duelRoomProfile: "p4",
      roomIdFactory: () => `regional-ws-room-${roomSeq++}`, roomStore: new InMemoryRoomStore()
    });
    let roomSeq = 0;
    const clients: { socket: InstanceType<typeof WebSocket>; messages: ServerToClientMessage[] }[] = [];
    const connect = async (url: string) => {
      const socket = new WebSocket(url);
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      const entry = { socket, messages: [] as ServerToClientMessage[] };
      socket.on("message", raw => entry.messages.push(JSON.parse(String(raw))));
      clients.push(entry);
      const wait = async <T extends ServerToClientMessage["type"]>(type: T,
        predicate: (value: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true) => {
        const deadline = Date.now() + 10_000;
        for (;;) {
          const index = entry.messages.findIndex(message =>
            message.type === type && predicate(message as Extract<ServerToClientMessage, { type: T }>));
          if (index >= 0) return entry.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
          if (Date.now() > deadline) throw new Error(`missing ${type}`);
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      };
      socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION }));
      await wait("welcome", value => value.session === undefined);
      return { entry, wait, send: (value: unknown) => socket.send(JSON.stringify(value)) };
    };

    try {
      await server.start();
      const address = server.httpServer.address();
      if (!address || typeof address === "string") throw new Error("listening address required");
      const url = `ws://127.0.0.1:${address.port}/ws`;

      const forged = await connect(url);
      forged.send({ type: "create-room", requestId: "forged", playerName: "Forged", rulesetId: DUEL_RULESET_ID,
        constructedRegion: { regionCode: "ROW", eventDate: EVENT_DATE,
          policyVersion: "x", scheduleVersion: "y", scheduleDigest: `sha256:${"0".repeat(64)}` } });
      expect((await forged.wait("error")).code).toBe("protocol-error");

      const host = await connect(url);
      host.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID,
        constructedRegion: { regionCode: "ROW", eventDate: EVENT_DATE } });
      const session = (await host.wait("welcome")).session;
      expect(session).toBeDefined();
      await host.wait("request-result");
      const roomView = await host.wait("room");
      expect(roomView.room.constructedRegion?.regionCode).toBe("ROW");
      expect(roomView.room.constructedRegion?.policyVersion).toBe("regional-constructed-v1");
      expect(roomView.room.constructedRegion?.scheduleDigest).toBe(CONSTRUCTED_RELEASE_SCHEDULE_DIGEST);

      // A CN room is still creatable over the wire; the deck is what fails.
      const cnHost = await connect(url);
      cnHost.send({ type: "create-room", requestId: "cn", playerName: "CN", rulesetId: DUEL_RULESET_ID,
        constructedRegion: { regionCode: "CN", eventDate: EVENT_DATE } });
      expect((await cnHost.wait("welcome", value => value.session !== undefined)).session?.roomId).toBeTruthy();
      await cnHost.wait("request-result");
      expect((await cnHost.wait("room")).room.constructedRegion?.regionCode).toBe("CN");
      void catalog;
    } finally {
      for (const client of clients) client.socket.close();
      await server.stop();
    }
  });
});
