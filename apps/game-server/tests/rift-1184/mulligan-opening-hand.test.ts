import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID } from "@riftbound/protocol";
import { isV2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

// RIFT-1184 (player report fa2f4534, room 33dc5baa): the mulligan window showed
// the first player the first four hand objects in creation order, which can
// include the turn-start draw. Picking that card made the formal setup reject
// the whole room with "Mulligan cards must be in that player's hand".

type PlayerId = "player-1" | "player-2";

interface RoomInternals {
  enginePlayerId(playerId: PlayerId): "A" | "B";
  engineMulliganPreview: { readonly runtime: {
    openingHandCardIds(playerId: "A" | "B"): readonly string[];
    projectFor(playerId: "A" | "B"): import("../../../../packages/protocol/dist/v2/index.js").V2Projection;
  } } | null;
  engineMulligan: unknown;
  engineRuntime: unknown;
}

async function readyRoom(roomId: string) {
  const catalog = await loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const connections = [room.join("Alice", () => undefined, "a"), room.join("Bob", () => undefined, "b")];
  const sessions = connections.map(connection => ({
    roomId: room.roomId, playerId: connection.playerId, resumeToken: connection.resumeToken,
  }));
  for (const index of [0, 1]) {
    room.submitDeck(sessions[index]!, connections[index]!.connectionId, room.currentRoomVersion,
      index === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission,
      `deck-${index}`, () => undefined);
    room.setReady(sessions[index]!, connections[index]!.connectionId, room.currentRoomVersion, true,
      `ready-${index}`, () => undefined);
  }
  return { room, connections, sessions };
}

function projection(room: GameRoom, playerId: PlayerId) {
  let value: unknown;
  room.sendProjection(playerId, message => { value = message; });
  const result = (value as { projection?: unknown } | undefined)?.projection;
  if (!isV2Projection(result)) throw new Error("v2 projection required");
  return result;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("RIFT-1184 mulligan window shows the engine's opening hand", () => {
  it("offers exactly the CR 116 opening hand and the offered cards always start the game", async () => {
    let creationOrderWouldBeWrong = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const { room, connections, sessions } = await readyRoom(`rift-1184-${seed}`);
      const internals = room as unknown as RoomInternals;
      const first = projection(room, "player-1").activePlayerId as PlayerId;
      const second: PlayerId = first === "player-1" ? "player-2" : "player-1";
      const view = projection(room, first);
      expect(view.pendingChoice.status).toBe("pending");
      if (view.pendingChoice.status !== "pending") continue;
      const hand = view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === first)?.objects ?? [];
      expect(hand).toHaveLength(4);
      const offered = (view.pendingChoice.options ?? []).map(option =>
        hand.find(object => object.objectId === option.id)?.cardId ?? `missing:${option.id}`);
      const runtime = internals.engineMulliganPreview!.runtime;
      const engineSeat = internals.enginePlayerId(first);
      const opening = runtime.openingHandCardIds(engineSeat);
      expect(sorted(offered)).toEqual(sorted(opening));

      // The old preview took the first four hand objects of the started probe.
      const startedHand = runtime.projectFor(engineSeat).zones.find(zone =>
        zone.zone === "hand" && zone.ownerPlayerId === engineSeat)?.objects ?? [];
      const creationOrder = startedHand.slice(0, 4).map(object => object.cardId ?? "");
      if (JSON.stringify(sorted(creationOrder)) !== JSON.stringify(sorted(opening))) creationOrderWouldBeWrong += 1;

      const firstIndex = first === "player-1" ? 0 : 1;
      const secondIndex = firstIndex === 0 ? 1 : 0;
      const receipts: unknown[] = [];
      const options = view.pendingChoice.options ?? [];
      room.submitEngineV2(sessions[firstIndex]!, connections[firstIndex]!.connectionId, {
        type: "mulligan", commandId: `first-${seed}`, stateVersion: 0,
        selectedObjectIds: [options[options.length - 1]!.id, options[0]!.id],
      }, message => receipts.push(message));
      room.submitEngineV2(sessions[secondIndex]!, connections[secondIndex]!.connectionId, {
        type: "mulligan", commandId: `second-${seed}`, stateVersion: 0, selectedObjectIds: [],
      }, message => receipts.push(message));
      expect(receipts).toEqual([
        expect.objectContaining({ type: "command-receipt", accepted: true }),
        expect.objectContaining({ type: "command-receipt", accepted: true }),
      ]);
      expect(internals.engineMulligan).toBeNull();
      expect(projection(room, second).phase).not.toBe("setup");
    }
    // The fixture seeds must include openings that creation order gets wrong.
    expect(creationOrderWouldBeWrong).toBeGreaterThan(0);
  }, 60_000);
});
