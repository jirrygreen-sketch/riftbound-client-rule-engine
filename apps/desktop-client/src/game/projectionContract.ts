import {
  PROJECTION_SCHEMA_V1 as WIRE_PROJECTION_SCHEMA_V1,
  isProjectionObject as isWireProjectionObject,
  type CardInstance,
  type GameProjection,
  type PlayerProjection,
  type ProjectionObject,
  type ProjectionZone,
  type Prompt
} from "@riftbound/protocol";

export const PROJECTION_SCHEMA_V1 = WIRE_PROJECTION_SCHEMA_V1;

export const PROJECTION_ZONES: readonly ProjectionZone[] = [
  "base",
  "board",
  "battlefield",
  "champion",
  "legend",
  "rune",
  "hand",
  "deck",
  "rune-deck",
  "discard",
  "banish",
  "chain"
];

export interface LegacyHandObject extends ProjectionObject {
  readonly instanceId: string;
}

export type ProjectionPlayer = PlayerProjection;

export interface ProjectedGameView {
  readonly schemaVersion: string | null;
  readonly rulesetId: string | null;
  readonly isLegacy: boolean;
  readonly turnNumber: number | null;
  readonly activePlayerId: string | null;
  readonly priorityPlayerId: string | null;
  readonly phase: string | null;
  readonly prompt: Prompt | null;
  readonly players: readonly ProjectionPlayer[];
  readonly objects: readonly ProjectionObject[];
}

export interface ProjectedPlayerView {
  readonly playerId: string;
  readonly displayName: string;
  readonly score: number | null;
  readonly energy: number | null;
  readonly power: Readonly<Record<string, number>> | null;
  readonly zoneCounts: Readonly<Partial<Record<ProjectionZone, number>>> | null;
  readonly playableInstanceIds: readonly string[] | null;
  readonly runes: readonly ProjectionObject[];
  readonly zones: readonly ProjectionObject[];
  readonly isLegacy: boolean;
  readonly life: number | null;
  readonly mana: number | null;
  readonly hand: readonly CardInstance[];
  readonly handCount: number | null;
}

export interface ProjectedZoneView {
  readonly zone: ProjectionZone | null;
  readonly label: string;
  readonly objects: readonly ProjectionObject[];
  readonly count: number | null;
  readonly state: "ready" | "awaiting-projection";
}

export interface BoardCardInfo {
  readonly title: string;
  readonly imageUrl: string | null;
  readonly typeLabel: string | null;
  readonly implemented: boolean;
}

export interface ActionState {
  readonly connected: boolean;
  readonly canRespondPrompt: boolean;
  readonly canPass: boolean;
  readonly canPlay: boolean;
  readonly blockedReason: string | null;
}

const ZONE_LABELS: Readonly<Record<ProjectionZone, string>> = {
  base: "基地",
  board: "战场",
  battlefield: "战场",
  champion: "英雄",
  legend: "传奇",
  rune: "符文",
  hand: "手牌",
  deck: "牌库",
  "rune-deck": "符文库",
  discard: "弃牌",
  banish: "放逐",
  chain: "结算链"
};

/**
 * Builds the UI view from an agreed wire superset while retaining compatibility
 * with the current synthetic projection. No unsupported zone is invented here.
 */
export function buildProjectedGameView(
  projection: GameProjection | null
): ProjectedGameView {
  if (!projection) {
    return {
      schemaVersion: null,
      rulesetId: null,
      isLegacy: true,
      turnNumber: null,
      activePlayerId: null,
      priorityPlayerId: null,
      phase: null,
      prompt: null,
      players: [],
      objects: []
    };
  }

  const schemaVersion = projection.projectionSchema ?? null;
  const isLegacy = schemaVersion !== PROJECTION_SCHEMA_V1;
  const priorityPlayerId = projection.priority?.playerId ?? null;

  const players: readonly ProjectionPlayer[] = projection.players.map(player => ({
    ...player,
    score: player.score,
    energy: player.energy,
    power: player.power,
    zoneCounts: player.zoneCounts,
    playableInstanceIds: player.playableInstanceIds,
    life: player.life,
    mana: player.mana,
    hand: player.hand,
    handCount: player.handCount
  }));

  const objects = projection.objects?.filter(isProjectionObject) ?? [];

  return {
    schemaVersion,
    rulesetId: projection.rulesetId ?? null,
    isLegacy,
    turnNumber: projection.turnNumber,
    activePlayerId: projection.activePlayerId,
    priorityPlayerId,
    phase: projection.phase,
    prompt: projection.prompt,
    players,
    objects
  };
}

export function buildProjectedPlayerView(
  game: ProjectedGameView,
  playerId: string | null
): ProjectedPlayerView | null {
  const player = game.players.find(candidate => candidate.id === playerId) ?? null;
  if (!player) return null;

  const globalObjects = game.objects.filter(object => object.ownerPlayerId === playerId);
  const legacyHand = player.hand?.map(card => ({
    objectId: card.instanceId,
    cardId: card.cardId,
    zone: "hand" as const,
    controllerId: player.id,
    ownerPlayerId: player.id,
    faceUp: true,
    instanceId: card.instanceId
  })) ?? [];
  const playerObjects = game.isLegacy ? legacyHand : globalObjects;
  const declaredCounts = new Map(Object.entries(player.zoneCounts ?? {}));
  return {
    playerId: player.id,
    displayName: player.name,
    score: player.score ?? null,
    energy: player.energy ?? null,
    power: player.power ?? null,
    zoneCounts: player.zoneCounts ?? null,
    playableInstanceIds: player.playableInstanceIds ?? null,
    runes: playerObjects.filter(object => object.zone === "rune"),
    zones: playerObjects,
    isLegacy: game.isLegacy,
    life: player.life ?? null,
    mana: player.mana ?? null,
    hand: player.hand ?? [],
    handCount: player.handCount ?? null
  };
}

export function buildProjectedZones(
  player: ProjectedPlayerView | null,
  viewerPlayerId: string | null
): readonly ProjectedZoneView[] {
  if (!player) {
    return PROJECTION_ZONES.map(zone => ({
      zone,
      label: ZONE_LABELS[zone],
      objects: [],
      count: null,
      state: "awaiting-projection" as const
    }));
  }

  const isSelf = viewerPlayerId === player.playerId;
  const declaredCounts = new Map(Object.entries(player.zoneCounts ?? {}));
  const objectZones = player.zones.map(object => object.zone);
  const knownZones = PROJECTION_ZONES.filter(
    zone => objectZones.includes(zone) || player.zoneCounts?.[zone] !== undefined
  );
  const zoneViews = knownZones.map(zone => {
    const objects = player.zones.filter(object => object.zone === zone);
    const declaredCount = declaredCounts.get(zone);
    const known = !player.isLegacy || zone === "hand";
    return {
      zone,
      label: ZONE_LABELS[zone],
      objects: isSelf || objectIsPublic(zone) ? objects : [],
      count: declaredCount ?? (known ? objects.length : null),
      state: known ? "ready" as const : "awaiting-projection" as const
    };
  });
  if (player.isLegacy) return zoneViews;

  // Preserve server-declared counts for hidden stack zones even when objects
  // are omitted by privacy rules.
  const stackZones = ["deck", "rune-deck", "discard", "banish"] as const;
  return [...zoneViews, ...stackZones
    .filter(zone => !knownZones.includes(zone) && declaredCounts.has(zone))
    .map(zone => ({
      zone,
      label: ZONE_LABELS[zone],
      objects: [] as ProjectionObject[],
      count: declaredCounts.get(zone) ?? 0,
      state: "ready" as const
    }))];
}

function objectIsPublic(zone: ProjectionZone): boolean {
  return zone !== "hand" && zone !== "deck" && zone !== "rune-deck";
}

function isProjectionObject(value: unknown): value is ProjectionObject {
  return isWireProjectionObject(value);
}

export function isProjectionZone(value: unknown): value is ProjectionZone {
  return (
    typeof value === "string" &&
    (PROJECTION_ZONES as readonly string[]).includes(value)
  );
}

export function isPromptForViewer(
  prompt: Prompt | null,
  viewerPlayerId: string | null
): boolean {
  return prompt !== null && viewerPlayerId !== null && prompt.playerId === viewerPlayerId;
}

export function getActionState({
  connected,
  commandPending,
  projection,
  viewerPlayerId,
  selectedCard
}: {
  connected: boolean;
  commandPending: boolean;
  projection: GameProjection | null;
  viewerPlayerId: string | null;
  selectedCard: CardInstance | null;
}): ActionState {
  if (!connected) {
    return disabled("尚未连接游戏服务端", false);
  }
  if (!projection || projection.players.length < 2) {
    return disabled("等待对局投影", true);
  }

  const self = projection.players.find(player => player.id === viewerPlayerId) ?? null;
  if (!self) return disabled("当前玩家不在对局中", true);
  if (commandPending) return disabled("操作确认中", true);
  if (projection.phase === "ended") return disabled("对局已结束", true);

  if (isPromptForViewer(projection.prompt, viewerPlayerId)) {
    return { ...disabled("请先响应 Prompt", true), canRespondPrompt: true };
  }
  if (projection.prompt !== null) {
    return disabled("等待对手响应 Prompt", true);
  }
  if (projection.activePlayerId !== viewerPlayerId) {
    return disabled("尚未轮到你的回合", true);
  }

  const serverPlayable =
    selectedCard !== null &&
    self.playableInstanceIds !== undefined &&
    self.playableInstanceIds.includes(selectedCard.instanceId);

  const playable = serverPlayable;

  return {
    connected,
    canRespondPrompt: false,
    canPass: true,
    canPlay: playable,
    blockedReason: playable
      ? null
      : selectedCard === null
        ? "请选择要打出的手牌"
        : self.playableInstanceIds === undefined
          ? "等待服务端可操作列表"
          : "服务端标记该牌当前不可打出"
  };
}

function disabled(blockedReason: string, connected: boolean): ActionState {
  return {
    connected,
    canRespondPrompt: false,
    canPass: false,
    canPlay: false,
    blockedReason
  };
}
