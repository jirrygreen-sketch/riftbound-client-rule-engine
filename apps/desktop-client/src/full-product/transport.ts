import {
  FOUNDATION_RULESET_ID,
  type CommandTarget,
  type GameProjection,
  type PlayerCommand,
  type PlayerProjection,
  type ProjectionObject
} from "@riftbound/protocol";
import { authoritativeActionOptions, buildSubmissionFromSelection } from "./commands";
import type {
  ActionSelection,
  FullProductConnectionStatus,
  PlayableMatchView,
  TargetOption
} from "./types";
import type { GameClientStatus } from "../net/GameClient";

export type PlayableResolver = (
  cardId: string
) => { readonly title: string; readonly imageUrl?: string | null } | null;

export interface PlayableTransportInput {
  readonly projection: GameProjection;
  readonly viewerPlayerId: string;
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  readonly resolveCard: PlayableResolver;
  readonly targets?: Readonly<Record<string, readonly TargetOption[]>>;
  readonly targetRequirements?: Readonly<Record<string, readonly string[]>>;
  readonly promptOptionStates?: PlayableMatchView["promptOptionStates"];
}

export interface ResumeCursor {
  readonly afterEventSeq: number;
  readonly afterRoomEventSeq: number;
}

const PRIVATE_OBJECT_ZONES: ReadonlySet<string> = new Set([
  "hand",
  "deck",
  "rune-deck"
]);

export function isFullProductRuleset(rulesetId: string | undefined): boolean {
  return rulesetId === FOUNDATION_RULESET_ID;
}

export function toPlayableConnectionStatus(
  status: GameClientStatus,
  handshakeReady: boolean
): FullProductConnectionStatus {
  if (status === "connected") return handshakeReady ? "connected" : "connecting";
  if (status === "reconnecting") return "reconnecting";
  if (status === "connecting") return "connecting";
  return "disconnected";
}

export function buildPlayableMatchView(
  input: PlayableTransportInput
): PlayableMatchView | null {
  if (!isFullProductRuleset(input.projection.rulesetId)) return null;
  if (!input.projection.players.some(player => player.id === input.viewerPlayerId)) {
    return null;
  }

  const projection = sanitizeProjectionForViewer(
    input.projection,
    input.viewerPlayerId
  );
  return {
    projection,
    viewerPlayerId: input.viewerPlayerId,
    connectionStatus: input.connectionStatus,
    commandPending: input.commandPending,
    resolveCardTitle: cardId => input.resolveCard(cardId)?.title ?? cardId,
    resolveCardImage: cardId => input.resolveCard(cardId)?.imageUrl ?? null,
    targets: sanitizeTargetOptions(
      input.targets,
      projection,
      input.viewerPlayerId
    ),
    targetRequirements: input.targetRequirements,
    promptOptionStates: input.promptOptionStates
  };
}

export function sanitizeProjectionForViewer(
  projection: GameProjection,
  viewerPlayerId: string
): GameProjection {
  const players = projection.players.map(player =>
    sanitizePlayerProjection(player, viewerPlayerId)
  );
  const objects = (projection.objects ?? []).filter(object =>
    isObjectVisibleToViewer(object, viewerPlayerId)
  );

  return {
    ...projection,
    players,
    objects
  };
}

export function buildPlayableCommand(
  selection: ActionSelection,
  view: PlayableMatchView
): PlayerCommand | null {
  const command = buildSubmissionFromSelection(selection, view);
  if (command === null || command.type !== "play-card") return command;

  // The authoritative path already carries the wire targets derived from the
  // server action policy. Never re-derive them from caller-supplied mappings.
  if (authoritativeActionOptions(view) !== null) return command;

  const viewer = view.projection.players.find(
    player => player.id === view.viewerPlayerId
  );
  const card = viewer?.hand.find(
    candidate => candidate.instanceId === selection.cardId
  );
  const requirements =
    card === undefined ? [] : view.targetRequirements?.[card.cardId] ?? [];
  if (requirements.length === 0) {
    return { ...command, targets: undefined };
  }

  const targets = buildCommandTargets(selection, view);
  return targets === null ? null : { ...command, targets };
}

export function buildCommandTargets(
  selection: Pick<ActionSelection, "cardId" | "targetIds">,
  view: PlayableMatchView
): readonly CommandTarget[] | null {
  const viewer = view.projection.players.find(
    player => player.id === view.viewerPlayerId
  );
  const card = viewer?.hand.find(
    candidate => candidate.instanceId === selection.cardId
  );
  if (card === undefined) return null;

  const options = view.targets?.[card.cardId] ?? [];
  const optionById = new Map(options.map(option => [option.id, option]));
  const targets: CommandTarget[] = [];
  for (const targetId of selection.targetIds) {
    const option = optionById.get(targetId);
    if (option === undefined || option.disabled === true) return null;
    if (option.objectId !== undefined) {
      targets.push({ kind: "object", objectId: option.objectId });
    } else if (option.playerId !== undefined) {
      targets.push({ kind: "player", playerId: option.playerId });
    } else {
      return null;
    }
  }
  return targets;
}

export function acceptConfirmedProjection(
  current: GameProjection | null,
  incoming: GameProjection | null
): GameProjection | null {
  if (incoming === null) return null;
  if (current === null) return incoming;
  if (incoming.version < current.version) return current;
  if (incoming.version === current.version && incoming.eventSeq < current.eventSeq) {
    return current;
  }
  return incoming;
}

export function buildResumeCursor(options: {
  readonly eventSeq?: number | null;
  readonly roomEventSeq?: number | null;
}): ResumeCursor {
  return {
    afterEventSeq: Math.max(0, options.eventSeq ?? 0),
    afterRoomEventSeq: Math.max(0, options.roomEventSeq ?? 0)
  };
}

export function advanceResumeCursor(
  current: ResumeCursor,
  incoming: ResumeCursor
): ResumeCursor {
  return {
    afterEventSeq: Math.max(current.afterEventSeq, incoming.afterEventSeq),
    afterRoomEventSeq: Math.max(
      current.afterRoomEventSeq,
      incoming.afterRoomEventSeq
    )
  };
}

function sanitizePlayerProjection(
  player: PlayerProjection,
  viewerPlayerId: string
): PlayerProjection {
  if (player.id === viewerPlayerId) {
    return {
      ...player,
      playableInstanceIds:
        player.playableInstanceIds === undefined
          ? undefined
          : [...player.playableInstanceIds]
    };
  }

  return {
    ...player,
    hand: [],
    playableInstanceIds: []
  };
}

function isObjectVisibleToViewer(
  object: ProjectionObject,
  viewerPlayerId: string
): boolean {
  if (!PRIVATE_OBJECT_ZONES.has(object.zone)) return true;
  return object.zone === "hand" && object.ownerPlayerId === viewerPlayerId;
}

function sanitizeTargetOptions(
  targets: Readonly<Record<string, readonly TargetOption[]>> | undefined,
  projection: GameProjection,
  viewerPlayerId: string
): Readonly<Record<string, readonly TargetOption[]>> | undefined {
  if (targets === undefined) return undefined;

  const visibleObjectIds = new Set(
    (projection.objects ?? [])
      .filter(object => isObjectVisibleToViewer(object, viewerPlayerId))
      .map(object => object.objectId)
  );
  const playerIds = new Set(projection.players.map(player => player.id));
  const result: Record<string, readonly TargetOption[]> = {};
  for (const [cardId, options] of Object.entries(targets)) {
    const sanitized = options.filter(option =>
      option.objectId !== undefined
        ? visibleObjectIds.has(option.objectId)
        : option.playerId !== undefined
          ? playerIds.has(option.playerId)
          : false
    );
    if (sanitized.length > 0) result[cardId] = sanitized;
  }
  return result;
}
