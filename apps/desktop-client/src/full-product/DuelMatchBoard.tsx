import { DuelWindowStatus, describeDuelWindowStatus } from './components/DuelWindowStatus';
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SyntheticEvent } from "react";
import type {
  DuelProjectionTransport,
  DuelCommandMessageV3Actions1,
  DuelActionV3Actions1,
  DuelWireAction,
  DuelWireBase,
  DuelWireBattlefield,
  DuelWireBaseRune,
  DuelWireCard,
  DuelWireCommandV3Actions1,
  DuelWireDomain,
  DuelWireFrame,
  DuelWireGearPermanent,
  DuelWireGoldToken,
  DuelWireLegendPermanent,
  DuelWireLegendReadiness,
  DuelWireMatchPlaying,
  DuelWireMatchPlayingV2,
  DuelWireMatchPlayingV3,
  DuelPublicChainCardV3Actions1,
  DuelWireMatchSetup,
  DuelWirePlayingPlayer,
  DuelWireResourceBase,
  DuelWireRunePool,
  DuelWireScoring,
  DuelWireSetupPlayer,
  DuelWireUnit
} from "@riftbound/protocol";
import type { DuelProjectionV3Actions1 } from "@riftbound/protocol";
import { DUEL_POWER_DOMAINS } from "@riftbound/protocol";
import { DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import { DuelActionsPanelV3, isLegacyAction } from "./components/DuelActionsPanelV3";
import {
  createDuelActionPacketIds,
  EMPTY_DUEL_ACTIONS_SELECTION,
  submitDuelActionSelection
} from "./components/DuelActionsPanelV3";
import type { DuelActionsSelection } from "./components/DuelActionsPanelV3";
import type { FullProductConnectionStatus } from "./types";
import { DuelTableLayout } from "./components/DuelTableLayout";
import { ResourcePoolPanel } from "./components/ResourcePoolPanel";
import type {
  ResourceActionView,
  ResourcePaymentSummaryView,
  ResourcePowerView,
  ResourcePoolStatus
} from "./components/ResourcePoolPanel";
import { DuelCardActionPopover } from "./interactions/DuelCardActionPopover";
import { duelCardActionIds, duelCardDropSelection, duelCardDropTargets } from "./interactions/duel-card-actions";
import type { DuelCardPopoverAnchor, DuelCardSurfaceZone } from "./interactions/duel-card-interaction";
import "./DuelMatchBoard.css";

/**
 * The formal Duel match surface.
 *
 * It consumes one authoritative {@link DuelProjectionTransport} and lays it out through
 * {@link DuelTableLayout}. Every displayed value — rosters, hands, board
 * occupancy, base runes, gold tokens, deck/trash counts, units, resources,
 * scoring and legal actions — comes straight from the projection. This
 * component owns no balance, phase, controller, unit, resource or deck state:
 * the only local state is a temporary mulligan selection plus a temporary,
 * read-only card-image preview, both reset whenever the projection's match id,
 * state version, viewer or stage changes.
 *
 * Commands are built only for the exact wire actions the server supplied, and
 * are forwarded verbatim; the component never derives a legal action, guesses a
 * cost, or mutates a count (a balance only ever changes on the next projection).
 *
 * The card preview is display-only: it opens from a real `<button>` wrapping a
 * resolved card image, shows nothing but the card title and image, and never
 * forwards a command, computes a cost or reads a hidden zone. It is available
 * even while the board is read-only (waiting / reconnecting), because looking at
 * an already-public card is not an action.
 *
 * SharedBattlefields is deliberately not embedded here: it renders its own top
 * and bottom base bands, so nesting it in the central region would duplicate
 * the two bases. This component renders the two wire battlefields directly.
 */

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

interface DuelCardInteractionContextValue {
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

const DuelCardInteractionContext = createContext<DuelCardInteractionContextValue | null>(null);

function useDuelCardInteraction(): DuelCardInteractionContextValue | null {
  return useContext(DuelCardInteractionContext);
}

function cardEventIsInspect(event: SyntheticEvent<HTMLElement>): boolean {
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

function nameFor(projection: DuelProjectionTransport, playerId: string | null): string {
  if (playerId === null) return DUEL_CONTROLLED_BY_NOBODY;
  return (
    projection.match.roster.find(person => person.playerId === playerId)?.displayName ?? playerId
  );
}

function PublicChainPanel({
  cards,
  nameOf,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly cards: readonly DuelPublicChainCardV3Actions1[];
  readonly nameOf: (playerId: string) => string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  return (
    <section className="full-product-duel-chain" aria-label={DUEL_CHAIN_LABEL}>
      <h3 className="full-product-duel-chain-title">{DUEL_CHAIN_LABEL}</h3>
      <ol className="full-product-duel-chain-list">
        {cards.map((card, index) => (
          <li key={`${card.cardId}:${card.controllerPlayerId}:${card.status}:${index}`} className="full-product-duel-chain-card">
            <CardArt cardId={card.cardId} resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage} className="full-product-duel-chain-thumb" onInspect={onInspect} />
            <span className="full-product-duel-chain-name">{resolveCardTitle(card.cardId)}</span>
            <span className="full-product-duel-chain-meta">{nameOf(card.controllerPlayerId)} · {card.status === "pending" ? "待结算" : "已确认"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The playing-stage wire match the board reads from. V1 and V2 are identical
 * except for `schemaVersion`; V3 adds the public permanent fields (Legend
 * readiness/controller and `board.gears`). Reads accept all three without
 * widening `schemaVersion` away, and the V3-only fields are gated behind an
 * explicit `schemaVersion === 3` check — never a cast or a schema downgrade.
 */
export type DuelWirePlayingMatch = DuelWireMatchPlaying | DuelWireMatchPlayingV2 | DuelWireMatchPlayingV3;

/**
 * The public Gears a V3 playing board projects, or `[]` for V1/V2 (which carry
 * no permanent zone at all). This is a read of the wire, not a derived rule
 * model.
 */
export function duelBoardGears(playing: DuelWirePlayingMatch): readonly DuelWireGearPermanent[] {
  return playing.schemaVersion === 3 ? playing.board.gears : [];
}

/**
 * The public Legend permanent for one seat, or `null` for V1/V2 (whose legend is
 * only `{ cardId }`). V3 carries the server-projected controller and readiness;
 * the client never recomputes them from attachments or actions.
 */
export function duelLegendPermanent(
  playing: DuelWirePlayingMatch,
  playerId: string
): DuelWireLegendPermanent | null {
  if (playing.schemaVersion !== 3) return null;
  return playing.players.find(candidate => candidate.playerId === playerId)?.legend ?? null;
}

/**
 * A display label for a Gear's wire attachment host, resolved against the
 * current board only. The protocol guard already guarantees the host exists at
 * the same location and that the graph is acyclic, so this never "repairs" an
 * illegal graph: an unresolvable host returns `null` and the caller shows a
 * neutral, uid-free fallback instead of inventing a target.
 */
export function duelGearHostLabel(
  gears: readonly DuelWireGearPermanent[],
  units: readonly DuelWireUnit[],
  attachedToUID: string,
  resolveCardTitle: (cardId: string) => string
): string | null {
  const gear = gears.find(candidate => candidate.uid === attachedToUID);
  if (gear) return resolveCardTitle(gear.cardId);
  const unit = units.find(candidate => candidate.objectId === attachedToUID);
  if (!unit) return null;
  return unit.trait.kind === "card" ? resolveCardTitle(unit.trait.cardId) : unit.trait.name;
}

export interface DuelDeckCounts {
  readonly mainDeck: number;
  readonly runeDeck: number;
  readonly trash: number;
}

/**
 * The public deck/trash counts for one seat: the main-deck and trash counts are
 * the player's own wire fields, the rune-deck count is the matching resources
 * entry. Returns `null` when the seat is absent rather than inventing a `0`.
 */
export function duelDeckCounts(
  playing: DuelWirePlayingMatch,
  playerId: string
): DuelDeckCounts | null {
  const player = playing.players.find(candidate => candidate.playerId === playerId);
  const resources = playing.resources.players.find(candidate => candidate.playerId === playerId);
  if (!player || !resources) return null;
  return { mainDeck: player.mainDeckCount, runeDeck: resources.runeDeckCount, trash: player.trash.length };
}

/**
 * The public resource base for a board base. Both the resource base's
 * `playerId` *and* its `locationId` must match the board base before any rune or
 * gold token is shown; the component never copies authority from the board base
 * onto a mismatched resources entry.
 */
export function duelResourceBase(
  playing: DuelWirePlayingMatch,
  ownerPlayerId: string,
  locationId: string
): DuelWireResourceBase | null {
  return (
    playing.resources.bases.find(
      base => base.playerId === ownerPlayerId && base.locationId === locationId
    ) ?? null
  );
}

/**
 * Every card identity a viewer may currently look at, straight from the
 * projection. Public printings (legend, champion, battlefields, board units,
 * base runes, public trash) are always included; a player's hidden hand is only
 * included for the authenticated viewer, so a spectator or the other seat can
 * never resolve it.
 */
export function duelVisibleCardIds(projection: DuelProjectionTransport): readonly string[] {
  const ids = new Set<string>();
  const { match } = projection;
  const viewer = projection.viewerPlayerId;
  if (match.stage === "setup") {
    for (const player of match.setup.players) {
      ids.add(player.legend.cardId);
      ids.add(player.champion.cardId);
      if (viewer === player.playerId) {
        for (const card of player.hand ?? []) ids.add(card.cardId);
      }
    }
    for (const field of match.setup.selectedBattlefields) ids.add(field.cardId);
    return [...ids];
  }
  for (const player of match.players) {
    ids.add(player.legend.cardId);
    if (player.champion !== null) ids.add(player.champion.cardId);
    if (viewer === player.playerId) {
      for (const card of player.hand ?? []) ids.add(card.cardId);
    }
    for (const card of player.trash) ids.add(card.cardId);
  }
  for (const field of match.board.battlefields) ids.add(field.cardId);
  for (const unit of match.board.units) {
    if (unit.trait.kind === "card") ids.add(unit.trait.cardId);
  }
  // V3 board Gears are public printings too; V1/V2 project none, so this adds
  // nothing for them.
  for (const gear of duelBoardGears(match)) ids.add(gear.cardId);
  for (const base of match.resources.bases) {
    for (const rune of base.baseRunes) ids.add(rune.cardId);
  }
  for (const card of duelPublicChainCards(projection)) ids.add(card.cardId);
  return [...ids];
}

/** Read only the server supplied public Chain facts; no client side card or UID inference. */
export function duelPublicChainCards(projection: DuelProjectionTransport): readonly DuelPublicChainCardV3Actions1[] {
  if (projection.match.stage !== "playing" || !("chain" in projection.match.frame) ||
      projection.match.frame.chain.active !== true) return [];
  return projection.match.frame.chain.cards ?? [];
}

/**
 * Resolve a requested preview id against the *current* projection, or `null`
 * when the identity is not visible to this viewer. This is the synchronous
 * privacy guard the render path uses: a stale hand pick cannot survive a viewer
 * switch, because the card is no longer in the visible set.
 */
export function duelPreviewTarget(projection: DuelProjectionTransport, cardId: string | null): string | null {
  if (cardId === null) return null;
  return duelVisibleCardIds(projection).includes(cardId) ? cardId : null;
}

/** Ascending tick values `0..victoryScore` (9 ticks for the real target 8). */
export function scoreTrackValues(victoryScore: number): readonly number[] {
  if (!Number.isSafeInteger(victoryScore) || victoryScore < 1) return [0];
  const top = Math.min(victoryScore, DUEL_SCORE_TRACK_MAX_TICKS - 1);
  const values: number[] = [];
  for (let value = 0; value <= top; value += 1) values.push(value);
  return values;
}

/** A short rail marker for a display name; the full name stays in a title. */
export function duelScoreMarkerLabel(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return "?";
  const chars = Array.from(trimmed);
  return chars.length <= 3 ? trimmed : chars.slice(0, 3).join("");
}

function CardArt({
  cardId,
  resolveCardTitle,
  resolveCardImage,
  className,
  cardRole = DUEL_CARD_ROLE_PORTRAIT,
  onInspect,
  interactionUID
}: {
  readonly cardId: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly className: string;
  readonly cardRole?: DuelCardRole;
  readonly onInspect?: (cardId: string) => void;
  readonly interactionUID?: string;
}) {
  const cardInteraction = useDuelCardInteraction();
  const interactive = interactionUID !== undefined && cardInteraction?.canInteract === true;
  const imageUrl = resolveCardImage?.(cardId) ?? null;
  const title = resolveCardTitle(cardId);
  if (imageUrl === null && !onInspect) {
    return (
      <div
        className={`${className} is-missing`}
        aria-hidden="true"
        data-card-id={cardId}
        data-card-role={cardRole}
      />
    );
  }
  const image = imageUrl === null
    ? <span className={`${className} is-missing`} aria-hidden="true" data-card-role={cardRole} />
    : <img className={className} src={imageUrl} alt={title} data-card-role={cardRole} draggable={false} />;
  if (!onInspect) return image;
  // A real, keyboard-reachable button. Preview only — it forwards no action,
  // cost or hidden zone; clicking it just shows the image at full size.
  return (
    <button
      type="button"
      className="full-product-duel-card-button"
      data-card-id={cardId}
      data-card-role={cardRole}
      data-card-inspect-only={interactive ? undefined : "true"}
      aria-label={`${interactive ? "操作卡牌：" : DUEL_INSPECT_TRIGGER_PREFIX}${title}`}
      title={title}
      onClick={interactive ? undefined : () => onInspect(cardId)}
      onDragStart={event => event.preventDefault()}
    >
      {image}
    </button>
  );
}

/**
 * One V3 Gear permanent: card face, name, current controller, ready/exhausted
 * state and — when the wire says so — its attachment host. Every value is read
 * straight from `DuelWireGearPermanent`; a host that cannot be resolved to a
 * public card/unit shows a neutral label without leaking a uid. Attaching never
 * emits a command: the whole chip is display-only (its only optional control is
 * the shared read-only card preview).
 */
function GearChip({
  gear,
  controllerLabel,
  hostLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly gear: DuelWireGearPermanent;
  readonly controllerLabel: string;
  readonly hostLabel: string | null;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(gear.cardId);
  const hostText = hostLabel ?? DUEL_GEAR_ATTACH_UNKNOWN_LABEL;
  return (
    <li
      className="full-product-duel-gear"
      data-controller-player-id={gear.controllerPlayerId}
      data-readied={gear.readied ? "true" : "false"}
    >
      <CardArt
        cardId={gear.cardId}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        className="full-product-duel-gear-thumb"
        onInspect={onInspect}
      />
      <span className="full-product-duel-gear-details">
        <span className="full-product-duel-gear-name" title={title}>
          {title}
        </span>
        <span className="full-product-duel-gear-controller" title={controllerLabel}>
          {DUEL_LEGEND_CONTROLLER_LABEL}：{controllerLabel}
        </span>
        <span className="full-product-duel-gear-state">
          {gear.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
        </span>
        {gear.attachedToUID !== null ? (
          <span className="full-product-duel-gear-host" title={`${DUEL_GEAR_ATTACH_LABEL}：${hostText}`}>
            {DUEL_GEAR_ATTACH_LABEL}：{hostText}
          </span>
        ) : (
          <span className="full-product-duel-gear-host is-independent">{DUEL_GEAR_UNATTACHED_LABEL}</span>
        )}
      </span>
    </li>
  );
}

/**
 * The Gears at one location, or nothing at all when that location projects no
 * Gear — an empty `gears` list must not leave a placeholder band. `units` are
 * the units at the same location (the wire guard only ever attaches a Gear to a
 * host at its own location), so a Gear-on-Gear chain still resolves.
 */
function GearList({
  locationId,
  gears,
  units,
  projection,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly locationId: string;
  readonly gears: readonly DuelWireGearPermanent[];
  readonly units: readonly DuelWireUnit[];
  readonly projection: DuelProjectionTransport;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const atLocation = gears.filter(gear => gear.locationId === locationId);
  if (atLocation.length === 0) return null;
  return (
    <div
      className="full-product-duel-gears"
      data-location-id={locationId}
      aria-label={DUEL_GEAR_SECTION_LABEL}
    >
      <span className="full-product-duel-section-label">{DUEL_GEAR_SECTION_LABEL}</span>
      <ul className="full-product-duel-gear-list">
        {atLocation.map(gear => (
          <GearChip
            key={gear.uid}
            gear={gear}
            controllerLabel={nameFor(projection, gear.controllerPlayerId)}
            hostLabel={
              gear.attachedToUID === null
                ? null
                : duelGearHostLabel(gears, units, gear.attachedToUID, resolveCardTitle)
            }
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            onInspect={onInspect}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * The V3 Legend's server-projected status: its current controller and one of
 * three readiness states (未建立 / 就绪 / 已横置). Rendered only when the board
 * actually projects a Legend permanent, so V1/V2 are untouched.
 */
function LegendState({
  legend,
  projection
}: {
  readonly legend: DuelWireLegendPermanent;
  readonly projection: DuelProjectionTransport;
}) {
  return (
    <p className="full-product-duel-legend-state" data-readiness={legend.readiness}>
      <span className="full-product-duel-legend-controller">
        {DUEL_LEGEND_CONTROLLER_LABEL}：{nameFor(projection, legend.controllerPlayerId)}
      </span>
      <span className="full-product-duel-legend-readiness" data-readiness={legend.readiness}>
        {DUEL_LEGEND_READINESS_LABELS[legend.readiness]}
      </span>
    </p>
  );
}

function UnitChip({
  unit,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly unit: DuelWireUnit;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const label = unitDisplayLabel(unit, resolveCardTitle);
  const cardInteraction = useDuelCardInteraction();
  const interactive = cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === unit.controllerPlayerId &&
    cardInteraction.isCardActionable(unit.objectId);
  const onCardClick = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
    if (!interactive || cardEventIsInspect(event)) return;
    cardInteraction?.onCardClick(event, unit.objectId, unit.trait.kind === "card" ? unit.trait.cardId : null, "unit");
  };
  return (
    <li
      data-object-id={unit.objectId}
      data-card-uid={interactive ? unit.objectId : undefined}
      data-card-zone={interactive ? "unit" : undefined}
      data-owner-player-id={unit.ownerPlayerId}
      data-controller-player-id={unit.controllerPlayerId}
      data-readied={unit.readied ? "true" : "false"}
      onClick={interactive ? onCardClick : undefined}
      onPointerDown={interactive ? event => {
        if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, unit.objectId, "unit");
      } : undefined}
      onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
      onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}
      onPointerCancel={interactive ? () => cardInteraction?.onCardPointerCancel() : undefined}
      className={interactive ? "full-product-duel-unit full-product-duel-card-surface" : "full-product-duel-unit"}
    >
      {unit.trait.kind === "card" ? (
        <CardArt
          cardId={unit.trait.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          className="full-product-duel-unit-thumb"
          onInspect={onInspect}
          interactionUID={interactive ? unit.objectId : undefined}
        />
      ) : null}
      <span className="full-product-duel-unit-details">
        <span className="full-product-duel-unit-name">{label}</span>
        {unit.trait.kind === "token" ? (
          <span className="full-product-duel-unit-token">
            <span className="full-product-duel-unit-might">
              {DUEL_BASE_MIGHT_LABEL} {unit.trait.baseMight}
            </span>
            {unit.trait.tags.length > 0 ? (
              <span className="full-product-duel-unit-tags">{unit.trait.tags.join("、")}</span>
            ) : null}
          </span>
        ) : null}
        <span className="full-product-duel-unit-state">
          <span className="full-product-duel-unit-readied">
            {unit.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
          </span>
          {unit.totalDamage > 0 ? (
            <span className="full-product-duel-unit-damage" aria-label={DUEL_DAMAGE_LABEL}>
              {DUEL_DAMAGE_LABEL} {unit.totalDamage}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

function UnitGroupList({
  units,
  projection,
  sides,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly units: readonly DuelWireUnit[];
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  if (units.length === 0) {
    return <p className="full-product-duel-empty">暂无单位</p>;
  }
  // Group by *current controller* so a stolen unit shows under the player who
  // actually controls it; both controllers can appear on the same field, with
  // the opposing seat's group first/left (same order as the two base bands).
  const groups = orderUnitGroupsForViewer(units, sides);
  return (
    <div className="full-product-duel-unit-groups" data-slot="unit-groups">
      {groups.map(([controllerId, groupUnits]) => (
        <div
          key={controllerId}
          className="full-product-duel-unit-group"
          data-slot="unit-group"
          data-controller-player-id={controllerId}
          aria-label={`${nameFor(projection, controllerId)} 单位`}
        >
          <h5 className="full-product-duel-unit-group-owner">
            {nameFor(projection, controllerId)}
          </h5>
          <ul className="full-product-duel-unit-list">
            {groupUnits.map(unit => (
              <UnitChip
                key={unit.objectId}
                unit={unit}
                resolveCardTitle={resolveCardTitle}
                resolveCardImage={resolveCardImage}
                onInspect={onInspect}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BaseRuneChip({
  rune,
  ownerPlayerId,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly rune: DuelWireBaseRune;
  readonly ownerPlayerId: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const cardInteraction = useDuelCardInteraction();
  const interactive = cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === ownerPlayerId &&
    cardInteraction.isCardActionable(rune.uid);
  const domainLabel = DUEL_DOMAIN_LABELS[rune.domain];
  const state = rune.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL;
  const title = resolveCardTitle(rune.cardId);
  const imageUrl = resolveCardImage?.(rune.cardId) ?? null;
  const body = (
    <>
      {imageUrl !== null ? (
        <img
          className="full-product-duel-baserune-thumb"
          src={imageUrl}
          alt={title}
          data-card-role={DUEL_CARD_ROLE_PORTRAIT}
        />
      ) : (
        <div
          className="full-product-duel-baserune-thumb is-missing"
          aria-hidden="true"
          data-card-role={DUEL_CARD_ROLE_PORTRAIT}
        />
      )}
      <span className="full-product-duel-baserune-caption">
        <span className="full-product-duel-baserune-domain">{domainLabel}</span>
        <span className="full-product-duel-baserune-state">{state}</span>
      </span>
    </>
  );
  const shared = {
    className: interactive ? "full-product-duel-baserune full-product-duel-card-surface" : "full-product-duel-baserune",
    "data-uid": rune.uid,
    "data-card-uid": interactive ? rune.uid : undefined,
    "data-card-zone": interactive ? "rune" : undefined,
    "data-domain": rune.domain,
    "data-readied": rune.readied ? "true" : "false"
  } as const;
  if (onInspect) {
    return (
      <li {...shared}
        onClick={interactive ? event => {
          if (cardEventIsInspect(event)) return;
          cardInteraction?.onCardClick(event, rune.uid, rune.cardId, "rune");
        } : undefined}
        onPointerDown={interactive ? event => {
          if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, rune.uid, "rune");
        } : undefined}
        onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
        onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}>
        <button
          type="button"
          className="full-product-duel-baserune-button"
          data-card-inspect-only={interactive ? undefined : "true"}
          aria-label={`${interactive ? "操作符文：" : DUEL_INSPECT_TRIGGER_PREFIX}${domainLabel}符文`}
          title={`${title}（${state}）`}
          onClick={interactive ? undefined : () => onInspect(rune.cardId)}
          onDragStart={event => event.preventDefault()}
        >
          {body}
        </button>
      </li>
    );
  }
  return (
    <li {...shared} aria-label={`${domainLabel}符文（${state}）`}
      onClick={interactive ? event => cardInteraction?.onCardClick(event, rune.uid, rune.cardId, "rune") : undefined}
      onPointerDown={interactive ? event => {
        if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, rune.uid, "rune");
      } : undefined}
      onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
      onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}>
      {body}
    </li>
  );
}

function BaseRuneList({
  playerName,
  ownerPlayerId,
  runes,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly playerName: string;
  readonly ownerPlayerId: string;
  readonly runes: readonly DuelWireBaseRune[];
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  return (
    <div className="full-product-duel-baserunes" aria-label={`${playerName} ${DUEL_BASE_RUNE_LABEL}`}>
      <span className="full-product-duel-section-label">{DUEL_BASE_RUNE_LABEL}</span>
      {runes.length === 0 ? (
        <p className="full-product-duel-empty">{DUEL_NO_BASE_RUNE_NOTICE}</p>
      ) : (
        <ul className="full-product-duel-baserune-list">
          {runes.map(rune => (
            <BaseRuneChip
              key={rune.uid}
              rune={rune}
              ownerPlayerId={ownerPlayerId}
              resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage}
              onInspect={onInspect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GoldTokenList({
  playerName,
  ownerPlayerId,
  tokens
}: {
  readonly playerName: string;
  readonly ownerPlayerId: string;
  readonly tokens: readonly DuelWireGoldToken[];
}) {
  const cardInteraction = useDuelCardInteraction();
  const isInteractive = (uid: string): boolean => cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === ownerPlayerId && cardInteraction.isCardActionable(uid);
  const readied = tokens.filter(token => token.readied).length;
  return (
    <div className="full-product-duel-gold-line" aria-label={`${playerName} ${DUEL_GOLD_LABEL}`}>
      <span className="full-product-duel-section-label">{DUEL_GOLD_LABEL}</span>
      <span className="full-product-duel-gold-summary">
        {tokens.length}（{DUEL_READY_LABEL} {readied}／{DUEL_TAPPED_LABEL} {tokens.length - readied}）
      </span>
      {tokens.length > 0 ? (
        <ul className="full-product-duel-gold-list">
          {tokens.map(token => {
            const interactive = isInteractive(token.uid);
            return (
              <li
                key={token.uid}
                className={interactive ? "full-product-duel-gold full-product-duel-card-surface" : "full-product-duel-gold"}
                data-card-uid={interactive ? token.uid : undefined}
                data-card-zone={interactive ? "gold" : undefined}
                data-readied={token.readied ? "true" : "false"}
                aria-label={`${DUEL_GOLD_LABEL} ${token.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={interactive ? event => {
                  if (event.target !== event.currentTarget || event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  cardInteraction?.onCardClick(event, token.uid, null, "gold");
                } : undefined}
                onClick={interactive ? event => cardInteraction?.onCardClick(event, token.uid, null, "gold") : undefined}
                onPointerDown={interactive ? event => cardInteraction?.onCardPointerDown(event, token.uid, "gold") : undefined}
                onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
                onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}
              >
                {/* No card id, no printing metadata: a plain gold mark only. */}
                <span className="full-product-duel-gold-glyph" aria-hidden="true">
                  金
                </span>
                <span className="full-product-duel-gold-state">
                  {token.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function IdentityRow({
  role,
  cardId,
  fallbackLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly role: string;
  readonly cardId: string | null;
  readonly fallbackLabel?: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = cardId === null ? (fallbackLabel ?? DUEL_NO_CHAMPION_LABEL) : resolveCardTitle(cardId);
  return (
    <div>
      <dt>{role}</dt>
      <dd>
        {cardId !== null ? (
          <CardArt
            cardId={cardId}
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            className="full-product-duel-identity-thumb"
            onInspect={onInspect}
          />
        ) : null}
        <span className="full-product-duel-identity-title">{title}</span>
      </dd>
    </div>
  );
}

function BattlefieldCard({
  field,
  units,
  gears,
  projection,
  sides,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly field: DuelWireBattlefield;
  readonly units: readonly DuelWireUnit[];
  readonly gears: readonly DuelWireGearPermanent[];
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(field.cardId);
  const cardInteraction = useDuelCardInteraction();
  return (
    <section
      data-location-id={field.locationId}
      data-instance-id={field.instanceId}
      data-drop-kind="battlefield"
      data-drop-location={field.locationId}
      className={`full-product-duel-battlefield${cardInteraction?.dropTargetState("battlefield", field.locationId) ?? ""}`}
      aria-label={`中央战场 ${title}`}
    >
      <header className="full-product-duel-battlefield-head">
        <div className="full-product-duel-battlefield-head-main">
          <h4 className="full-product-duel-battlefield-title">{title}</h4>
          <div className="full-product-duel-battlefield-tags">
            <span>贡献者：{nameFor(projection, field.ownerPlayerId)}</span>
            <span>控制者：{nameFor(projection, field.controllerPlayerId)}</span>
            {field.contested ? (
              <span className="full-product-duel-contested">{DUEL_CONTESTED_LABEL}</span>
            ) : null}
          </div>
        </div>
        {/* The battlefield art is a small, clickable horizontal thumbnail beside
            the name/owner/contested text, so it never consumes the column's
            vertical room and both controller groups stay on screen. */}
        <CardArt
          cardId={field.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          className="full-product-duel-battlefield-thumb"
          cardRole={DUEL_CARD_ROLE_LANDSCAPE}
          onInspect={onInspect}
        />
      </header>
      <GearList
        locationId={field.locationId}
        gears={gears}
        units={units}
        projection={projection}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        onInspect={onInspect}
      />
      <UnitGroupList
        units={units}
        projection={projection}
        sides={sides}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        onInspect={onInspect}
      />
    </section>
  );
}

/** Only public counts enter a concealed hand; it cannot resolve a card identity. */
function HiddenHand({ playerName, count, spectator = false }: {
  readonly playerName: string;
  readonly count: number;
  readonly spectator?: boolean;
}) {
  return <div className="full-product-duel-hidden-hand" aria-label={`${playerName} 手牌区，共 ${count} 张，牌面隐藏`}>
    <span className="full-product-duel-hand-zone-label">{playerName}<br />手牌 {count}（背面）</span>
    <div className="full-product-duel-hand-backs" aria-hidden="true">
      {Array.from({ length: Math.min(count, 16) }, (_, index) => <span key={index} className="full-product-duel-card-back" />)}
      {count > 16 ? <span>＋{count - 16}</span> : null}
    </div>
    {spectator ? <span className="full-product-duel-empty">{DUEL_SPECTATOR_HAND_NOTICE}</span> : null}
  </div>;
}

function PlaymatPile({ playerName, label, count, area }: {
  readonly playerName: string;
  readonly label: string;
  readonly count: number;
  readonly area: string;
}) {
  return <dl className={`full-product-duel-mat-pile full-product-duel-mat-${area}`}>
    <dt>{label}</dt><dd aria-label={`${playerName} ${label}`}>{count}</dd>
  </dl>;
}

function BaseBand({
  base, resourceBase, player, deck, units, gears, legend, seatId,
  position, projection, sides, resolveCardTitle, resolveCardImage, resolveCardDomains, onInspect
}: {
  readonly base: DuelWireBase;
  readonly resourceBase: DuelWireResourceBase | null;
  readonly player: DuelWirePlayingPlayer;
  readonly deck: DuelDeckCounts | null;
  readonly units: readonly DuelWireUnit[];
  readonly gears: readonly DuelWireGearPermanent[];
  readonly legend: DuelWireLegendPermanent | null;
  readonly seatId: string;
  readonly position: string;
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly resolveCardDomains?: (cardId: string) => readonly string[];
  readonly onInspect?: (cardId: string) => void;
}) {
  const playerName = nameFor(projection, seatId);
  const cardInteraction = useDuelCardInteraction();
  const runes = resourceBase?.baseRunes ?? [];
  const gold = resourceBase?.goldTokens ?? [];
  const ribbon = useRef<HTMLDivElement>(null);
  const pool = projection.match.stage === "playing"
    ? projection.match.resources.players.find(item => item.playerId === seatId)?.runePool : undefined;
  const legendDomains = duelLegendPowerDomains(resolveCardDomains?.(player.legend.cardId) ?? []);
  const points = projection.match.stage === "playing"
    ? projection.match.scoring.players.find(item => item.playerId === seatId)?.points : undefined;
  return (
    <section className={`full-product-duel-base full-product-duel-playmat-side${cardInteraction?.dropTargetState("base", base.locationId) ?? ""}`}
      data-position={position} data-owner-player-id={base.ownerPlayerId}
      data-location-id={base.locationId} data-drop-kind="base" data-drop-location={base.locationId}
      aria-label={`${playerName} 卡垫区域`}>
      <div className="full-product-duel-mat-identity" role="group" aria-label={`${playerName} 传说与英雄`}>
        <dl className="full-product-duel-setup-identity">
          <IdentityRow role={DUEL_LEGEND_ROLE_LABEL} cardId={player.legend.cardId}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
          <IdentityRow role={DUEL_CHAMPION_ROLE_LABEL} cardId={player.champion?.cardId ?? null}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
        </dl>
        {legend ? <LegendState legend={legend} projection={projection} /> : null}
      </div>
      <div className="full-product-duel-mat-base" role="group" aria-label={`${playerName} 基地`}>
        <header className="full-product-duel-base-head">
          <h4 className="full-product-duel-base-title">{playerName} 基地</h4>
          {points !== undefined ? <span className="full-product-duel-mat-score" aria-label={`${playerName} 得分`}>{points}</span> : null}
          <span className="full-product-duel-base-scroll">
            <button type="button" aria-label={`向左查看${playerName}基地卡片`} title="向左查看基地卡片"
              onClick={() => ribbon.current?.scrollBy({ left: -240, behavior: "smooth" })}>‹</button>
            <button type="button" aria-label={`向右查看${playerName}基地卡片`} title="向右查看基地卡片"
              onClick={() => ribbon.current?.scrollBy({ left: 240, behavior: "smooth" })}>›</button>
          </span>
        </header>
        <div className="full-product-duel-base-body" ref={ribbon} tabIndex={0}
          role="region" aria-label={`${playerName}基地卡片带`}>
          <GearList locationId={base.locationId} gears={gears} units={units} projection={projection}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
          <UnitGroupList units={units} projection={projection} sides={sides}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
        </div>
      </div>
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_MAIN_DECK_LABEL} count={deck.mainDeck} area="main-deck" /> : null}
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_RUNE_DECK_LABEL} count={deck.runeDeck} area="rune-deck" /> : null}
      <div className="full-product-duel-mat-runes" role="group" aria-label={`${playerName} 符文区`}>
        <BaseRuneList playerName={playerName} ownerPlayerId={seatId} runes={runes} resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage} onInspect={onInspect} />
        <GoldTokenList playerName={playerName} ownerPlayerId={seatId} tokens={gold} />
        {pool ? <dl className="full-product-duel-mat-pool" aria-label={`${playerName} 当前资源池`}>
          <div><dt>能量：</dt><dd>{pool.energy}</dd></div>
          {legendDomains.map(domain => <div key={domain}><dt>{DUEL_DOMAIN_LABELS[domain]}符能：</dt><dd>{pool.power[domain]}</dd></div>)}
          <div><dt>通用符能：</dt><dd>{pool.power.any}</dd></div>
        </dl> : null}
      </div>
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_TRASH_LABEL} count={deck.trash} area="trash" /> : null}
    </section>
  );
}

function SetupIdentityBand({
  seatId,
  player,
  hiddenHand,
  position,
  projection,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly seatId: string;
  readonly player: DuelWireSetupPlayer;
  readonly hiddenHand: boolean;
  readonly position: string;
  readonly projection: DuelProjectionTransport;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const playerName = nameFor(projection, seatId);
  return (
    <section
      className="full-product-duel-base full-product-duel-setup-seat"
      data-position={position}
      data-owner-player-id={seatId}
      aria-label={`${playerName} 准备信息`}
    >
      <header className="full-product-duel-base-head">
        <h4 className="full-product-duel-base-title">{playerName} 基地</h4>
      </header>
      <dl className="full-product-duel-setup-identity">
        <IdentityRow
          role={DUEL_LEGEND_ROLE_LABEL}
          cardId={player.legend.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          onInspect={onInspect}
        />
        <IdentityRow
          role={DUEL_CHAMPION_ROLE_LABEL}
          cardId={player.champion.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          onInspect={onInspect}
        />
        <div>
          <dt>调度</dt>
          <dd>{player.mulliganStatus === "pending" ? "待调度" : "已完成"}</dd>
        </div>
      </dl>
      {/* Setup never fabricates a base-rune board: running a mulligan has not
          placed any rune yet, so only the real stage information is shown. */}
    </section>
  );
}

function SetupBattlefieldCard({
  cardId,
  instanceId,
  ownerLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly cardId: string;
  readonly instanceId: string;
  readonly ownerLabel: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(cardId);
  return (
    <section
      className="full-product-duel-battlefield"
      data-instance-id={instanceId}
      aria-label={`已选战场 ${title}`}
    >
      <header className="full-product-duel-battlefield-head">
        <h4 className="full-product-duel-battlefield-title">{title}</h4>
        <div className="full-product-duel-battlefield-tags">
          <span>选择者：{ownerLabel}</span>
        </div>
      </header>
      <CardArt
        cardId={cardId}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        className="full-product-duel-battlefield-thumb"
        cardRole={DUEL_CARD_ROLE_LANDSCAPE}
        onInspect={onInspect}
      />
    </section>
  );
}

function DuelScoreRail({
  scoring,
  nameOf
}: {
  readonly scoring: DuelWireScoring;
  readonly nameOf: (playerId: string) => string;
}) {
  const goal = scoring.victoryScore;
  const ticks = [...scoreTrackValues(goal)].reverse();
  const overflow = scoring.players.filter(player => player.points > goal);
  const marker = (playerId: string, points: number) => {
    const name = nameOf(playerId);
    return (
      <span
        key={playerId}
        className="full-product-duel-score-chip"
        data-player-id={playerId}
        data-points={points}
        title={`${name} ${points} 分`}
        aria-label={`${name} 积分 ${points}`}
      >
        <span className="full-product-duel-score-chip-name">{duelScoreMarkerLabel(name)}</span>
        <span className="full-product-duel-score-chip-points">{points}</span>
      </span>
    );
  };
  return (
    <div className="full-product-duel-score" aria-label={DUEL_SCORE_TRACK_LABEL}>
      {overflow.length > 0 ? (
        <div className="full-product-duel-score-overflow" aria-label={DUEL_SCORE_OVERFLOW_LABEL}>
          {overflow.map(player => marker(player.playerId, player.points))}
        </div>
      ) : null}
      <ol className="full-product-duel-score-ticks">
        {ticks.map(value => (
          <li
            key={value}
            className="full-product-duel-score-tick"
            data-tick={value}
            data-goal={value === goal ? "true" : undefined}
            aria-label={value === goal ? DUEL_SCORE_VICTORY_ARIA : undefined}
          >
            <span className="full-product-duel-score-tick-value">{value}</span>
            {scoring.players
              .filter(player => player.points === value)
              .map(player => marker(player.playerId, player.points))}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardPreviewOverlay({
  cardId,
  title,
  imageUrl,
  onClose
}: {
  readonly cardId: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="full-product-duel-preview" role="dialog" aria-modal="true" aria-label={DUEL_PREVIEW_LABEL}>
      <div className="full-product-duel-preview-body" data-card-id={cardId}>
        <h3 className="full-product-duel-preview-title">{title}</h3>
        {imageUrl !== null ? (
          <img className="full-product-duel-preview-image" src={imageUrl} alt={title} />
        ) : (
          <p className="full-product-duel-preview-missing">{DUEL_PREVIEW_NO_IMAGE_NOTICE}</p>
        )}
        <button
          type="button"
          className="full-product-duel-preview-close"
          aria-label={DUEL_PREVIEW_CLOSE_LABEL}
          onClick={onClose}
        >
          {DUEL_PREVIEW_CLOSE_TEXT}
        </button>
      </div>
    </div>
  );
}

export function DuelMatchBoard({
  projection,
  connectionStatus,
  commandPending,
  onCommand,
  resolveCardTitle,
  resolveCardImage,
  resolveCardDomains,
  activityLog,
  onActionPacket,
  chat,
  controls,
  readOnly = false
}: DuelMatchBoardProps) {
  const { match } = projection;
  const boardRef = useRef<HTMLDivElement>(null);
  const ended = match.stage === "playing" && match.frame.phase === "ended";
  const lockReason = readOnly ? "回放视角，界面只读"
    : duelInteractionLockedReason({ connectionStatus, commandPending, ended });

  // Temporary mulligan selection only; reset on any context change.
  const resetKey = mulliganResetKey(projection);
  const [state, setState] = useState<{ key: string; uids: readonly string[] }>({
    key: resetKey,
    uids: []
  });
  if (state.key !== resetKey) {
    setState({ key: resetKey, uids: [] });
  }
  const selection = state.key === resetKey ? state.uids : [];

  // Temporary, read-only card preview. It is reset synchronously on any context
  // change (viewer / version / stage / match) and additionally resolved against
  // the current projection's visible identities, so a stale pick can never show
  // a hand that the new viewer cannot see.
  const previewKey = [match.matchId, projection.viewerPlayerId ?? "spectator", match.stage].join("|");
  const [preview, setPreview] = useState<{ key: string; cardId: string | null }>({
    key: previewKey,
    cardId: null
  });
  if (preview.key !== previewKey) {
    setPreview({ key: previewKey, cardId: null });
  }
  const requestedPreview = preview.key === previewKey ? preview.cardId : null;
  const previewCardId = duelPreviewTarget(projection, requestedPreview);
  const onInspect = (cardId: string): void => {
    if (duelPreviewTarget(projection, cardId) === null) return;
    setPreview({ key: previewKey, cardId });
  };
  const closePreview = (): void => {
    setPreview(current => (current.key === previewKey ? { key: current.key, cardId: null } : current));
  };
  const previewOverlay =
    previewCardId !== null ? (
      <CardPreviewOverlay
        cardId={previewCardId}
        title={resolveCardTitle(previewCardId)}
        imageUrl={resolveCardImage?.(previewCardId) ?? null}
        onClose={closePreview}
      />
    ) : null;

  type CardPopoverState = {
    readonly sceneKey: string;
    readonly cardUID: string | null;
    readonly cardId: string | null;
    readonly title: string;
    readonly anchor: DuelCardPopoverAnchor;
    readonly anchorElement: HTMLElement | null;
    readonly actionIds: readonly string[];
    readonly initialSelection?: DuelActionsSelection;
  };
  type DragState = {
    readonly sceneKey: string;
    readonly cardUID: string;
    readonly sourceZone: DuelCardSurfaceZone;
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly moved: boolean;
  };
  const [cardPopover, setCardPopover] = useState<CardPopoverState | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressCardClickRef = useRef(false);
  const lastSourceRef = useRef<{ cardId: string | null; anchor: DuelCardPopoverAnchor; element: HTMLElement } | null>(null);
  const autoChoiceKeyRef = useRef<string | null>(null);
  useEffect(() => {
    dragRef.current = null;
    suppressCardClickRef.current = false;
    setDragging(null);
    setCardPopover(null);
  }, [resetKey, lockReason]);
  useEffect(() => { lastSourceRef.current = null; }, [previewKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || dragRef.current === null) return;
      event.preventDefault();
      dragRef.current = null;
      setDragging(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  const sides = resolveDuelSides(projection);
  const [bottom, top] = [
    projection.match.roster.find(person => person.playerId === sides.bottomSeatId)!,
    projection.match.roster.find(person => person.playerId === sides.topSeatId)!
  ];

  const allActions: readonly DuelActionV3Actions1[] = projection.actions;
  const legacyActions = allActions.filter((action): action is DuelWireAction => isLegacyAction(action));
  const cardActions = actionPanelActions(legacyActions);
  const sourceActions = resourceSourceActions(legacyActions);
  const actionById = new Map(legacyActions.map(action => [action.id, action]));

  const p4Projection = projection as unknown as DuelProjectionV3Actions1;
  const projectionValidP4 = isDuelProjectionV3Actions1(projection);
  const p4Actions = projectionValidP4 ? allActions.filter(action => !isLegacyAction(action)) : [];

  const submitP4Action = (action: DuelActionV3Actions1, selection: DuelActionsSelection = EMPTY_DUEL_ACTIONS_SELECTION): boolean => {
    if (lockReason !== null || !action.enabled || !projectionValidP4 || !p4Actions.includes(action)) return false;
    const packet = submitDuelActionSelection({
      action,
      selection: { ...selection, actionId: action.id },
      pendingChoice: p4Projection.match.stage === "playing" ? p4Projection.match.frame.pendingChoice : null,
      gate: {
        connectionStatus,
        commandPending,
        projectionValid: projectionValidP4,
        ended
      },
      expectedVersion: match.stateVersion,
      ids: createDuelActionPacketIds()
    });
    if (packet === null) return false;
    if (onActionPacket) return onActionPacket(packet) !== false;
    else onCommand(packet.command);
    return true;
  };

  const anchorFromEvent = (event: SyntheticEvent<HTMLElement>): DuelCardPopoverAnchor => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const isP4Interactive = projectionValidP4 &&
    projection.viewerPlayerId !== null && lockReason === null;
  const isCardActionable = (cardUID: string): boolean =>
    isP4Interactive && duelCardActionIds(p4Projection, cardUID).length > 0;

  const openCardPopover = (
    event: SyntheticEvent<HTMLElement>,
    cardUID: string | null,
    cardId: string | null,
    sourceZone: DuelCardSurfaceZone,
    title: string,
    initialSelection?: DuelActionsSelection
  ): void => {
    if (!isP4Interactive) return;
    const ids = cardUID === null ? [] : duelCardActionIds(p4Projection, cardUID);
    if (sourceZone === "hand" || sourceZone === "unit") {
      lastSourceRef.current = { cardId, anchor: anchorFromEvent(event), element: event.currentTarget };
    }
    setCardPopover({
      sceneKey: resetKey,
      cardUID,
      cardId,
      title,
      anchor: anchorFromEvent(event),
      anchorElement: event.currentTarget,
      actionIds: ids,
      initialSelection
    });
  };

  const finishCardDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const draft = dragRef.current;
    if (draft !== null && draft.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    if (draft === null || draft.sceneKey !== resetKey || !draft.moved) return;
    suppressCardClickRef.current = true;
    const targetElement = typeof document === "undefined"
      ? null
      : document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop-location]");
    const kind = targetElement?.dataset.dropKind;
    const locationId = targetElement?.dataset.dropLocation;
    if (kind !== "base" && kind !== "battlefield" || locationId === undefined || !isP4Interactive) return;
    const targets = duelCardDropTargets(p4Projection, draft.cardUID);
    if (!targets.some(target => target.kind === kind && target.locationId === locationId)) return;
    const selection = duelCardDropSelection(p4Projection, draft.cardUID, locationId);
    const action = selection === null ? undefined : p4Actions.find(candidate => candidate.id === selection.actionId);
    const matching = duelCardActionIds(p4Projection, draft.cardUID).map(id => p4Actions.find(candidate => candidate.id === id))
      .filter(candidate => candidate?.enabled && (candidate.kind === "play-card" || candidate.kind === "standard-move" &&
        candidate.destinations.some(destination => destination.locationId === locationId && destination.eligibleUnitUIDs.includes(draft.cardUID))));
    if (matching.length === 1 && action !== undefined && selection !== null && submitP4Action(action, selection)) return;
    const cardId = match.stage === "playing" ? match.players.find(player => player.playerId === projection.viewerPlayerId)?.hand
      ?.find(card => card.uid === draft.cardUID)?.cardId ?? null : null;
    openCardPopover(event, draft.cardUID, cardId, draft.sourceZone, cardId ? resolveCardTitle(cardId) : "选择操作", selection ?? undefined);
  };

  const cardInteractionValue: DuelCardInteractionContextValue = {
    viewerPlayerId: projection.viewerPlayerId,
    sceneKey: resetKey,
    canInteract: isP4Interactive,
    isCardActionable,
    onCardClick: (event, cardUID, cardId, sourceZone) => {
      if (suppressCardClickRef.current) {
        suppressCardClickRef.current = false;
        if ("detail" in event && event.detail !== 0) return;
      }
      openCardPopover(event, cardUID, cardId, sourceZone, cardId === null ? "资源操作" : resolveCardTitle(cardId));
    },
    onCardPointerDown: (event, cardUID, sourceZone) => {
      if (!isP4Interactive || event.button !== 0) return;
      suppressCardClickRef.current = false;
      if (duelCardDropTargets(p4Projection, cardUID).length === 0) return;
      const sourceCardId = match.stage === "playing" ? match.players.find(player => player.playerId === projection.viewerPlayerId)?.hand
        ?.find(card => card.uid === cardUID)?.cardId ?? null : null;
      lastSourceRef.current = { cardId: sourceCardId, anchor: anchorFromEvent(event), element: event.currentTarget };
      const draft: DragState = {
        sceneKey: resetKey,
        cardUID,
        sourceZone,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false
      };
      dragRef.current = draft;
      setDragging(draft);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onCardPointerMove: event => {
      const draft = dragRef.current;
      if (draft === null || draft.sceneKey !== resetKey || draft.pointerId !== event.pointerId) return;
      if (!draft.moved && Math.hypot(event.clientX - draft.startX, event.clientY - draft.startY) < 6) return;
      const next = { ...draft, moved: true, clientX: event.clientX, clientY: event.clientY };
      setCardPopover(null);
      dragRef.current = next;
      setDragging(next);
      event.preventDefault();
    },
    onCardPointerUp: finishCardDrag,
    onCardPointerCancel: () => { dragRef.current = null; setDragging(null); },
    dropTargetState: (kind, locationId) => {
      if (dragging === null || dragging.sceneKey !== resetKey || !isP4Interactive) return undefined;
      const valid = duelCardDropTargets(p4Projection, dragging.cardUID)
        .some(target => target.kind === kind && target.locationId === locationId);
      return valid ? " is-drop-target" : undefined;
    }
  };

  const ownedChoice = projectionValidP4 && p4Projection.match.stage === "playing" &&
    p4Projection.match.frame.pendingChoice && "choiceId" in p4Projection.match.frame.pendingChoice
    ? p4Projection.match.frame.pendingChoice : null;
  const pendingP4ActionIds = ownedChoice === null ? [] : p4Actions
    .filter(action => (action.kind === "answer-pending-choice" || action.kind === "assign-combat-damage") && action.choiceId === ownedChoice.choiceId)
    .map(action => action.id);
  const ownedChoiceKey = ownedChoice === null ? null : `${resetKey}|${ownedChoice.choiceId}`;

  function pendingCardPopover(): CardPopoverState | null {
    if (!isP4Interactive || pendingP4ActionIds.length === 0 || typeof document === "undefined") return null;
    const root = boardRef.current;
    if (!root) return null;
    const lastSource = lastSourceRef.current;
    const fieldLocation = ownedChoice?.kind === "combat-allocation" ? ownedChoice.fieldLocationId : null;
    const field = fieldLocation === null ? null : Array.from(root.querySelectorAll<HTMLElement>("[data-drop-location]"))
      .find(element => element.dataset.dropLocation === fieldLocation);
    const chain = root.querySelector<HTMLElement>(".full-product-duel-chain-card:last-child");
    const element = field ?? chain ?? (lastSource?.element.isConnected ? lastSource.element : null);
    const rootRect = root.getBoundingClientRect();
    const rect = element?.getBoundingClientRect();
    const cardId = duelPreviewTarget(projection, lastSource?.cardId ?? null);
    return {
      sceneKey: resetKey,
      cardUID: null,
      cardId,
      title: cardId ? resolveCardTitle(cardId) : "处理选择",
      anchor: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : lastSource?.anchor ?? { left: rootRect.left + rootRect.width / 2, top: rootRect.top + rootRect.height / 2, width: 0, height: 0 },
      anchorElement: element,
      actionIds: pendingP4ActionIds
    };
  }

  useEffect(() => {
    if (!isP4Interactive) { autoChoiceKeyRef.current = null; return; }
    if (ownedChoiceKey === null) { autoChoiceKeyRef.current = null; return; }
    if (autoChoiceKeyRef.current === ownedChoiceKey) return;
    const next = pendingCardPopover();
    if (next) {
      autoChoiceKeyRef.current = ownedChoiceKey;
      setCardPopover(next);
    }
  }, [ownedChoiceKey, isP4Interactive]);

  const dispatch = (action: DuelWireAction, selectedUIDs: readonly string[] = []): void => {
    if (lockReason !== null) return;
    if (!action.enabled) return;
    if (action.kind === "mulligan" && selectedUIDs.length > action.maxSelections) return;
    const command = buildDuelWireCommand(action, selectedUIDs);
    if (command) onCommand(command);
  };

  const header = (
    <div className="full-product-duel-header">
      <span className="full-product-duel-header-matchup">
        {bottom.displayName} vs {top.displayName}
      </span>
      {match.stage === "playing" ? (
        <>
          <span className="full-product-duel-header-round" aria-label="回合">
            第 {match.frame.turnNumber} 回合
          </span>
          <span className="full-product-duel-header-phase" aria-label="阶段">
            {DUEL_PHASE_LABELS[match.frame.phase]}
          </span>
          <span className="full-product-duel-header-turn" aria-label="行动玩家">
            行动：{nameFor(projection, match.frame.turnPlayerId)}
          </span>
        </>
      ) : (
        <span className="full-product-duel-header-phase" aria-label="阶段">
          {match.setup.stage === "mulligan" ? "调度阶段" : "准备阶段"}
        </span>
      )}
    </div>
  );

  const scoreboard =
    match.stage === "playing" ? (
      <DuelScoreRail scoring={match.scoring} nameOf={playerId => nameFor(projection, playerId)} />
    ) : (
      <div className="full-product-duel-score is-setup" aria-label={DUEL_SCORE_TRACK_LABEL}>
        <span className="full-product-duel-score-tick-value">准备阶段</span>
      </div>
    );

  const activityLogSlot = activityLog ? (
    <div className="full-product-duel-activity">{activityLog}</div>
  ) : null;

  if (match.stage === "setup") {
    const setup = match.setup;
    const bottomPlayer = setup.players.find(player => player.playerId === sides.bottomSeatId)!;
    const topPlayer = setup.players.find(player => player.playerId === sides.topSeatId)!;
    const viewerHand: readonly DuelWireCard[] =
      projection.viewerPlayerId === null
        ? []
        : (setup.players.find(player => player.playerId === projection.viewerPlayerId)?.hand ?? []);

    const mulliganAction = legacyActions.find(action => action.kind === "mulligan");
    const handByUid = new Map(viewerHand.map(card => [card.uid, card]));

    const actionPanel = (
      <div className="full-product-duel-actions">
        {lockReason ? (
          <p className="full-product-duel-readonly" role="status">
            {lockReason}
          </p>
        ) : null}
        {mulliganAction ? (
          <div className="full-product-duel-mulligan">
            <p className="full-product-duel-hint">{DUEL_MULLIGAN_OWNER_HINT}</p>
            <ul className="full-product-duel-mulligan-list">
              {mulliganAction.selectableUIDs.map(uid => {
                const card = handByUid.get(uid);
                const selected = selection.includes(uid);
                const disabled = lockReason !== null || !mulliganAction.enabled;
                return (
                  <li key={uid}>
                    <button
                      type="button"
                      className="full-product-duel-mulligan-card"
                      aria-pressed={selected}
                      aria-label={`调度选择 ${card ? resolveCardTitle(card.cardId) : uid}`}
                      disabled={disabled}
                      onClick={() =>
                        setState(current =>
                          current.key === resetKey
                            ? {
                                key: current.key,
                                uids: toggleMulliganSelection(
                                  current.uids,
                                  uid,
                                  mulliganAction.maxSelections
                                )
                              }
                            : current
                        )
                      }
                    >
                      {card ? resolveCardTitle(card.cardId) : uid}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="full-product-duel-mulligan-confirm"
              aria-label={`确认调度，已选 ${selection.length} 张`}
              disabled={lockReason !== null || !mulliganAction.enabled}
              onClick={() => dispatch(mulliganAction, selection)}
            >
              确认调度（已选 {selection.length}）
            </button>
          </div>
        ) : (
          <p className="full-product-duel-hint">
            {setup.currentMulliganOwner === null
              ? DUEL_SETUP_COMPLETE_HINT
              : setup.currentMulliganOwner === projection.viewerPlayerId
                ? DUEL_MULLIGAN_OWNER_HINT
                : DUEL_MULLIGAN_WAIT_HINT}
          </p>
        )}
      </div>
    );

    const handSlot =
      projection.viewerPlayerId === null ? (
        <HiddenHand playerName={nameFor(projection, bottomPlayer.playerId)} count={bottomPlayer.handCount} spectator />
      ) : (
        <ul className="full-product-duel-hand">
          {viewerHand.map(card => (
            <li key={card.uid} className="full-product-duel-hand-card" data-uid={card.uid}>
              <CardArt
                cardId={card.cardId}
                resolveCardTitle={resolveCardTitle}
                resolveCardImage={resolveCardImage}
                className="full-product-duel-hand-thumb"
                onInspect={onInspect}
              />
              <span className="full-product-duel-hand-title">
                {resolveCardTitle(card.cardId)}
              </span>
            </li>
          ))}
        </ul>
      );

    return (
      <div className="full-product-duel-match" aria-label={DUEL_MATCH_BOARD_LABEL}>
        <DuelTableLayout
          header={header}
          controls={controls}
          chat={chat}
          scoreboard={scoreboard}
          opponentHand={<HiddenHand playerName={nameFor(projection, topPlayer.playerId)} count={topPlayer.handCount} />}
          opponentBase={
            <SetupIdentityBand
              seatId={topPlayer.playerId}
              player={topPlayer}
              hiddenHand
              position="opponent"
              projection={projection}
              resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage}
              onInspect={onInspect}
            />
          }
          battlefields={
            <div className="full-product-duel-fields">
              {setup.selectedBattlefields.map(field => (
                <SetupBattlefieldCard
                  key={field.instanceId}
                  cardId={field.cardId}
                  instanceId={field.instanceId}
                  ownerLabel={nameFor(projection, field.playerId)}
                  resolveCardTitle={resolveCardTitle}
                  resolveCardImage={resolveCardImage}
                  onInspect={onInspect}
                />
              ))}
            </div>
          }
          playerBase={
            <SetupIdentityBand
              seatId={bottomPlayer.playerId}
              player={bottomPlayer}
              hiddenHand={projection.viewerPlayerId === null}
              position="player"
              projection={projection}
              resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage}
              onInspect={onInspect}
            />
          }
          hand={handSlot}
          actionPanel={actionPanel}
          activityLog={activityLogSlot}
        />
        {previewOverlay}
      </div>
    );
  }

  const playing: DuelWirePlayingMatch = match;
  const board = playing.board;
  const bottomBase = board.bases.find(base => base.ownerPlayerId === sides.bottomSeatId)!;
  const topBase = board.bases.find(base => base.ownerPlayerId === sides.topSeatId)!;

  const bottomPlayer = playing.players.find(player => player.playerId === sides.bottomSeatId)!;
  const topPlayer = playing.players.find(player => player.playerId === sides.topSeatId)!;
  const viewerHand: readonly DuelWireCard[] =
    projection.viewerPlayerId === null
      ? []
      : (playing.players.find(player => player.playerId === projection.viewerPlayerId)?.hand ?? []);

  const bottomResource = duelResourceBase(playing, bottomBase.ownerPlayerId, bottomBase.locationId);
  const topResource = duelResourceBase(playing, topBase.ownerPlayerId, topBase.locationId);
  const bottomDeck = duelDeckCounts(playing, sides.bottomSeatId);
  const topDeck = duelDeckCounts(playing, sides.topSeatId);
  // V3 public permanents (empty for V1/V2, so those boards render unchanged).
  const gears = duelBoardGears(playing);
  const bottomLegend = duelLegendPermanent(playing, sides.bottomSeatId);
  const topLegend = duelLegendPermanent(playing, sides.topSeatId);
  const publicChain = duelPublicChainCards(projection);
  const windowStatus = projection.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
    ? describeDuelWindowStatus(projection) : null;

  const globalP4Actions = p4Actions.filter(action =>
    action.kind === "end-turn" || action.kind === "pass-priority" || action.kind === "pass-focus");
  const reopenPendingChoice = (): void => {
    const next = pendingCardPopover();
    if (next) setCardPopover(next);
  };

  const actionPanel = (
    <div className="full-product-duel-actions">
      {lockReason ? (
        <p className="full-product-duel-readonly" role="status">
          {lockReason}
        </p>
      ) : null}
      {playing.frame.phase === "awaiting-turn-start" ? (
        <p className="full-product-duel-hint">{DUEL_WAITING_TURN_START_NOTICE}</p>
      ) : null}
      {globalP4Actions.length > 0 ? (
        <div className="full-product-duel-global-actions" aria-label="全局操作">
          {globalP4Actions.map(action => (
            <button key={action.id} type="button" className="full-product-duel-global-action"
              aria-label={action.label} disabled={lockReason !== null || !action.enabled}
              title={lockReason ?? (action.enabled ? action.label : action.reason)}
              onClick={() => submitP4Action(action)}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {cardActions.length === 0 && playing.frame.phase !== "awaiting-turn-start" &&
          projection.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ? (
        <p className="full-product-duel-hint">{DUEL_NO_ACTIONS_NOTICE}</p>
      ) : cardActions.length > 0 ? (
        <ul className="full-product-duel-action-list">
          {cardActions.map(action => {
            const disabled = lockReason !== null || !action.enabled;
            const reason = lockReason ?? (action.enabled ? undefined : action.reason);
            const summary = paymentSummaryFor(action);
            return (
              <li key={action.id}>
                <button
                  type="button"
                  className="full-product-duel-action"
                  aria-label={action.label}
                  disabled={disabled}
                  title={reason}
                  onClick={() => dispatch(action)}
                >
                  <span className="full-product-duel-action-label">{action.label}</span>
                  {summary ? (
                    <span className="full-product-duel-action-cost">
                      能量 {summary.energyCost ?? "—"}
                      {(summary.powerCosts ?? []).map(cost => ` · ${cost.label} ${cost.amount}`)}
                    </span>
                  ) : null}
                  {reason ? <span className="full-product-duel-action-reason">{reason}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {pendingP4ActionIds.length > 0 ? (
        <button type="button" className="full-product-duel-pending-choice-reopen"
          aria-label="处理选择" disabled={lockReason !== null} onClick={reopenPendingChoice}>
          处理选择
        </button>
      ) : null}
      {projection.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ? (
        <details className="full-product-duel-more-actions">
          <summary>更多操作</summary>
          <DuelActionsPanelV3 projection={p4Projection} connectionStatus={connectionStatus}
            commandPending={commandPending || readOnly} resolveCardName={resolveCardTitle} showLegacySummary={false}
            onCommand={packet => onActionPacket ? onActionPacket(packet) : onCommand(packet.command)} />
        </details>
      ) : null}
    </div>
  );

  const resourcePool = sides.viewerSeated ? (
    <ResourcePoolPanel
      compact
      energy={{ amount: playing.resources.players.find(p => p.playerId === sides.bottomSeatId)!.runePool.energy }}
      powers={duelPowerViews(
        playing.resources.players.find(p => p.playerId === sides.bottomSeatId)!.runePool,
        duelLegendPowerDomains(resolveCardDomains?.(bottomPlayer.legend.cardId) ?? [])
      )}
      sourceActions={sourceActions}
      paymentSummary={resourcePoolPaymentSummary(legacyActions)}
      status={resourcePoolStatusFor(connectionStatus)}
      commandPending={commandPending}
      readOnly={readOnly}
      ended={ended}
      onAction={actionId => {
        const action = actionById.get(actionId);
        if (action) dispatch(action);
      }}
    />
  ) : (
    <section className="full-product-duel-spectator-resource" aria-label="旁观资源概览">
      <p className="full-product-duel-hint">{DUEL_SPECTATOR_RESOURCE_NOTICE}</p>
      <ul className="full-product-duel-spectator-list">
        {playing.resources.players.map(player => {
          const powerTotal =
            DUEL_POWER_DOMAINS.reduce((total, domain) => total + player.runePool.power[domain], 0) +
            player.runePool.power.any;
          return (
            <li key={player.playerId} className="full-product-duel-spectator-row" data-player-id={player.playerId}>
              <span>{nameFor(projection, player.playerId)}</span>
              <span aria-label={`${nameFor(projection, player.playerId)} 能量`}>
                能量 {player.runePool.energy}
              </span>
              <span aria-label={`${nameFor(projection, player.playerId)} 符能`}>
                符能 {powerTotal}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const handSlot =
    projection.viewerPlayerId === null ? (
      <HiddenHand playerName={nameFor(projection, bottomPlayer.playerId)} count={bottomPlayer.handCount} spectator />
    ) : (
      <ul className="full-product-duel-hand">
        {viewerHand.map(card => {
          const actionable = isCardActionable(card.uid);
          return (
            <li key={card.uid}
              className={`full-product-duel-hand-card${actionable ? " full-product-duel-card-surface" : ""}${lockReason === null && windowStatus?.responseAvailable && windowStatus.playableCardUIDs.includes(card.uid) ? " full-product-duel-hand-response" : ""}`}
              data-uid={card.uid}
              data-card-uid={actionable ? card.uid : undefined}
              data-card-zone={actionable ? "hand" : undefined}
              onClick={actionable ? event => {
                if (cardEventIsInspect(event)) return;
                cardInteractionValue?.onCardClick(event, card.uid, card.cardId, "hand");
              } : undefined}
              onPointerDown={actionable ? event => {
                if (!cardEventIsInspect(event)) cardInteractionValue?.onCardPointerDown(event, card.uid, "hand");
              } : undefined}
              onPointerMove={actionable ? event => cardInteractionValue?.onCardPointerMove(event) : undefined}
              onPointerUp={actionable ? event => cardInteractionValue?.onCardPointerUp(event) : undefined}
              onPointerCancel={actionable ? () => cardInteractionValue.onCardPointerCancel() : undefined}>
            <CardArt
              cardId={card.cardId}
              resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage}
              className="full-product-duel-hand-thumb"
              onInspect={onInspect}
              interactionUID={actionable ? card.uid : undefined}
            />
            <span className="full-product-duel-hand-title">
              {resolveCardTitle(card.cardId)}
            </span>
            {lockReason === null && windowStatus?.responseAvailable && windowStatus.playableCardUIDs.includes(card.uid)
              ? <span className="full-product-duel-response-label">当前可连锁</span> : null}
            </li>
          );
        })}
      </ul>
    );

  const currentCardPopover = cardPopover?.sceneKey === resetKey ? cardPopover : null;
  const popoverLegacyActions = currentCardPopover === null ? [] : legacyActions
    .filter(action => currentCardPopover.actionIds.includes(action.id));
  const popoverP4Ids = currentCardPopover?.actionIds.filter(id => p4Actions.some(action => action.id === id)) ?? [];
  const cardPopoverOverlay = currentCardPopover !== null ? (
    <DuelCardActionPopover
      anchor={currentCardPopover.anchor}
      anchorElement={currentCardPopover.anchorElement}
      title={currentCardPopover.title}
      onClose={() => setCardPopover(null)}
      onInspect={currentCardPopover.cardId === null ? undefined : () => { setCardPopover(null); onInspect(currentCardPopover.cardId!); }}
    >
      {popoverLegacyActions.map(action => (
        <button key={action.id} type="button" className="full-product-duel-global-action"
          disabled={lockReason !== null || !action.enabled} title={lockReason ?? action.reason ?? action.label}
          onClick={() => { dispatch(action); setCardPopover(null); }}>
          {action.label}
        </button>
      ))}
      {popoverP4Ids.length > 0 ? (
      <DuelActionsPanelV3
        projection={p4Projection}
        connectionStatus={connectionStatus}
        commandPending={commandPending || readOnly}
        presentation="card"
        actionIds={popoverP4Ids}
        initialSelection={currentCardPopover.initialSelection}
        resolveCardName={resolveCardTitle}
        showLegacySummary={false}
        onCommand={packet => {
          if (onActionPacket) { if (onActionPacket(packet) === false) return; }
          else onCommand(packet.command);
          setCardPopover(null);
        }}
      />
      ) : popoverLegacyActions.length === 0 ? <p>当前没有可用操作</p> : null}
    </DuelCardActionPopover>
  ) : null;
  const dragCard = viewerHand.find(card => card.uid === dragging?.cardUID);
  const dragGhost = dragging?.moved ? (
    <div
      className="full-product-duel-drag-ghost"
      aria-hidden="true"
      style={{ left: dragging.clientX + 10, top: dragging.clientY + 10 }}
    >
      {dragCard ? resolveCardTitle(dragCard.cardId) : "卡牌"}
    </div>
  ) : null;

  return (
    <DuelCardInteractionContext.Provider value={cardInteractionValue}>
      <div ref={boardRef} className="full-product-duel-match" aria-label={DUEL_MATCH_BOARD_LABEL}
        onContextMenu={event => {
          if (dragRef.current === null && cardPopover === null) return;
          event.preventDefault();
          dragRef.current = null;
          setDragging(null);
          setCardPopover(null);
        }}>
        <DuelTableLayout
        header={header}
        controls={controls}
        chat={chat}
        timing={projection.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
          ? <DuelWindowStatus projection={projection} /> : null}
        scoreboard={scoreboard}
        opponentHand={<HiddenHand playerName={nameFor(projection, topPlayer.playerId)} count={topPlayer.handCount} />}
        opponentBase={
          <BaseBand
            base={topBase}
            resourceBase={topResource}
            player={topPlayer}
            deck={topDeck}
            units={unitsAtLocation(board.units, topBase.locationId)}
            gears={gears}
            legend={topLegend}
            seatId={sides.topSeatId}
            position="opponent"
            projection={projection}
            sides={sides}
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            resolveCardDomains={resolveCardDomains}
            onInspect={onInspect}
          />
        }
        battlefields={
          <div className="full-product-duel-fields">
            {publicChain.length > 0 ? (
              <PublicChainPanel cards={publicChain} nameOf={playerId => nameFor(projection, playerId)}
                resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
            ) : null}
            {board.battlefields.map(field => (
              <BattlefieldCard
                key={field.locationId}
                field={field}
                units={unitsAtLocation(board.units, field.locationId)}
                gears={gears}
                projection={projection}
                sides={sides}
                resolveCardTitle={resolveCardTitle}
                resolveCardImage={resolveCardImage}
                onInspect={onInspect}
              />
            ))}
          </div>
        }
        playerBase={
          <BaseBand
            base={bottomBase}
            resourceBase={bottomResource}
            player={bottomPlayer}
            deck={bottomDeck}
            units={unitsAtLocation(board.units, bottomBase.locationId)}
            gears={gears}
            legend={bottomLegend}
            seatId={sides.bottomSeatId}
            position="player"
            projection={projection}
            sides={sides}
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            resolveCardDomains={resolveCardDomains}
            onInspect={onInspect}
          />
        }
        resourcePool={resourcePool}
        resourcePlacement={sides.viewerSeated && playing.frame.pendingPayment !== null &&
          "paymentId" in playing.frame.pendingPayment ? "actions" : "sidebar"}
        hand={handSlot}
        actionPanel={readOnly ? <p className="full-product-duel-hint">回放视角，操作已关闭。</p> : actionPanel}
        activityLog={activityLogSlot}
        />
        {previewOverlay}
        {cardPopoverOverlay}
        {dragGhost}
      </div>
    </DuelCardInteractionContext.Provider>
  );
}

export type { DuelWireMatchSetup, DuelWireMatchPlaying };
