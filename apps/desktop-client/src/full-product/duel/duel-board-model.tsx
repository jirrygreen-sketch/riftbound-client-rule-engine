import { createContext, useContext } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, SyntheticEvent } from "react";
import type {
  DuelCommandMessageV3Actions1,
  DuelProjectionTransport,
  DuelWireAction,
  DuelWireCommandV3Actions1,
  DuelWireDomain,
  DuelWireFrame,
  DuelWireLegendReadiness,
  DuelWireRunePool,
  DuelWireUnit
} from "@riftbound/protocol";
import { DUEL_POWER_DOMAINS } from "@riftbound/protocol";
import type { FullProductConnectionStatus } from "../types";
import type { DuelCardSurfaceZone } from "../interactions/duel-card-interaction";
import type { ResourceActionView, ResourcePaymentSummaryView, ResourcePowerView, ResourcePoolStatus } from "../components/ResourcePoolPanel";

export const DUEL_MATCH_BOARD_LABEL = "对局桌面";
export const DUEL_HAND_CARD_WIDTH_PX = 160;

/**
 * Card-face orientation, straight from the real local assets: legend/champion/
 * unit/rune/hand are portrait, a battlefield card is landscape. The role only
 * selects the sizing rule (`contain` + the asset's real ratio); it never changes
 * a value, an action or a zone.
 */
export const DUEL_CARD_ROLE_PORTRAIT = "portrait";
export const DUEL_CARD_ROLE_LANDSCAPE = "landscape";
export type DuelCardRole = typeof DUEL_CARD_ROLE_PORTRAIT | typeof DUEL_CARD_ROLE_LANDSCAPE;

export const DUEL_NO_CHAMPION_LABEL = "英雄不存在";
export const DUEL_CONTROLLED_BY_NOBODY = "无人控制";
export const DUEL_CONTESTED_LABEL = "争夺中";
export const DUEL_READY_LABEL = "就绪";
export const DUEL_TAPPED_LABEL = "横置";
export const DUEL_DAMAGE_LABEL = "伤害";
export const DUEL_BASE_MIGHT_LABEL = "基础战力";
export const DUEL_GOLD_UNIVERSAL_TAG = "通用符能";
export const DUEL_ANY_POWER_LABEL = "任意";

export const DUEL_WAITING_TURN_START_NOTICE = "等待回合开始";
export const DUEL_NO_ACTIONS_NOTICE = "当前没有可用操作";
export const DUEL_UNKNOWN_ACTION_REASON = "未知操作类型，暂不支持";
export const DUEL_MULLIGAN_OWNER_HINT = "轮到你调度：选择 0–2 张手牌后确认";
export const DUEL_MULLIGAN_WAIT_HINT = "等待对手调度";
export const DUEL_SETUP_COMPLETE_HINT = "调度完成，等待开局";
export const DUEL_SPECTATOR_RESOURCE_NOTICE = "旁观视角：资源只读";
export const DUEL_SPECTATOR_HAND_NOTICE = "旁观视角：看不到玩家手牌";

/** Playing-base content labels (all Chinese; no implementation vocabulary). */
export const DUEL_BASE_RUNE_LABEL = "基地符文";
export const DUEL_NO_BASE_RUNE_NOTICE = "暂无公开符文";
export const DUEL_GOLD_LABEL = "金币";
export const DUEL_MAIN_DECK_LABEL = "主牌堆";
export const DUEL_RUNE_DECK_LABEL = "符文库";
export const DUEL_TRASH_LABEL = "弃牌";
export const DUEL_CHAIN_LABEL = "公开施放链";
export const DUEL_LEGEND_ROLE_LABEL = "传说";
export const DUEL_CHAMPION_ROLE_LABEL = "英雄";

/**
 * V3 public permanent labels. The Legend exposes only its server-projected
 * controller and one of three readiness states; no uid, owner, epoch or
 * provenance ever reaches the DOM. Gears expose location, controller,
 * ready/exhausted and their wire attachment host, nothing more.
 */
export const DUEL_LEGEND_CONTROLLER_LABEL = "控制者";
export const DUEL_LEGEND_READINESS_LABELS: Readonly<Record<DuelWireLegendReadiness, string>> = {
  "not-established": "未建立",
  ready: DUEL_READY_LABEL,
  exhausted: "已横置"
};
export const DUEL_GEAR_SECTION_LABEL = "装备";
export const DUEL_GEAR_ATTACH_LABEL = "附着于";
export const DUEL_GEAR_UNATTACHED_LABEL = "独立";
export const DUEL_GEAR_ATTACH_UNKNOWN_LABEL = "未知目标";

/** Score rail labels. */
export const DUEL_SCORE_TRACK_LABEL = "计分轨";
export const DUEL_SCORE_VICTORY_ARIA = "胜利分";
export const DUEL_SCORE_OVERFLOW_LABEL = "超出目标分";
/**
 * Defensive bound for the rail's tick list. The real Duel victory target is `8`
 * (9 ticks: 0…8); this cap only stops a malformed projection from rendering an
 * unbounded list. It never changes a displayed point value.
 */
export const DUEL_SCORE_TRACK_MAX_TICKS = 100;

/** Card-image preview labels. */
export const DUEL_PREVIEW_LABEL = "卡牌大图预览";
export const DUEL_PREVIEW_CLOSE_LABEL = "关闭大图";
export const DUEL_PREVIEW_CLOSE_TEXT = "关闭";
export const DUEL_PREVIEW_NO_IMAGE_NOTICE = "该卡暂无本地图片";
export const DUEL_INSPECT_TRIGGER_PREFIX = "查看大图：";

export const DUEL_DOMAIN_LABELS: Readonly<Record<DuelWireDomain, string>> = {
  Fury: "炽烈",
  Calm: "翠意",
  Mind: "灵光",
  Body: "摧破",
  Chaos: "混沌",
  Order: "序理"
};

export const DUEL_PHASE_LABELS: Readonly<Record<DuelWireFrame["phase"], string>> = {
  "awaiting-turn-start": "等待回合开始",
  awaken: "觉醒",
  beginning: "开始",
  scoring: "计分",
  channel: "引导",
  draw: "抽牌",
  main: "主阶段",
  ending: "结束",
  expiration: "失效",
  ended: "已结束"
};

export interface DuelMatchBoardProps {
  readonly projection: DuelProjectionTransport;
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  readonly onCommand: (command: DuelWireCommandV3Actions1) => void;
  readonly onActionPacket?: (packet: DuelCommandMessageV3Actions1) => boolean | void;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly resolveCardDomains?: (cardId: string) => readonly string[];
  readonly activityLog?: ReactNode;
  readonly chat?: ReactNode;
  readonly controls?: ReactNode;
  readonly readOnly?: boolean;
}
export interface DuelCardInteractionContextValue {
  readonly viewerPlayerId: string | null;
  readonly sceneKey: string;
  readonly canInteract: boolean;
  readonly isCardActionable: (cardUID: string) => boolean;
  readonly onCardClick: (
    event: SyntheticEvent<HTMLElement>,
    cardUID: string,
    cardId: string | null,
    sourceZone: DuelCardSurfaceZone
  ) => void;
  readonly onCardPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    cardUID: string,
    sourceZone: DuelCardSurfaceZone
  ) => void;
  readonly onCardPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onCardPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onCardPointerCancel: () => void;
  readonly dropTargetState: (kind: "base" | "battlefield", locationId: string) => string | undefined;
}

export const DuelCardInteractionContext = createContext<DuelCardInteractionContextValue | null>(null);

export function useDuelCardInteraction(): DuelCardInteractionContextValue | null {
  return useContext(DuelCardInteractionContext);
}

export function cardEventIsInspect(event: SyntheticEvent<HTMLElement>): boolean {
  const target = event.target;
  return target instanceof HTMLElement && target.closest('[data-card-inspect-only="true"]') !== null;
}

/** The interaction gate. Authority is the wire/connection context, not local UI. */
export interface DuelInteractionState {
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  readonly ended: boolean;
}

/**
 * The read-only reason shared by every control, or `null` when the surface is
 * interactive. Any non-connected status, a pending command or a finished match
 * makes the whole board read-only. This gate applies to *commands only*: it
 * never blocks the read-only card preview.
 */
export function duelInteractionLockedReason(state: DuelInteractionState): string | null {
  if (state.ended) return "对局已结束，界面只读";
  switch (state.connectionStatus) {
    case "disconnected":
      return "连接已断开，界面只读";
    case "reconnecting":
      return "正在重连，界面只读";
    case "connecting":
      return "正在连接，界面只读";
    case "connected":
      break;
  }
  if (state.commandPending) return "指令处理中，界面只读";
  return null;
}

/** Map the client connection union onto the resource panel's display status. */
export function resourcePoolStatusFor(status: FullProductConnectionStatus): ResourcePoolStatus {
  switch (status) {
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "disconnected":
      return "disconnected";
    case "connecting":
      return "waiting";
  }
}

/** Six domains + universal power, straight from the wire pool. */
export function duelPowerViews(pool: DuelWireRunePool, domains: readonly DuelWireDomain[] = DUEL_POWER_DOMAINS): readonly ResourcePowerView[] {
  const powers: ResourcePowerView[] = domains.map(domain => ({
    id: domain,
    label: DUEL_DOMAIN_LABELS[domain],
    amount: pool.power[domain]
  }));
  powers.push({ id: "any", label: DUEL_ANY_POWER_LABEL, amount: pool.power.any });
  return powers;
}

/** Display identity comes from the stamped public Legend printing, never rune counts. */
export function duelLegendPowerDomains(domains: readonly string[]): readonly DuelWireDomain[] {
  return [...new Set(domains)].filter((domain): domain is DuelWireDomain =>
    DUEL_POWER_DOMAINS.some(known => known === domain));
}

/**
 * The reset key for the temporary animation/selection/preview state. A new
 * projection with a different match id, schema version, state version, event
 * sequence, viewer or stage clears any pending selection or preview so a stale
 * pick can never leak into the next frame — including two frames that share a
 * state version but differ only by event sequence, or by schema version.
 */
export function mulliganResetKey(projection: DuelProjectionTransport): string {
  const { match } = projection;
  return [
    match.matchId,
    String(match.schemaVersion),
    String(match.stateVersion),
    String(match.eventSeq),
    projection.viewerPlayerId ?? "spectator",
    match.stage
  ].join("|");
}

/** Add/remove a uid, never exceeding the server-supplied selection cap. */
export function toggleMulliganSelection(
  current: readonly string[],
  uid: string,
  maxSelections: number
): readonly string[] {
  if (current.includes(uid)) return current.filter(id => id !== uid);
  if (current.length >= maxSelections) return current;
  return [...current, uid];
}

/**
 * Build the one wire command a supplied action maps to, or `null` for an
 * unknown kind. No other command type is ever constructed, and the caller's
 * selection is passed through untouched (an empty mulligan selection is legal).
 * The read-only card preview never reaches this function.
 */
export function buildDuelWireCommand(
  action: DuelWireAction,
  selectedUIDs: readonly string[] = []
): DuelWireCommandV3Actions1 | null {
  switch (action.kind) {
    case "mulligan":
      return { type: "mulligan", selectedUIDs };
    case "rune-energy":
    case "rune-power":
    case "gold-power":
      return { type: action.kind, uid: action.uid };
    case "pay-pending":
      // No plan by default: the authoritative core allocates. A cost summary is
      // only ever shown from action.resolvedCost, never invented.
      return { type: "pay-pending", paymentId: action.paymentId };
    default:
      return null;
  }
}

export interface DuelSides {
  readonly bottomSeatId: string;
  readonly topSeatId: string;
  /** True when the viewer owns one of the two seats. */
  readonly viewerSeated: boolean;
}

/**
 * Place the two seats. A seated viewer's own base is the bottom band and the
 * opponent is on top; a spectator (or mismatched viewer) falls back to the
 * stable roster seat order and is never labelled as owning a side.
 */
export function resolveDuelSides(projection: DuelProjectionTransport): DuelSides {
  const [first, second] = projection.match.roster.map(person => person.playerId) as [
    string,
    string
  ];
  const viewer = projection.viewerPlayerId;
  if (viewer === first || viewer === second) {
    return {
      bottomSeatId: viewer,
      topSeatId: viewer === first ? second : first,
      viewerSeated: true
    };
  }
  return { bottomSeatId: first, topSeatId: second, viewerSeated: false };
}

/** Units currently sitting on one board location, in projection order. */
export function unitsAtLocation(
  units: readonly DuelWireUnit[],
  locationId: string
): readonly DuelWireUnit[] {
  return units.filter(unit => unit.locationId === locationId);
}

/** Public label for a unit: a real card title, or a token's name. */
export function unitDisplayLabel(
  unit: DuelWireUnit,
  resolveCardTitle: (cardId: string) => string
): string {
  return unit.trait.kind === "card" ? resolveCardTitle(unit.trait.cardId) : unit.trait.name;
}

/**
 * Group board units by their *current controller* only. `ownerPlayerId` is
 * never consulted, so a stolen unit shows under the player who actually
 * controls it; insertion order follows the projection.
 */
export function unitGroupsByController(
  units: readonly DuelWireUnit[]
): ReadonlyMap<string, readonly DuelWireUnit[]> {
  const groups = new Map<string, DuelWireUnit[]>();
  for (const unit of units) {
    const bucket = groups.get(unit.controllerPlayerId);
    if (bucket) bucket.push(unit);
    else groups.set(unit.controllerPlayerId, [unit]);
  }
  return groups;
}

/**
 * Order the controller groups inside one field the same way the two base bands
 * are ordered: the opposing seat's units sit above the viewer's own units
 * (opponent on top, self at the bottom). The grouping key stays
 * `unit.controllerPlayerId` and the viewer comes from {@link resolveDuelSides},
 * so both seated viewers get their own units at the bottom and a spectator keeps
 * the projection's stable seat order without ever being labelled as owning a
 * side. Controllers outside the two seats keep their projection order last.
 */
export function orderUnitGroupsForViewer(
  units: readonly DuelWireUnit[],
  sides: DuelSides
): readonly (readonly [string, readonly DuelWireUnit[]])[] {
  const entries = [...unitGroupsByController(units).entries()];
  if (!sides.viewerSeated) return entries;
  const rankOf = (controllerId: string): number => {
    if (controllerId === sides.topSeatId) return 0;
    if (controllerId === sides.bottomSeatId) return 1;
    return 2;
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: rankOf(entry[0]) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(ranked => ranked.entry);
}

/**
 * The supplied resource-source actions (runes / gold). Gold sources are
 * annotated as universal power on screen; the label itself stays server-supplied.
 */
export function resourceSourceActions(actions: readonly DuelWireAction[]): readonly ResourceActionView[] {
  const views: ResourceActionView[] = [];
  for (const action of actions) {
    if (action.kind !== "rune-energy" && action.kind !== "rune-power" && action.kind !== "gold-power") {
      continue;
    }
    views.push({
      id: action.id,
      label: action.label,
      detail: action.kind === "gold-power" ? DUEL_GOLD_UNIVERSAL_TAG : undefined,
      enabled: action.enabled,
      blockedReason: action.reason
    });
  }
  return views;
}

/** Actions rendered in the standalone right-hand panel: payment resolution. */
export function actionPanelActions(actions: readonly DuelWireAction[]): readonly DuelWireAction[] {
  return actions.filter(action => action.kind === "pay-pending");
}

/**
 * A payment summary built only from an authoritative resolved cost. Returns
 * `null` when the action carries no cost — the board never fabricates a `0`.
 */
export function paymentSummaryFor(action: DuelWireAction): ResourcePaymentSummaryView | null {
  if (action.kind !== "pay-pending" || action.resolvedCost === undefined) return null;
  const costs = action.resolvedCost.power.map(requirement => ({
    label: requirement.allowedDomains.map(domain => DUEL_DOMAIN_LABELS[domain]).join("/"),
    amount: requirement.amount
  }));
  return { label: "本次支付", energyCost: action.resolvedCost.energy, powerCosts: costs };
}

/**
 * The payment preview shown in the resource pool, or `undefined` when the
 * projection does not prove exactly one cost.
 *
 * There must be exactly one `pay-pending` action to risk a preview: with zero,
 * there is nothing to show; with several, the server has not told us which one
 * is current, so a single merged/guessed cost is never fabricated. Even with one
 * action, `paymentSummaryFor` still returns nothing when it carries no
 * `resolvedCost`, so a disabled/unknown cost is never shown as a `0`.
 */
export function resourcePoolPaymentSummary(
  actions: readonly DuelWireAction[]
): ResourcePaymentSummaryView | undefined {
  const pending = actions.filter(action => action.kind === "pay-pending");
  if (pending.length !== 1) return undefined;
  return paymentSummaryFor(pending[0]!) ?? undefined;
}

export function nameFor(projection: DuelProjectionTransport, playerId: string | null): string {
  if (playerId === null) return DUEL_CONTROLLED_BY_NOBODY;
  return (
    projection.match.roster.find(person => person.playerId === playerId)?.displayName ?? playerId
  );
}
