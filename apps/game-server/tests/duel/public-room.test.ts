import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID, isServerMessage, type ClientSession,
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type DuelCommandMessageV3Actions1, type RoomDeckSubmission, type ServerToClientMessage
} from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom, RoomError } from "../../src/room.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
async function prepared(roomId = "duel-room-test") {
  const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0);
  const received: [ServerToClientMessage[], ServerToClientMessage[]] = [[], []];
  const connections = [room.join("Alice", m => received[0].push(m), "socket-a"),
    room.join("Bob", m => received[1].push(m), "socket-b")];
  const sessions = connections.map(c => ({ roomId, playerId: c.playerId, resumeToken: c.resumeToken })) as
    [ClientSession, ClientSession];
  const send = [((m: ServerToClientMessage) => received[0].push(m)),
    ((m: ServerToClientMessage) => received[1].push(m))] as const;
  return { room, catalog, received, connections, sessions, send };
}
type Harness = Awaited<ReturnType<typeof prepared>>;
function boot(h: Harness) {
  const decks = [setupAdapterFixtureDecks.a.submission, setupAdapterFixtureDecks.b.submission];
  for (const i of [0, 1] as const) {
    h.room.submitDeck(h.sessions[i], h.connections[i].connectionId, h.room.currentRoomVersion,
      decks[i] as RoomDeckSubmission, `deck-${i}`, h.send[i]);
    h.room.setReady(h.sessions[i], h.connections[i].connectionId, h.room.currentRoomVersion,
      true, `ready-${i}`, h.send[i]);
  }
  return h;
}
function projection(h: Harness, i: 0 | 1) {
  h.room.sendProjection(h.sessions[i].playerId, h.send[i]);
  const m = h.received[i].at(-1);
  expect(m?.type).toBe("duel-projection");
  if (m?.type !== "duel-projection") throw new Error("Missing duel projection");
  expect(isServerMessage(m)).toBe(true);
  return m.projection;
}
function command(id: string, version: number, selectedUIDs: string[] = []): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", requestId: `request-${id}`, commandId: id,
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    expectedVersion: version, command: { type: "mulligan", selectedUIDs } };
}
function submit(h: Harness, i: 0 | 1, c: DuelCommandMessageV3Actions1) {
  h.room.submitDuel(h.sessions[i], h.connections[i].connectionId, c, h.send[i]);
  return h.received[i].findLast(m => m.type === "request-result" && m.requestId === c.requestId ||
    m.type === "error" && m.requestId === c.requestId);
}

describe("actual public duel room", () => {
  it("validates decks, starts only after both ready, and exposes solely the owner's four cards", async () => {
    const h = await prepared();
    expect(h.room.status).toBe("waiting");
    expect(() => h.room.start()).toThrow(RoomError);
    boot(h);
    expect(h.room.status).toBe("playing");
    expect(h.room.roomView()).toMatchObject({ rulesetId: DUEL_RULESET_ID, version: 0 });
    const a = projection(h, 0), b = projection(h, 1);
    for (const p of [a, b]) {
      expect(p.match.stage).toBe("setup");
      if (p.match.stage !== "setup") continue;
      expect(p.match.setup.selectedBattlefields).toHaveLength(2);
      expect(p.match.setup.players.map(seat => seat.handCount)).toEqual([4, 4]);
      expect(p.match.setup.players.filter(seat => Object.hasOwn(seat, "hand"))).toHaveLength(1);
    }
    expect(JSON.stringify(h.received[0])).not.toContain(h.sessions[1].resumeToken);
    expect(JSON.stringify(h.received[1])).not.toContain(h.sessions[0].resumeToken);
    expect(() => h.room.start()).toThrow(RoomError);
    expect(() => h.room.submitDeck(h.sessions[0], "socket-a", h.room.currentRoomVersion,
      setupAdapterFixtureDecks.a.submission, "new-deck", h.send[0])).toThrow(RoomError);
  });

  it("uses turn order for two mulligans then has two shared fields and no invented Main", async () => {
    const h = boot(await prepared());
    const first = projection(h, 0).match.turnOrder[0] === h.sessions[0].playerId ? 0 : 1;
    const second = first === 0 ? 1 : 0;
    const incorrect = submit(h, second, command("not-owner", 0));
    expect(incorrect?.type).toBe("error");
    expect(h.room.roomView().version).toBe(0);
    expect(submit(h, first, command("first", 0))?.type).toBe("request-result");
    expect(projection(h, second).match.stage).toBe("setup");
    expect(submit(h, second, command("second", 1))?.type).toBe("request-result");
    for (const i of [0, 1] as const) {
      const current = projection(h, i).match;
      expect(current.stage).toBe("playing");
      if (current.stage !== "playing") continue;
      expect(current.board.battlefields).toHaveLength(2);
      expect(current.resources.players.map(p => p.runePool.energy)).toEqual([0, 0]);
      expect(current.scoring.turnNumber).toBe(0);
      expect(current.frame).toMatchObject({ phase: "awaiting-turn-start",
        priorityPlayerId: null, pendingPayment: null, turnNumber: 1 });
      expect(current.players.filter(p => Object.hasOwn(p, "hand"))).toHaveLength(1);
    }
    expect(h.room.roomView().version).toBe(2);
  });

  it("persists sticky semantic failures separately by actor and replays a successful duplicate without another RNG", async () => {
    const h = boot(await prepared());
    const first = projection(h, 0).match.turnOrder[0] === h.sessions[0].playerId ? 0 : 1;
    const second = first === 0 ? 1 : 0;
    const invalid = command("shared-id", 0, ["not-your-hand"]);
    expect(submit(h, first, invalid)?.type).toBe("error");
    expect(h.room.exportArchive().journal?.entries).toHaveLength(0);
    expect(submit(h, first, invalid)?.type).toBe("error");
    expect(h.room.exportArchive().journal?.entries).toHaveLength(0);
    expect(submit(h, first, command("valid", 0))?.type).toBe("request-result");
    expect(submit(h, second, command("shared-id", 0))?.type).toBe("error");
    expect(h.room.exportArchive().journal?.entries).toHaveLength(1);
    expect(submit(h, first, command("valid", 0))?.type).toBe("request-result");
    const earlier = submit(h, first, { ...command("valid", 0), requestId: "retry-later" });
    expect(earlier).toMatchObject({ type: "request-result", duplicate: true, appliedVersion: 1 });
    expect(h.room.roomView().version).toBe(1);
    expect(h.room.exportArchive().journal?.entries).toHaveLength(1);
  });

  it("requires current bound socket and refuses legacy cross-ruleset commands", async () => {
    const h = boot(await prepared());
    const before = h.room.exportArchive();
    expect(() => h.room.submit(h.sessions[0], "socket-a", { type: "pass" }, "legacy", 0,
      "legacy-request", h.send[0])).toThrow(RoomError);
    const resumed = h.room.reconnect(h.sessions[0].resumeToken, h.send[0], "new-socket");
    expect(resumed?.connectionId).toBe("new-socket");
    expect(() => submit(h, 0, command("old-socket", 0))).toThrowError(/replaced/);
    expect(h.room.exportArchive().journal).toEqual(before.journal);
  });

  it("rejects future event cursor and returns current duel projection rather than fabricated legacy replay", async () => {
    const h = boot(await prepared());
    expect(() => h.room.sendEvents(h.sessions[0], "socket-a", 1)).toThrow(RoomError);
    h.received[0].length = 0;
    h.room.sendEvents(h.sessions[0], "socket-a", 0);
    expect(h.received[0].map(m => m.type)).toEqual(["duel-projection"]);
    expect(h.room.snapshot(h.sessions[0].playerId)).toBeNull();
  });
});
