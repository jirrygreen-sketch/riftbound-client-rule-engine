import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type ClientSession, type DuelCommandMessageV3Actions1,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom } from "../../src/room.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const storageParent = tmpdir();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function setup(roomId = "persistent-duel-room") {
  const directory = await mkdtemp(path.join(storageParent, "riftbound-duel-room-"));
  directories.push(directory);
  const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  const loadCatalog = async () => catalog;
  const store = new FileRoomStore(directory, loadCatalog);
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0, undefined, undefined, undefined, 'legacy-p4');
  await store.create(room);
  const events: [ServerToClientMessage[], ServerToClientMessage[]] = [[], []];
  const sockets = [room.join("Alice", m => events[0].push(m), "a"),
    room.join("Bob", m => events[1].push(m), "b")];
  const sessions = sockets.map(socket => ({ roomId, playerId: socket.playerId,
    resumeToken: socket.resumeToken })) as [ClientSession, ClientSession];
  await store.save(room);
  for (const i of [0, 1] as const) {
    const deck = (i === 0 ? setupAdapterFixtureDecks.a : setupAdapterFixtureDecks.b).submission;
    room.submitDeck(sessions[i], sockets[i].connectionId, room.currentRoomVersion,
      deck, `deck-${i}`, m => events[i].push(m));
    await store.save(room);
    room.setReady(sessions[i], sockets[i].connectionId, room.currentRoomVersion,
      true, `ready-${i}`, m => events[i].push(m));
    await store.save(room);
  }
  return { directory, catalog, store, room, events, sockets, sessions, loadCatalog };
}
function duelProjection(room: GameRoom, seat: ClientSession) {
  let packet: ServerToClientMessage | undefined;
  room.sendProjection(seat.playerId, message => { packet = message; });
  expect(packet?.type).toBe("duel-projection");
  if (packet?.type !== "duel-projection") throw new Error("Missing duel projection");
  return packet.projection;
}
function mulligan(id: string, expectedVersion: number): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", requestId: id, commandId: id,
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    expectedVersion, command: { type: "mulligan", selectedUIDs: [] } };
}

describe("actual FileRoomStore duel archive", () => {
  it("restores UID, hand, turn order, board and sticky failures without replaying RNG", async () => {
    const h = await setup();
    const setupProjection = duelProjection(h.room, h.sessions[0]);
    expect(setupProjection.match.stage).toBe("setup");
    const first = setupProjection.match.turnOrder[0] === h.sessions[0].playerId ? 0 : 1;
    const second = first === 0 ? 1 : 0;
    const bad = mulligan("out-of-order", 0);
    h.room.submitDuel(h.sessions[second], h.sockets[second].connectionId, bad,
      m => h.events[second].push(m));
    expect(h.events[second].at(-1)?.type).toBe("duel-projection");
    await h.store.save(h.room);
    const original = h.room.exportArchive();
    await h.store.close();
    const reload = new FileRoomStore(h.directory, h.loadCatalog);
    const [restored] = await reload.list();
    expect(restored?.exportArchive()).toEqual(original);
    expect(duelProjection(restored!, h.sessions[0])).toEqual(setupProjection);
    expect(restored!.roomView()).toMatchObject({ rulesetId: DUEL_RULESET_ID, version: 0 });
    expect(restored!.snapshot(h.sessions[0].playerId)).toBeNull();
    const packets: ServerToClientMessage[] = [];
    const resumed = restored!.reconnect(h.sessions[first].resumeToken, m => packets.push(m), "resumed-first");
    expect(resumed?.playerId).toBe(h.sessions[first].playerId);
    restored!.submitDuel(h.sessions[first], "resumed-first", mulligan("first-success", 0), m => packets.push(m));
    expect(packets.some(m => m.type === "request-result" && m.appliedVersion === 1)).toBe(true);
    await reload.save(restored!);
    const beforeSecond = restored!.exportArchive();
    expect(beforeSecond.journal?.entries).toHaveLength(1);
    await reload.close();
    const last = new FileRoomStore(h.directory, h.loadCatalog);
    const [roundTwo] = await last.list();
    expect(roundTwo?.exportArchive()).toEqual(beforeSecond);
    expect(roundTwo!.roomView().version).toBe(1);
    await last.close();
  });

  it("rejects mismatched room-derived ID, roster, catalog stamp, ledger and future clocks", async () => {
    const h = await setup("tampered-duel-room");
    const baseline = h.room.exportArchive();
    expect(baseline.journal).toBeTruthy();
    const edited = (mutation: (archive: ReturnType<GameRoom["exportArchive"]>) => void) => {
      const candidate = structuredClone(baseline);
      mutation(candidate);
      expect(() => GameRoom.restore(candidate, h.catalog)).toThrow();
    };
    edited(archive => { (archive.journal!.head as { journalDigest: string }).journalDigest = "untrusted"; });
    edited(archive => { (archive.seats[0] as { name: string }).name = "Imposter"; });
    edited(archive => { (archive.journal!.header as { catalogDigest: string }).catalogDigest = "forged"; });
    edited(archive => { (archive.journal!.head as { stateVersion: number }).stateVersion = 99; });
    edited(archive => { (archive.journal!.entries as unknown[]).push({ fake: true }); });
    edited(archive => { (archive.journal!.integrity as { nonce: string }).nonce = "forged-nonce"; });
    edited(archive => { (archive as { journal?: unknown }).journal = undefined; });
    edited(archive => { (archive as { journal?: unknown }).journal = null; });
    edited(archive => { (archive.seats[0] as { deck: unknown }).deck = { mainDeck: [{ cardId: "forged", quantity: 1 }] }; });
    await h.store.close();
  });
});
