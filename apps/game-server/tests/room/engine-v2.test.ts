import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID } from "@riftbound/protocol";
import { isV2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

function boot() {
  return loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog }).then(catalog => {
    const room = new GameRoom("engine-v2-room", DUEL_RULESET_ID, catalog, () => 0,
      undefined, undefined, undefined, "engine-v2");
    const messages: unknown[][] = [[], []];
    const connections = [
      room.join("Alice", value => messages[0]!.push(value), "a"),
      room.join("Bob", value => messages[1]!.push(value), "b")
    ];
    const sessions = connections.map(connection => ({
      roomId: room.roomId,
      playerId: connection.playerId,
      resumeToken: connection.resumeToken
    }));
    for (const index of [0, 1]) {
      room.submitDeck(sessions[index]!, connections[index]!.connectionId, room.currentRoomVersion,
        index === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission,
        `deck-${index}`, value => messages[index]!.push(value));
      room.setReady(sessions[index]!, connections[index]!.connectionId, room.currentRoomVersion, true,
        `ready-${index}`, value => messages[index]!.push(value));
    }
    return { catalog, room, connections, sessions, messages };
  });
}

function projection(room: GameRoom, playerId: "player-1" | "player-2") {
  let value: unknown;
  room.sendProjection(playerId, message => { value = message; });
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "projection") {
    throw new Error("v2 projection required");
  }
  const result = (value as { projection: unknown }).projection;
  if (!isV2Projection(result)) throw new Error("invalid v2 projection");
  return result;
}

describe("engine runtime room cutover", () => {
  // Booting the engine-v2 room (protocol + engine-core source transform) has
  // exceeded the 10s default under full-suite load; keep every assertion.
  it("uses the v2 owner, preserves private projections and replays the room archive", async () => {
    const h = await boot();
    const own = projection(h.room, "player-1");
    const opponent = projection(h.room, "player-2");
    expect(h.room.runtimeMode).toBe("engine-v2");
    expect(h.room.exportArchive().engineRuntimeJournal?.header.rulesetVersion).toBe("core-1.5");
    expect(own.viewerPlayerId).toBe("player-1");
    expect(opponent.viewerPlayerId).toBe("player-2");
    expect(opponent.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "player-1")?.objects).toBeUndefined();
    expect(opponent.objects.filter(object => object.ownerPlayerId === "player-1" && object.faceDown)
      .every(object => object.cardId === undefined && object.name === undefined)).toBe(true);

    const actor = own.activePlayerId === "player-1" ? 0 : 1;
    const command = { type: "pass" as const, commandId: "v2-pass", stateVersion: own.stateVersion };
    const receipts: unknown[] = [];
    h.room.submitEngineV2(h.sessions[actor]!, h.connections[actor]!.connectionId, command,
      value => receipts.push(value));
    h.room.submitEngineV2(h.sessions[actor]!, h.connections[actor]!.connectionId, command,
      value => receipts.push(value));
    expect(receipts).toEqual([
      expect.objectContaining({ type: "command-receipt", accepted: true, duplicate: false }),
      expect.objectContaining({ type: "command-receipt", accepted: true, duplicate: true })
    ]);

    const archive = h.room.exportArchive();
    const restored = GameRoom.restore(archive, h.catalog);
    expect(restored.runtimeMode).toBe("engine-v2");
    expect(projection(restored, "player-1")).toEqual(projection(h.room, "player-1"));
    expect(projection(restored, "player-2")).toEqual(projection(h.room, "player-2"));
  }, 120_000);
});
