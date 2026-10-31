import { describe, expect, it } from "vitest";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { previewCostPlan } from "../../../../packages/engine-core/dist/cost/discounts/index.js";
import { canPayCostPlan } from "../../../../packages/engine-core/dist/cost/payment.js";
import { staticCostSources } from "../../../../packages/engine-core/dist/programs/static-adapters/capabilities.js";
import type { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import type { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 133.3.a scopes an unqualified Mech reference to the Board. 356.4/356.4.b
// apply "costs 2 less", 356.6 floors Energy and Power, and 357.1 pays the
// combined cost. Production Surge is
// card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b.

const SURGE_CANONICAL = "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b";
const MECH_CANONICAL = "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91";
const FOCUSED_DECK_RULES: CardCatalogRuntime["deckRules"] = {
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

function view(started: StartedRoom, playerId: string): V2Projection {
  let result: V2Projection | undefined;
  started.room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: V2Projection }).projection;
    }
  });
  if (result === undefined) throw new Error(`Missing projection for ${playerId}`);
  return result;
}

function submit(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (session === undefined || connection === undefined) throw new Error(`Missing session for ${playerId}`);
  let receipt: V2CommandReceipt | undefined;
  started.room.submitEngineV2(session, connection, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === undefined) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

function pendingOwner(started: StartedRoom): string | null {
  for (const playerId of started.playerIds) {
    const current = view(started, playerId);
    if (current.pendingChoice.status === "pending" &&
        current.pendingChoice.ownerPlayerId === current.viewerPlayerId) return playerId;
  }
  return null;
}

function accepted(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const receipt = submit(started, playerId, command);
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  return receipt;
}

async function startRoom(roomId: string): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime({ deckRules: FOCUSED_DECK_RULES });
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("RIFT-1174 A", noMessages, `${roomId}:a`);
  const second = room.join("RIFT-1174 B", noMessages, `${roomId}:b`);
  const sessions = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = { [first.playerId]: first.connectionId, [second.playerId]: second.connectionId };
  const focusedDeck = { ...V2_M1_PRECONS["rumble-sfd"].deck,
    mainDeck: [{ cardId: "sfd-076-221", quantity: 20 }, { cardId: "ogn-016-298", quantity: 20 }],
  };
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    focusedDeck, `${roomId}:deck:a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready:a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    focusedDeck, `${roomId}:deck:b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}:ready:b`, noMessages);
  const started = { room, sessions, connections, playerIds: [first.playerId, second.playerId] as const };
  for (let index = 0; index < 2; index += 1) {
    const due = started.playerIds.map(playerId => view(started, playerId)).find(candidate =>
      candidate.pendingChoice.status === "pending" &&
      candidate.pendingChoice.ownerPlayerId === candidate.viewerPlayerId);
    if (due?.pendingChoice.status !== "pending") throw new Error("Expected a due Mulligan owner");
    accepted(started, due.pendingChoice.ownerPlayerId, {
      type: "mulligan", commandId: `${roomId}:mulligan:${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
  }
  return started;
}

function nextOwnMain(started: StartedRoom, playerId: string, prefix: string): V2Projection {
  for (let index = 0; index < 16; index += 1) {
    const current = view(started, playerId);
    if (current.phase === "main" && current.activePlayerId === playerId &&
        current.chain.items.length === 0) return current;
    accepted(started, current.activePlayerId, {
      type: "end-turn", commandId: `${prefix}:end:${index}`, stateVersion: current.stateVersion,
    });
  }
  throw new Error(`${prefix}: own Main Phase was not reached`);
}

function endTurnAndSettle(started: StartedRoom, prefix: string): void {
  const current = view(started, started.playerIds[0]);
  accepted(started, current.activePlayerId, {
    type: "end-turn", commandId: `${prefix}:end`, stateVersion: current.stateVersion,
  });
  for (let index = 0; index < 40; index += 1) {
    const viewForA = view(started, started.playerIds[0]);
    if (viewForA.phase === "main" && viewForA.chain.items.length === 0 &&
        viewForA.pendingChoice.status === "none") return;
    const owner = pendingOwner(started);
    if (owner !== null) {
      const pending = view(started, owner);
      if (pending.pendingChoice.status !== "pending") throw new Error(`${prefix}: pending owner disappeared`);
      const choice = pending.pendingChoice;
      const refs = (choice.options ?? []).flatMap(option => option.objectRef === undefined ? [] : [option.objectRef]);
      const answer = choice.kind === "optional" ? false : choice.kind === "mode"
        ? choice.options?.[0]?.value ?? choice.options?.[0]?.id
        : choice.kind === "order" ? refs : refs.slice(0, choice.min ?? 0);
      if (answer === undefined) throw new Error(`${prefix}: choice has no answer`);
      accepted(started, owner, {
        type: "choose", commandId: `${prefix}:choice:${index}`, stateVersion: pending.stateVersion,
        choiceId: choice.choiceId, answer,
      });
      continue;
    }
    if (viewForA.chain.items.length > 0) {
      const actor = viewForA.priority.playerId;
      if (actor === null) throw new Error(`${prefix}: nonempty Chain lacks Priority`);
      accepted(started, actor, {
        type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: viewForA.stateVersion,
      });
      continue;
    }
    if (viewForA.actionOptions.canAdvance === true) {
      accepted(started, viewForA.activePlayerId, {
        type: "advance", commandId: `${prefix}:advance:${index}`, stateVersion: viewForA.stateVersion,
      });
      continue;
    }
    if (viewForA.phase === "main") {
      accepted(started, viewForA.activePlayerId, {
        type: "end-turn", commandId: `${prefix}:next:${index}`, stateVersion: viewForA.stateVersion,
      });
      continue;
    }
  }
  throw new Error(`${prefix}: turn cycle did not settle`);
}

function fundEnergy(started: StartedRoom, playerId: string, amount: number, prefix: string): void {
  const ready = () => (view(started, playerId).zones.find(zone => zone.zone === "rune-zone" &&
    zone.ownerPlayerId === playerId)?.objects ?? []).filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
  while (ready().length < Math.max(0, amount - view(started, playerId).players.find(player => player.playerId === playerId)!.energy)) {
    endTurnAndSettle(started, `${prefix}:wait:${ready().length}`);
    endTurnAndSettle(started, `${prefix}:return:${ready().length}`);
  }
  let count = view(started, playerId).players.find(player => player.playerId === playerId)!.energy;
  for (let index = 0; count < amount; index += 1) {
    const current = view(started, playerId);
    const rune = (current.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
      .find(candidate => candidate.exhausted === false && candidate.zoneEntryId !== undefined);
    if (rune === undefined) throw new Error(`${prefix}: insufficient ready Runes`);
    accepted(started, playerId, {
      type: "rune-energy", commandId: `${prefix}:energy:${index}`, stateVersion: current.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
    count += 1;
  }
}

function fundPower(started: StartedRoom, playerId: string, name: string, prefix: string): void {
  const current = view(started, playerId);
  const rune = (current.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .find(candidate => candidate.name === name && candidate.exhausted === false && candidate.zoneEntryId !== undefined);
  if (rune === undefined) throw new Error(`${prefix}: no ready ${name}`);
  accepted(started, playerId, {
    type: "rune-power", commandId: `${prefix}:power`, stateVersion: current.stateVersion,
    runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
  });
}

function waitForPowerRune(started: StartedRoom, playerId: string, name: string, prefix: string): V2Projection {
  let current = view(started, playerId);
  for (let turn = 0; turn < 12; turn += 1) {
    const rune = (current.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
      .find(candidate => candidate.name === name && candidate.exhausted === false);
    if (rune !== undefined) return current;
    endTurnAndSettle(started, `${prefix}:wait-end:${turn}`);
    endTurnAndSettle(started, `${prefix}:wait-return:${turn}`);
    current = view(started, playerId);
  }
  throw new Error(`${prefix}: no ${name} became ready; ${JSON.stringify({
    turn: current.turnNumber, active: current.activePlayerId,
    runes: (current.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
      .map(rune => ({ name: rune.name, objectId: rune.objectId, exhausted: rune.exhausted })),
  })}`);
}

function playPermanent(started: StartedRoom, playerId: string, cardId: string, prefix: string): string {
  const current = view(started, playerId);
  const source = current.objects.find(object => object.cardId === cardId && object.zone === "hand");
  if (source === undefined) throw new Error(`${prefix}: ${cardId} is absent`);
  const option = current.actionOptions.plays.find(candidate => candidate.cardObjectId === source.objectId &&
    candidate.destination.kind === "base");
  if (option === undefined) throw new Error(`${prefix}: ${cardId} has no projected Base play`);
  accepted(started, playerId, {
    type: "play", commandId: `${prefix}:play`, stateVersion: current.stateVersion,
    cardObjectId: source.objectId, destination: option.destination,
  });
  settleChain(started, prefix);
  return source.objectId;
}

function settleChain(started: StartedRoom, prefix: string): void {
  for (let index = 0; index < 24; index += 1) {
    const current = view(started, started.playerIds[0]);
    if (current.pendingChoice.status === "pending") {
      const choice = current.pendingChoice;
      const owner = choice.ownerPlayerId;
      const refs = (choice.options ?? []).flatMap(option => option.objectRef === undefined ? [] : [option.objectRef]);
      const answer = choice.kind === "optional" ? false : choice.kind === "mode"
        ? choice.options?.[0]?.value ?? choice.options?.[0]?.id
        : choice.kind === "order" ? refs : refs.slice(0, choice.min ?? 0);
      if (answer === undefined) throw new Error(`${prefix}: choice has no answer`);
      accepted(started, owner, {
        type: "choose", commandId: `${prefix}:choose:${index}`, stateVersion: current.stateVersion,
        choiceId: choice.choiceId, answer,
      });
      continue;
    }
    if (current.chain.items.length === 0) return;
    const actor = current.priority.playerId;
    if (actor === null) throw new Error(`${prefix}: nonempty Chain lacks Priority`);
    accepted(started, actor, {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: current.stateVersion,
    });
  }
  throw new Error(`${prefix}: Chain did not settle`);
}

function previewForRoom(started: StartedRoom, playerId: string, cardObjectId: string) {
  const runtime = (started.room as unknown as {
    engineRuntime: {
      readonly match: { readonly flow: { readonly chain: ChainEngine } };
      readonly host: EngineRuntimeHost;
    };
  }).engineRuntime;
  const source = runtime.host.objects().find(object => object.ref.id === cardObjectId);
  if (source === undefined) throw new Error(`Missing authoritative source ${cardObjectId}`);
  const enginePlayerId = playerId === started.playerIds[0] ? "A" : "B";
  const binding = runtime.match.flow.chain.options.describePlay;
  if (binding === undefined) throw new Error("Trusted Play binding is absent");
  const draft = binding({ type: "play", object: source.ref, player: enginePlayerId }, source);
  if (draft.cost === undefined) throw new Error("Production Surge has no Finalize cost input");
  const chain = runtime.match.flow.chain;
  const context = runtime.host.context(source, enginePlayerId, "chain-item-finalize");
  const plan = previewCostPlan(context, draft.cost, {
    statics: [...staticCostSources(chain), ...(draft.costStatics ?? [])],
    continuous: chain.layers.registry.list().filter(entry =>
      (entry.effect.effect as { costModification?: unknown }).costModification !== true),
    originZone: source.zone,
    purpose: "play",
  });
  return { plan, payable: canPayCostPlan(context, plan) };
}

describe("RIFT-1174 Production Surge public room", () => {
  it("prices 4 without a Mech and charges 2 after a friendly Mech reaches the Board", { timeout: 180_000 }, async () => {
    const started = await startRoom("RIFT-1174-room");
    const playerId = started.playerIds[0];
    let current = nextOwnMain(started, playerId, "RIFT-1174:no-mech-main");
    for (let turn = 0; turn < 12; turn += 1) {
      current = view(started, playerId);
      const hand = current.objects.filter(object => object.ownerPlayerId === playerId && object.zone === "hand");
      if (hand.some(object => object.cardId === SURGE_CANONICAL) &&
          hand.some(object => object.cardId === MECH_CANONICAL)) break;
      endTurnAndSettle(started, `RIFT-1174:draw:${turn}`);
      endTurnAndSettle(started, `RIFT-1174:draw-return:${turn}`);
    }
    fundEnergy(started, playerId, 2, "RIFT-1174:no-mech");
    current = view(started, playerId);
    const beforeMech = current.objects.find(object => object.cardId === SURGE_CANONICAL && object.zone === "hand");
    expect(beforeMech).toBeDefined();
    expect(previewForRoom(started, playerId, beforeMech!.objectId).payable).toBe(false);

    fundEnergy(started, playerId, 3, "RIFT-1174:mech");
    const mechId = playPermanent(started, playerId, MECH_CANONICAL, "RIFT-1174:mech");
    expect(view(started, playerId).objects.find(object => object.objectId === mechId))
      .toMatchObject({ zone: "board", cardId: MECH_CANONICAL });

    waitForPowerRune(started, playerId, "Mind Rune", "RIFT-1174:surge");
    fundEnergy(started, playerId, 2, "RIFT-1174:surge");
    fundPower(started, playerId, "Mind Rune", "RIFT-1174:surge");
    current = view(started, playerId);
    const surge = current.objects.find(object => object.cardId === SURGE_CANONICAL && object.zone === "hand");
    expect(surge).toBeDefined();
    const preview = previewForRoom(started, playerId, surge!.objectId);
    expect(preview.payable).toBe(true);
    expect(preview.plan.total.energy).toBe(2);
    const energyBefore = current.players.find(player => player.playerId === playerId)!.energy;
    accepted(started, playerId, {
      type: "play", commandId: "RIFT-1174:production-surge", stateVersion: current.stateVersion,
      cardObjectId: surge!.objectId,
    });
    const after = view(started, playerId);
    expect(after.players.find(player => player.playerId === playerId)!.energy).toBe(energyBefore - 2);
    expect(after.events.some(event => event.timingPoint === "chain-item-finalize")).toBe(true);
  });
});
