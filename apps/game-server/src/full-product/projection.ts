import type { PlayerId } from "@riftbound/protocol";
import type {
  FullProductRuntimeEvent,
  FullProductRuntimeProjection,
  FullProductRuntimeProjectionObject,
  FullProductSanitizedProjection
} from "./runtime.js";

const HIDDEN_OBJECT_ZONES = new Set(["hand", "deck", "rune-deck"]);

export function sanitizeProjection(
  projection: FullProductRuntimeProjection,
  viewerPlayerId: PlayerId | null
): FullProductSanitizedProjection {
  const viewerId = viewerPlayerId;
  const players = projection.players.map(player => {
    const isViewer = viewerId !== null && player.id === viewerId;
    return {
      id: player.id,
      name: player.name,
      score: player.score,
      energy: player.energy,
      power: { ...player.power },
      zoneCounts: { ...player.zoneCounts },
      handCount: player.handCount,
      hand: isViewer ? player.hand.map(card => ({ ...card })) : [],
      playableInstanceIds: isViewer ? [...player.playableInstanceIds] : null
    };
  });

  const objects = projection.objects
    .filter(object =>
      (object.visibility === "public" &&
        !HIDDEN_OBJECT_ZONES.has(object.zone)) ||
      (viewerId !== null &&
        object.visibility === "private" &&
        object.zone === "hand" &&
        object.ownerPlayerId === viewerId)
    )
      .map(copyPublicObject)
      .filter(object =>
        object.zone === "hand"
          ? viewerId !== null && object.ownerPlayerId === viewerId
          : true
      );

  const prompt = viewerId !== null &&
    projection.prompt !== null &&
    projection.prompt.ownerPlayerId === viewerId
      ? {
          ...projection.prompt,
          options: projection.prompt.options.map(option => ({ ...option }))
        }
      : null;

  return {
    projectionContract: projection.projectionContract,
    protocolVersion: projection.protocolVersion,
    rulesetId: projection.rulesetId,
    viewerPlayerId,
    version: projection.summary.version,
    eventSeq: projection.summary.eventSeq,
    phase: projection.summary.phase,
    turnNumber: projection.summary.turnNumber,
    activePlayerId: projection.summary.activePlayerId,
    priorityPlayerId: projection.summary.priorityPlayerId,
    winnerPlayerId: projection.summary.winnerPlayerId,
    waitingForPlayerId: projection.summary.waitingForPlayerId,
    prompt,
    players,
    objects,
    events: projection.events
      .map(event => sanitizeEvent(event, viewerId))
      .filter(event => event !== null)
  };
}

function copyPublicObject(
  object: FullProductRuntimeProjectionObject
): FullProductRuntimeProjectionObject {
  return {
    objectId: object.objectId,
    cardId: object.cardId,
    zone: object.zone,
    controllerId: object.controllerId,
    ownerPlayerId: object.ownerPlayerId,
    faceUp: object.faceUp,
    visibility: object.visibility,
    ...(object.damage === undefined ? {} : { damage: object.damage })
  };
}

function sanitizeEvent(
  event: FullProductRuntimeEvent,
  viewerPlayerId: PlayerId | null
): FullProductRuntimeEvent | null {
  switch (event.type) {
    case "game-started":
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "playerIds",
        "rulesetId"
      ]);
    case "turn-started":
    case "priority-passed":
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "playerId"
      ]);
    case "card-played":
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "playerId",
        "instanceId",
        "cardId",
        "targets"
      ]);
    case "prompt-created":
      if (event.ownerPlayerId !== viewerPlayerId) {
        return privateEventMarker(event);
      }
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "promptId",
        "ownerPlayerId",
        "stateVersion",
        "optional",
        "targetPolicy"
      ]);
    case "prompt-answered":
      if (event.playerId !== viewerPlayerId) {
        return privateEventMarker(event);
      }
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "promptId",
        "playerId",
        "optionId",
        "targets"
      ]);
    case "game-ended":
      return copyEvent(event, [
        "seq",
        "turnNumber",
        "activePlayerId",
        "priorityPlayerId",
        "type",
        "eventContract",
        "winnerPlayerId"
      ]);
    default:
      return null;
  }
}

function privateEventMarker(
  event: FullProductRuntimeEvent
): FullProductRuntimeEvent {
  return {
    eventContract: event.eventContract,
    type: "priority-passed",
    seq: event.seq,
    turnNumber: event.turnNumber,
    activePlayerId: event.activePlayerId,
    priorityPlayerId: event.priorityPlayerId,
    playerId: event.priorityPlayerId
  };
}

function copyEvent(
  event: FullProductRuntimeEvent,
  keys: readonly string[]
): FullProductRuntimeEvent | null {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(event, key)) return null;
    result[key] = event[key];
  }
  return result as FullProductRuntimeEvent;
}
