import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  DUEL_RULESET_ID,
  type RoomDeckSubmission
} from "@riftbound/protocol";
import { PROTOCOL_V2_VERSION } from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import {
  loadM1PresetCatalog,
  type M1PresetDeck
} from "../../src/presets/index.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];

class Client {
  readonly messages: unknown[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => this.messages.push(JSON.parse(String(raw))));
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  async wait(predicate: (value: unknown) => boolean): Promise<any> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out; received ${JSON.stringify(this.messages)}`);
  }

  async waitResult(requestId: string): Promise<any> {
    return this.wait(value => value !== null && typeof value === "object" &&
      (value as { requestId?: unknown }).requestId === requestId &&
      ((value as { type?: unknown }).type === "request-result" ||
        (value as { type?: unknown }).type === "error"));
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop();
  vi.unstubAllEnvs();
});

async function start(port: number, m1PresetsOnly?: boolean): Promise<{ server: GameServer; url: string }> {
  const server = createGameServer({
    host: "127.0.0.1",
    port,
    ...(m1PresetsOnly === undefined ? {} : { m1PresetsOnly }),
    roomIdFactory: () => `m1-preset-${m1PresetsOnly ? "on" : "off"}`,
    duelRandomIndex: () => 0
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("No HTTP address");
  return {
    server,
    url: `ws://127.0.0.1:${address.port}/ws`
  };
}

async function connect(url: string): Promise<Client> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION });
  await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "welcome");
  return client;
}

async function createV2Room(url: string): Promise<{ client: Client; roomId: string }> {
  const client = await connect(url);
  client.send({
    type: "create-room",
    requestId: "create",
    playerName: "Alice",
    rulesetId: DUEL_RULESET_ID
  });
  const welcome = await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "welcome" && "session" in value);
  const result = await client.waitResult("create");
  expect(result).toMatchObject({ type: "request-result", ok: true });
  return {
    client,
    roomId: (welcome as { session: { roomId: string } }).session.roomId
  };
}

async function submit(client: Client, deck: RoomDeckSubmission, server: GameServer,
  roomId: string, requestId = "submit"): Promise<any> {
  const room = server.rooms.get(roomId)!;
  client.send({
    type: "submit-deck",
    requestId,
    expectedRoomVersion: room.currentRoomVersion,
    deck
  });
  return client.waitResult(requestId);
}

function tamperOneCard(deck: RoomDeckSubmission): RoomDeckSubmission {
  const mainDeck = structuredClone(deck.mainDeck!);
  const first = mainDeck[0]!;
  if (first.quantity > 1) {
    mainDeck[0] = { ...first, quantity: first.quantity - 1 };
  } else {
    mainDeck.splice(0, 1);
  }
  return { ...deck, mainDeck };
}

describe("M1 preset HTTP and beta room gate", () => {
  it("lists both preset summaries and deck contents without requiring a room", async () => {
    const running = await start(Number(process.env.SWARM_PORT_BASE ?? 39480), false);
    const address = running.server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("No HTTP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/presets`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json() as any;
    expect(body.schemaVersion).toBe("riftbound.m1-preset-catalog.v1");
    expect(body.presets).toHaveLength(2);
    expect(body.presets.map((preset: any) => ({
      id: preset.id,
      name: preset.name,
      legend: preset.legend.name,
      champion: preset.champion.name,
      cardCount: preset.cardCount,
      digest: preset.digest
    }))).toEqual([
      {
        id: "rumble-sfd",
        name: "Rumble (Mechanized Menace)",
        legend: "Mechanized Menace",
        champion: "Rumble, Hotheaded",
        cardCount: 56,
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      },
      {
        id: "fiora-sfd",
        name: "Fiora (Grand Duelist)",
        legend: "Grand Duelist",
        champion: "Fiora, Peerless",
        cardCount: 56,
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }
    ]);
  });

  it("preserves the existing submit-deck behavior when the beta gate is off", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 39480) + 1;
    const running = await start(port, false);
    const catalog = await loadCardCatalogRuntime();
    const custom = structuredClone(
      (await loadM1PresetCatalog(catalog)).presets[0].deck
    );
    const championCard = catalog.publicCatalog.cards.find(card =>
      card.id === custom.champion![0]!.cardId
    )!;
    const otherPrintings = catalog.publicCatalog.cards.filter(card =>
      card.canonicalCardId === championCard.canonicalCardId
    );
    expect(otherPrintings.length).toBeGreaterThan(1);
    // A canonical-equivalent alternate printing has a different deck digest,
    // proving the disabled path does not impose the beta preset matching rule.
    const withoutPreset = {
      ...custom,
      champion: [{ cardId: otherPrintings[1]!.id, quantity: 1 }]
    };
    expect(validateCatalogDeck(catalog, withoutPreset).valid).toBe(true);
    const { client, roomId } = await createV2Room(running.url);
    const result = await submit(client, withoutPreset, running.server, roomId);
    expect(result).toMatchObject({ type: "request-result", ok: true });
    expect(running.server.rooms.get(roomId)?.roomView().players[0]?.deckSubmitted).toBe(true);
  });

  it("accepts an exact preset and rejects a one-card tamper when the beta gate is on", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 39480) + 2;
    vi.stubEnv("RIFTBOUND_M1_PRESETS_ONLY", "1");
    const running = await start(port);
    const catalog = await loadCardCatalogRuntime();
    const preset: M1PresetDeck = (await loadM1PresetCatalog(catalog)).presets[0];
    const { client, roomId } = await createV2Room(running.url);

    const tampered = await submit(client, tamperOneCard(preset.deck), running.server, roomId, "tampered");
    expect(tampered).toMatchObject({
      type: "error",
      requestId: "tampered",
      code: "invalid-deck"
    });
    expect(tampered.message).toContain("only accept the rumble-sfd or fiora-sfd preset");
    expect(running.server.rooms.get(roomId)?.roomView().players[0]?.deckSubmitted).toBe(false);

    const accepted = await submit(client, preset.deck, running.server, roomId, "exact");
    expect(accepted).toMatchObject({ type: "request-result", ok: true });
    expect(running.server.rooms.get(roomId)?.roomView().players[0]?.deckSubmitted).toBe(true);
  });
});
