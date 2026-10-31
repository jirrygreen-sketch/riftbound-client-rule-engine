import { describe, expect, it } from "vitest";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { projectRuntimeFromSnapshot, projectionSnapshot } from "../../src/engine-runtime/projection.js";
import type { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";

// Riftbound Core Rules v1.5, published 2026-10-09, effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 143.2.a makes plain "Might" mean Effective Might; 317.2.c expires "this
// turn" effects in Ending cleanup; 478.1 and 478.3 evaluate all layers
// continuously. The tests below use the production M1 Rumble deck, generated
// card programs, public GameRoom sessions, and ordinary projected commands.
const EVIDENCE = Object.freeze({
  rules: ["143.2.a", "317.2.c", "475", "478", "478.1", "478.2", "478.3", "478.4"],
  rumble: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
});
const RUMBLE = EVIDENCE.rumble;
const BUBBLE_BOT = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly playerIds: readonly [string, string];
}

function readProjection(room: GameRoom, playerId: string): V2Projection {
  let result: V2Projection | undefined;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: V2Projection }).projection;
    }
  });
  if (result === undefined) throw new Error(`Missing projection for ${playerId}`);
  return result;
}

function submitThroughRoom(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (session === undefined || connection === undefined) throw new Error(`Missing room session for ${playerId}`);
  let receipt: V2CommandReceipt | undefined;
  started.room.submitEngineV2(session, connection, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === undefined) throw new Error(`Missing receipt for ${command.commandId}`);
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  return receipt;
}

async function roomWithRumbleDeck(): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const roomId = "RIFT-1176-current-might-room";
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Rumble A", noMessages, `${roomId}-a`);
  const second = room.join("Rumble B", noMessages, `${roomId}-b`);
  const sessions: Record<string, ClientSession> = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  };
  const connections: Record<string, string> = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  };
  const playerIds = [first.playerId, second.playerId] as const;
  const started: StartedRoom = { room, sessions, connections, playerIds };
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}:deck-a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, `${roomId}:deck-b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready-b`, noMessages);
  return started;
}

describe("RIFT-1176 public room current Might", () => {
  it("projects Rumble's live Mech bonus through the public room projection", async () => {
    expect(EVIDENCE.rules).toContain("478.1");
    expect(RUMBLE).toMatch(/^card\.hash-/);
    expect(BUBBLE_BOT).toMatch(/^card\.hash-/);
    const started = await roomWithRumbleDeck();

    for (let index = 0; index < 2; index += 1) {
      const due = started.playerIds.map(playerId => readProjection(started.room, playerId)).find(view =>
        view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
      if (due === undefined || due.pendingChoice.status !== "pending") throw new Error("Expected mulligan owner");
      submitThroughRoom(started, due.viewerPlayerId!, {
        type: "mulligan", commandId: `RIFT-1176:mulligan:${index}`,
        stateVersion: 0, selectedObjectIds: [],
      });
    }

    const owner = started.playerIds[0];
    const view = readProjection(started.room, owner);
    expect(view.phase).toBe("main");
    expect(view.viewerPlayerId).toBe(owner);
    expect(view.objects.some(object => object.zone === "legend")).toBe(true);
    expect(view.objects.find(object => object.zone === "legend")?.cardId).toBe(
      "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
    );
  }, 120_000);

  it("does not increase either projection after the real end-turn cycle", async () => {
    const started = await roomWithRumbleDeck();
    for (let index = 0; index < 2; index += 1) {
      const due = started.playerIds.map(playerId => readProjection(started.room, playerId)).find(view =>
        view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
      if (due === undefined || due.pendingChoice.status !== "pending") throw new Error("Expected mulligan owner");
      submitThroughRoom(started, due.viewerPlayerId!, {
        type: "mulligan", commandId: `RIFT-1176:turn-mulligan:${index}`,
        stateVersion: 0, selectedObjectIds: [],
      });
    }

    const owner = started.playerIds[0];
    const before = readProjection(started.room, owner);
    const beforeMight = before.objects.filter(object => object.zone === "board")
      .map(object => [object.objectId, object.might] as const);
    submitThroughRoom(started, before.activePlayerId!, {
      type: "end-turn", commandId: "RIFT-1176:end-turn", stateVersion: before.stateVersion,
    });
    for (let index = 0; index < 8; index += 1) {
      const current = readProjection(started.room, owner);
      if (current.activePlayerId === owner && current.phase === "main") break;
      const actor = current.activePlayerId;
      if (actor === null) throw new Error("Missing active player");
      submitThroughRoom(started, actor, {
        type: "pass", commandId: `RIFT-1176:return-turn:${index}`, stateVersion: current.stateVersion,
      });
    }
    const after = readProjection(started.room, owner);
    expect(after.activePlayerId).toBe(owner);
    expect(after.objects.filter(object => object.zone === "board")
      .map(object => [object.objectId, object.might] as const)).toEqual(beforeMight);
  }, 120_000);

  it("runs the real layer evaluation once per public room projection", async () => {
    const started = await roomWithRumbleDeck();
    for (let index = 0; index < 2; index += 1) {
      const due = started.playerIds.map(playerId => readProjection(started.room, playerId)).find(view =>
        view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
      if (due === undefined || due.pendingChoice.status !== "pending") throw new Error("Expected mulligan owner");
      submitThroughRoom(started, due.viewerPlayerId!, {
        type: "mulligan", commandId: `RIFT-1176:once-mulligan:${index}`,
        stateVersion: 0, selectedObjectIds: [],
      });
    }
    const runtime = (started.room as unknown as { engineRuntime: {
      match: Match; host: EngineRuntimeHost;
      readonly runtimeOptions: { readonly matchId: string };
      readonly stateVersion: number;
      match: { flow: { chain: { layers: { resetDiagnostics(): void; diagnostics: {
        evaluateAllCalls: number; planCacheHits: number; planCacheMisses: number; planCacheBypasses: number;
      } } } } };
    } }).engineRuntime;
    runtime.match.flow.chain.layers.resetDiagnostics();
    const snapshot = projectionSnapshot(runtime.match, runtime.host,
      runtime.runtimeOptions.matchId, runtime.stateVersion);
    for (const playerId of ["A", "B", null]) {
      projectRuntimeFromSnapshot(runtime.match, runtime.host, runtime.runtimeOptions.matchId,
        playerId, runtime.stateVersion, null, snapshot);
    }
    expect(runtime.match.flow.chain.layers.diagnostics.evaluateAllCalls).toBe(1);
    expect(runtime.match.flow.chain.layers.diagnostics.planCacheMisses).toBe(1);
  }, 120_000);
});
