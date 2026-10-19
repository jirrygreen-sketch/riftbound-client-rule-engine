import type {
  V2ChainSnapshot,
  V2Command,
  V2Event,
  V2Phase,
  V2Projection,
  V2ProjectedObject,
  V2Zone,
} from "../../../../packages/protocol/dist/v2/index.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import type { ObjectSnapshot, PlayerId } from "../../../../packages/engine-core/dist/effects/contract.js";
import { readEmpowered } from "../../../../packages/engine-core/dist/zones/empower-state.js";
import type { EngineRuntimeHost } from "./host.js";
import { digest } from "./journal.js";

const zoneNames: readonly V2Zone[] = ["base", "board", "battlefield", "champion", "legend", "rune-zone", "hand", "deck", "rune-deck", "trash", "banishment", "chain", "facedown"];

function v2Zone(zone: ObjectSnapshot["zone"]): V2Zone {
  return zone as V2Zone;
}

function phase(match: Match): V2Phase {
  switch (match.flow.phase) {
    case "awaken": return "awaken";
    case "beginning": return "beginning";
    case "channel": return "channel";
    case "draw": return "draw";
    case "main": return "main";
    case "ending": return "ending";
    default: return match.result().winner ? "ended" : "setup";
  }
}

function hiddenId(viewer: string | null, object: ObjectSnapshot): string {
  return `hidden:${digest([viewer ?? "spectator", object.ref.id, object.ref.zoneEntryId ?? 0]).slice(0, 32)}`;
}

function isPublic(object: ObjectSnapshot, viewer: string | null, grants: ReturnType<EngineRuntimeHost["visibility"]>): boolean {
  if (object.zone !== "hand" && object.zone !== "deck" && object.zone !== "rune-deck" && object.faceDown === false) return true;
  if (viewer !== null && object.controller === viewer) return true;
  return grants.some(grant => grant.active && grant.object.id === object.ref.id && grant.object.zoneEntryId === object.ref.zoneEntryId && grant.viewers.includes(viewer ?? ""));
}

function projectedObject(object: ObjectSnapshot, viewer: string | null, grants: ReturnType<EngineRuntimeHost["visibility"]>): V2ProjectedObject {
  const visible = isPublic(object, viewer, grants);
  // A hidden opponent hand card is represented in the protocol's facedown
  // zone. Keeping it in `hand` with public visibility would expose a
  // hand-zone object even though its identity is redacted.
  const zone = !visible && (object.faceDown || object.zone === "hand") ? "facedown" : v2Zone(object.zone);
  const hidden = !visible || zone === "deck" || zone === "rune-deck";
  const value: Record<string, unknown> = {
    objectId: hidden ? hiddenId(viewer, object) : object.ref.id,
    zoneEntryId: object.ref.zoneEntryId,
    zone,
    ownerPlayerId: object.owner,
    ...(object.controller !== object.owner ? { controllerPlayerId: object.controller } : {}),
    faceDown: hidden || object.faceDown,
    visibility: object.owner === viewer && visible ? "owner-only" : "public",
  };
  if (object.location?.type === "base") value.location = { kind: "base", playerId: object.location.player };
  if (object.location?.type === "battlefield") value.location = { kind: "battlefield", battlefieldId: object.location.id };
  if (!hidden) {
    if (object.cardId !== null) value.cardId = object.cardId;
    value.name = object.name;
    value.exhausted = object.exhausted;
    value.damage = object.damage;
    if (object.might !== null) value.might = object.might;
    // Protocol v2 has one generic counter map rather than dedicated Buff and
    // Empowered fields. Preserve the authoritative carriers under distinct
    // keys; never infer Empowered from the ordinary Buff count. The runtime
    // host emits both compatibility spellings from empoweredState().
    const empowered = readEmpowered(object);
    const ordinaryCounters = (object as ObjectSnapshot & {
      readonly counters?: Readonly<Record<string, number>>;
    }).counters ?? {};
    value.counters = {
      ...ordinaryCounters,
      buffs: object.buffs,
      empowered,
      empoweredCount: empowered,
    };
  }
  return value as unknown as V2ProjectedObject;
}

function eventProjection(match: Match, stateVersion: number): readonly V2Event[] {
  return match.events().map((event, index) => ({
    contract: "riftbound.protocol.v2.event",
    seq: event.eventId ?? index + 1,
    eventSeq: event.eventId ?? index + 1,
    stateVersion,
    timingPoint: event.timingPoint,
    audience: { visibility: "public" },
    payload: {
      reason: { visibility: "public", value: event.kind ?? event.timingPoint },
      ...(event.player === undefined ? {} : { playerId: { visibility: "public", value: event.player } }),
    },
  })) as readonly V2Event[];
}

export function projectRuntime(
  match: Match,
  host: EngineRuntimeHost,
  matchId: string,
  viewer: string | null,
  stateVersion: number,
  pendingChoice: { readonly choiceId: string; readonly ownerPlayerId: string; readonly stateVersion: number; readonly kind: "optional" | "mode" | "select-objects" | "order" | "number"; readonly options?: readonly { readonly id: string; readonly label: string; readonly value?: string | number | boolean }[]; readonly min?: number; readonly max?: number } | null,
): V2Projection {
  if (viewer !== null && !Object.hasOwn(host.playerNames(), viewer)) throw new Error(`Unknown projection viewer: ${viewer}`);
  const players = Object.keys(host.playerNames()).map(playerId => {
    const player = host.player(playerId);
    return {
      playerId, name: host.playerNames()[playerId]!, score: player.score, energy: player.energy,
      power: Object.fromEntries(player.power.map(domain => [domain, (player.power.filter(value => value === domain).length)])),
      xp: player.xp, handCount: player.handCount, deckCount: player.deckCount, runeDeckCount: player.runeDeckCount,
      zoneCounts: Object.fromEntries(zoneNames.map(zone => [zone, host.objects().filter(object => object.owner === playerId && v2Zone(object.zone) === zone).length])),
    };
  });
  const objects = host.objects().map(object => projectedObject(object, viewer, host.visibility()));
  const zones = players.flatMap(player => zoneNames.map(zone => {
    const sourceZone = zone === "trash" ? "trash" : zone === "rune-zone" ? "rune-zone" : zone as never;
    const visibleObjects = objects.filter(object => object.ownerPlayerId === player.playerId && object.zone === zone);
    const count = zone === "facedown" ? host.objects().filter(object => object.owner === player.playerId && object.faceDown).length : host.zoneObjects(player.playerId, sourceZone).length;
    const canList = zone !== "deck" && zone !== "rune-deck" && zone !== "facedown" && (zone !== "hand" || viewer === player.playerId);
    return { zone, ownerPlayerId: player.playerId, count, ...(canList ? { objects: visibleObjects } : {}) };
  }));
  const chain = match.flow.chain.items;
  const chainSnapshot: V2ChainSnapshot = {
    status: chain.length ? "open" : "closed", phase: chain.length ? "resolve" : "open",
    priorityPlayerId: match.flow.chain.priority, focusPlayerId: match.flow.chain.focus,
    items: chain.map(item => ({ itemId: item.id, controllerPlayerId: item.controller, status: item.status === "finalized" ? "finalized" : "pending", kind: item.kind, sourceObjectId: item.source.ref.id, sourceVisibility: "public" as const })),
  };
  const battlefields = match.flow.battlefields;
  const scoring = {
    victoryScore: match.flow.victoryScore,
    battlefieldLocationIds: battlefields.map(field => field.id),
    players: players.map(player => ({ playerId: player.playerId, points: player.score, controlledBattlefieldIds: battlefields.filter(field => field.controller === player.playerId).map(field => field.id), scoredBattlefieldLocationIds: match.flow.scored(player.playerId) })),
  };
  const projectedChoice = pendingChoice ? {
    status: "pending" as const,
    choiceId: pendingChoice.choiceId,
    ownerPlayerId: pendingChoice.ownerPlayerId,
    stateVersion: pendingChoice.stateVersion,
    kind: pendingChoice.kind,
    ...(viewer === pendingChoice.ownerPlayerId && pendingChoice.options !== undefined ? { options: pendingChoice.options } : {}),
    ...(pendingChoice.min === undefined ? {} : { min: pendingChoice.min }),
    ...(pendingChoice.max === undefined ? {} : { max: pendingChoice.max }),
  } : { status: "none" as const };
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId,
    viewerPlayerId: viewer,
    stateVersion,
    eventSeq: match.events().length,
    phase: phase(match),
    turnNumber: Math.max(1, match.flow.turn),
    activePlayerId: match.flow.turnPlayer,
    players,
    zones,
    objects,
    chain: chainSnapshot,
    priority: { playerId: match.flow.chain.priority, focusPlayerId: match.flow.chain.focus, window: chain.length ? "choice" : "open" },
    scoring,
    pendingChoice: projectedChoice,
    winnerPlayerId: match.result().winner,
    events: eventProjection(match, stateVersion),
  } as V2Projection;
}

export function projectionDigest(projection: V2Projection): string {
  return digest(projection);
}

export type RuntimeV2Command = V2Command;
