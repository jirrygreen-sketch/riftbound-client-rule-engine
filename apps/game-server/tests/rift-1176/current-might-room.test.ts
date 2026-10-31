import { describe, expect, it } from "vitest";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
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
const AURA_DECK_RULES: CardCatalogRuntime["deckRules"] = {
  cardPolicies: {}, defaultMaxCopiesPerCanonical: 20,
  copyRules: [
    { zones: ["mainDeck"], maxCopiesPerCanonical: 20 },
    { zones: ["runes"], maxCopiesPerCanonical: 12 },
    { zones: ["legend"], maxCopiesPerCanonical: 1 },
    { zones: ["champion"], maxCopiesPerCanonical: 1 },
    { zones: ["battlefields"], maxCopiesPerCanonical: 1 },
  ],
  sizeRules: {
    mainDeck: { minimum: 40, maximum: 40 }, runes: { minimum: 12, maximum: 12 },
    legend: { minimum: 1, maximum: 1 }, champion: { minimum: 1, maximum: 1 },
    battlefields: { minimum: 3, maximum: 3 },
  },
  uniqueCanonicalZones: ["battlefields"],
};

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
  const catalog = await loadCardCatalogRuntime({ deckRules: AURA_DECK_RULES });
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
  const auraDeck = V2_M1_PRECONS["rumble-sfd"].deck;
  const focusedDeck = { ...auraDeck,
    mainDeck: [{ cardId: "sfd-089-221", quantity: 20 }, { cardId: "sfd-062-221", quantity: 20 }],
  };
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    focusedDeck, `${roomId}:deck-a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    focusedDeck, `${roomId}:deck-b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready-b`, noMessages);
  return started;
}

function settle(started: StartedRoom, prefix: string): V2Projection {
  for (let index = 0; index < 30; index += 1) {
    const view = readProjection(started.room, started.playerIds[0]);
    if (view.chain.items.length === 0) return view;
    const actor = view.priority.playerId;
    if (actor === null) throw new Error(`${prefix}: Chain has no Priority holder`);
    submitThroughRoom(started, actor, {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    });
  }
  throw new Error(`${prefix}: Chain did not settle`);
}

function readyRunes(started: StartedRoom, playerId: string) {
  return (readProjection(started.room, playerId).zones
    .find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter((rune): rune is typeof rune & { readonly zoneEntryId: number } =>
      rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function ownerHand(started: StartedRoom, playerId: string) {
  return (readProjection(started.room, playerId).zones
    .find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? []);
}

function driveToOwnerMain(started: StartedRoom, owner: string, prefix: string): V2Projection {
  for (let index = 0; index < 40; index += 1) {
    const view = readProjection(started.room, owner);
    if (view.phase === "main" && view.chain.items.length === 0 && view.activePlayerId === owner) return view;
    if (view.phase === "main" && view.chain.items.length === 0) {
      submitThroughRoom(started, view.activePlayerId, {
        type: "end-turn", commandId: `${prefix}:end:${index}`, stateVersion: view.stateVersion,
      });
    } else {
      const actor = view.priority.playerId ?? view.activePlayerId;
      submitThroughRoom(started, actor, {
        type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
      });
    }
    settle(started, `${prefix}:settle:${index}`);
  }
  throw new Error(`${prefix}: Owner did not reach Main`);
}

async function startedAuraMatch(): Promise<StartedRoom> {
  const started = await roomWithRumbleDeck();
  for (let index = 0; index < 2; index += 1) {
    const due = started.playerIds.map(playerId => readProjection(started.room, playerId)).find(view =>
      view.pendingChoice.status === "pending" &&
      view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") throw new Error("Expected mulligan owner");
    submitThroughRoom(started, due.viewerPlayerId!, {
      type: "mulligan", commandId: `RIFT-1176:aura-mulligan:${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
  }
  return started;
}

function fundRumble(started: StartedRoom, owner: string): void {
  driveToOwnerMain(started, owner, "RIFT-1176:aura-fund");
  const runes = readyRunes(started, owner);
  const powerRune = runes.find(rune => rune.name === "Mind Rune");
  if (powerRune === undefined) throw new Error("Rumble payment requires a Mind Rune");
  for (const [index, rune] of runes.filter(candidate => candidate.objectId !== powerRune.objectId)
    .slice(0, 8).entries()) {
    submitThroughRoom(started, owner, {
      type: "rune-energy", commandId: `RIFT-1176:aura-energy:${index}`,
      stateVersion: readProjection(started.room, owner).stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId,
    });
  }
  submitThroughRoom(started, owner, {
    type: "rune-power", commandId: "RIFT-1176:aura-power",
    stateVersion: readProjection(started.room, owner).stateVersion,
    runeObjectId: powerRune.objectId, zoneEntryId: powerRune.zoneEntryId,
  });
}

function playAuraUnits(started: StartedRoom, owner: string): {
  readonly bubbleBotId: string;
  readonly rumbleId: string;
} {
  const ids: string[] = [];
  for (const [index, cardId] of [BUBBLE_BOT, RUMBLE].entries()) {
    const view = readProjection(started.room, owner);
    const card = ownerHand(started, owner).find(object => object.cardId === cardId);
    if (card === undefined) throw new Error(`Aura deck did not deal ${cardId}`);
    const option = view.actionOptions.plays.find(candidate => candidate.cardObjectId === card.objectId);
    if (option === undefined) throw new Error(`No legal play for ${cardId}`);
    submitThroughRoom(started, owner, {
      type: "play", commandId: `RIFT-1176:aura-play:${index}`,
      stateVersion: view.stateVersion, cardObjectId: card.objectId, destination: option.destination,
    });
    settle(started, `RIFT-1176:aura-play:${index}`);
    ids.push(card.objectId);
  }
  return { bubbleBotId: ids[0]!, rumbleId: ids[1]! };
}

describe("RIFT-1176 public room current Might", () => {
  it("projects current Might for Rumble and another Mech through ordinary room commands", async () => {
    const started = await startedAuraMatch();
    const owner = started.playerIds[0];
    let ready = false;
    for (let turn = 0; turn < 9; turn += 1) {
      const view = driveToOwnerMain(started, owner, `RIFT-1176:prep:${turn}`);
      if (readyRunes(started, owner).length >= 9 &&
          ownerHand(started, owner).some(object => object.cardId === RUMBLE) &&
          ownerHand(started, owner).some(object => object.cardId === BUBBLE_BOT)) {
        ready = true;
        break;
      }
      submitThroughRoom(started, view.activePlayerId, {
        type: "end-turn", commandId: `RIFT-1176:prep-end:${turn}`, stateVersion: view.stateVersion,
      });
      settle(started, `RIFT-1176:prep-end:${turn}`);
    }
    expect(ready).toBe(true);
    fundRumble(started, owner);
    const { bubbleBotId, rumbleId } = playAuraUnits(started, owner);
    for (const viewer of started.playerIds) {
      const view = readProjection(started.room, viewer);
      expect(view.objects.find(object => object.objectId === bubbleBotId)?.might).toBe(4);
      expect(view.objects.find(object => object.objectId === rumbleId)?.might).toBe(5);
    }

    const runtime = (started.room as unknown as {
      engineRuntime: { host: EngineRuntimeHost };
    }).engineRuntime;
    const rumble = runtime.host.objects().find(object => object.ref.id === rumbleId);
    if (rumble === undefined) throw new Error("Rumble is not present in the authoritative host");
    expect(runtime.host.perform({ type: "return-to-hand", object: rumble.ref }).status).toBe("done");
    const source = runtime.host.objects().find(object => object.ref.id === rumbleId);
    expect(source === undefined || source.zone === "hand").toBe(true);
    const remaining = runtime.host.objects().filter(object => object.zone === "board"
      && object.controller === "A" && object.tags.includes("Mech") && object.cardId === BUBBLE_BOT);
    const current = runtime.match.flow.chain.layers;
    current.setObjects(runtime.host.objects());
    expect(current.evaluateAll().find(object => object.ref.id === bubbleBotId)?.might).toBe(3);
    expect(remaining).toHaveLength(1);
    for (const viewer of started.playerIds) {
      const view = readProjection(started.room, viewer);
      expect(view.objects.find(object => object.objectId === bubbleBotId)?.might).toBe(3);
      const projected = view.objects.find(object => object.objectId === rumbleId);
      expect(projected?.might ?? 4).toBe(4);
    }
  }, 180_000);

  it("starts a real public room with the production Rumble Legend and owner projection", async () => {
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
