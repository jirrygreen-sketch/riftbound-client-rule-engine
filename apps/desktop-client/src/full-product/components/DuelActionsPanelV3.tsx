import { useState } from "react";
import type {
  DuelActionV3Actions1,
  DuelCommandMessageV3Actions1,
  DuelPendingChoiceOwnerV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1,
  DuelWireCard,
  DuelWireChoicePromptV3Actions1,
  DuelWireCommandV3Actions1,
  DuelWireUnit
} from "@riftbound/protocol";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1
} from "@riftbound/protocol";
import { DUEL_WINDOW_STATUS_MAIN, describeDuelWindowStatus } from "./DuelWindowStatus";
import type { FullProductConnectionStatus } from "../types";
import "./DuelActionsPanelV3.css";

/**
 * Formal P4 React action / choice panel.
 *
 * Presentation seam, NOT a wire contract and NOT an authority. It consumes one
 * authoritative {@link DuelProjectionV3Actions1}; it never re-derives a rule,
 * never guesses Might/cost/authority, and never computes combat damage. Every
 * clickable entry comes from a server-provided action (`projection.actions`), and
 * each one submits an opaque, contract-guarded command carrying only server
 * tokens/UIDs plus `expectedVersion`.
 *
 * Fail-closed rules:
 *  - A malformed projection (fails the P4 guard) renders read-only.
 *  - Spectator (`viewerPlayerId === null`), non-owner, offline / connecting /
 *    reconnecting, `commandPending` and ended matches all render disabled.
 *  - A `choiceId` action whose owner choice cannot be matched is always disabled;
 *    the panel never falls back to a generic command box.
 *  - The five legacy resource actions are never re-implemented here: they render
 *    as inert reference chips for the resource panel.
 *
 * Local state is a temporary, per-action selection; it resets whenever the
 * projection identity (match id / state version / viewer / pending choice /
 * connection) changes. The panel never optimistically mutates the board.
 */

const LEGACY_KINDS = ["mulligan", "rune-energy", "rune-power", "gold-power", "pay-pending"] as const;

export const DUEL_ACTIONS_PANEL_LABEL = "动作与选择";
export const DUEL_ACTIONS_LIST_LABEL = "可用动作";
export const DUEL_ACTIONS_NO_ACTIONS_NOTICE = "当前无可用动作";
export const DUEL_ACTIONS_SPECTATOR_NOTICE = "旁观者仅等待，无法操作";
export const DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE = "选择数据不可用，等待服务器更新";
export const DUEL_ACTIONS_CHOICE_NEED_SELECTION = "请完成本项选择";
export const DUEL_ACTIONS_NO_OPTIONS_NOTICE = "暂无可选选项";
export const DUEL_ACTIONS_PROJECTION_INVALID_NOTICE = "投影数据异常，动作面板已只读";
export const DUEL_ACTIONS_ENDED_NOTICE = "对局已结束";
export const DUEL_ACTIONS_DISCONNECTED_NOTICE = "连接已断开，动作面板已只读";
export const DUEL_ACTIONS_CONNECTING_NOTICE = "正在连接，请稍候";
export const DUEL_ACTIONS_RECONNECTING_NOTICE = "正在重连，动作面板已只读";
export const DUEL_ACTIONS_PENDING_NOTICE = "指令处理中，请稍候";
export const DUEL_ACTIONS_BLOCKED_FALLBACK = "该动作当前不可用";
/**
 * Display-only rewording of the server's generic "waiting for the rules"
 * placeholders. A non-owner viewer in a normal, ready Main Phase is genuinely
 * waiting for the turn/priority owner's action — not for unresolved rules — so
 * the row may say so. It changes no `enabled`, command builder, guard or
 * validation, and every other reason (insufficient resources, unable to move,
 * unknown rule, disconnected, processing, read-only) is preserved verbatim.
 */
export const DUEL_ACTIONS_GENERIC_WAITING_REASONS = ["等待规则闭合", "当前回合仍有待处理规则"] as const;
export const DUEL_ACTIONS_WAITING_OPPONENT_REASON = "等待对手行动";
// Legacy actions are handled by the deck/mulligan and resource surfaces, not the
// resource pool alone; the note deliberately avoids naming a single sub-panel.
export const DUEL_ACTIONS_LEGACY_NOTE = "既有操作由对局面板处理";
export const DUEL_ACTIONS_WAITING_CHOICE_NOTICE = "等待其他玩家处理选择";
export const DUEL_ACTIONS_MOVE_NEED_UNIT = "请选择要移动的单位";
export const DUEL_ACTIONS_MOVE_NEED_DEST = "请选择目的地";
export const DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE = "所选单位无法移动到该目的地";
export const DUEL_ACTIONS_ALLOCATION_OVER_BUDGET = "分配超过预算";
export const DUEL_ACTIONS_ALLOCATION_NEED_TARGET = "请填写分配数量";
export const DUEL_ACTIONS_ALLOCATION_INVALID_TARGET = "分配目标不在服务器目标列表中";
export const DUEL_ACTIONS_ALLOCATION_INVALID_AMOUNT = "分配数量必须是正整数";
export const DUEL_ACTIONS_SUBMIT_LABEL_PREFIX = "确认";
export const DUEL_ACTIONS_MOVE_UNITS_LABEL = "选择要移动的单位";
export const DUEL_ACTIONS_MOVE_DEST_LABEL = "选择目的地";
export const DUEL_ACTIONS_ALLOCATION_BUDGET_LABEL = "可分配预算";
export const DUEL_ACTIONS_ALLOCATION_TARGETS_LABEL = "分配目标";
/** Player-facing labels for the prompt kinds; internal ids stay only in payloads. */
export const DUEL_ACTIONS_PROMPT_KIND_LABELS = {
  mode: "模式",
  target: "目标",
  destination: "目的地",
  "optional-cost": "额外费用",
  "effect-choice": "效果选择"
} as const;
export const DUEL_ACTIONS_PROMPT_TITLE_PREFIX = "选择";
export const DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX = "单位";
export const DUEL_ACTIONS_BASE_LABEL = "基地";
export const DUEL_ACTIONS_OPPONENT_BASE_LABEL = "对方基地";
export const DUEL_ACTIONS_BATTLEFIELD_LABEL = "战场";
/** Last-resort label when a location id cannot be matched to the public board. */
export const DUEL_ACTIONS_LOCATION_FALLBACK_LABEL = "未知区域";
/**
 * Separator between a server action label and the resolved hand-card name. Only
 * ever used for a `play-card` action whose `cardUID` resolves inside the
 * viewer's own legally-visible hand.
 */
export const DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR = "：";
export const DUEL_ACTIONS_STATUS_LABELS = {
  connected: "已连接",
  connecting: "连接中",
  reconnecting: "重连中",
  disconnected: "已断开"
} as const satisfies Readonly<Record<FullProductConnectionStatus, string>>;

export interface DuelActionsGateState {
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  /** False when the projection failed the P4 guard (fail closed). */
  readonly projectionValid: boolean;
  readonly ended: boolean;
}

/**
 * Single source of truth for "is any interaction allowed?". Returns `null` when
 * the panel is interactive, otherwise a human-readable Chinese reason.
 * `projectionValid: false` wins over everything so a broken projection can never
 * be papered over by an otherwise "connected" status.
 */
export function duelActionsGateReason(state: DuelActionsGateState): string | null {
  if (!state.projectionValid) return DUEL_ACTIONS_PROJECTION_INVALID_NOTICE;
  if (state.ended) return DUEL_ACTIONS_ENDED_NOTICE;
  switch (state.connectionStatus) {
    case "disconnected":
      return DUEL_ACTIONS_DISCONNECTED_NOTICE;
    case "connecting":
      return DUEL_ACTIONS_CONNECTING_NOTICE;
    case "reconnecting":
      return DUEL_ACTIONS_RECONNECTING_NOTICE;
    default:
      break;
  }
  if (state.commandPending) return DUEL_ACTIONS_PENDING_NOTICE;
  return null;
}

/**
 * Temporary per-action selection. Every field is a server token the user chose;
 * none of it is authoritative state and none of it is ever sent un-validated.
 */
export interface DuelActionsSelection {
  readonly actionId: string | null;
  /** `standard-move` only: selected unit UIDs (subset of `selectableUnitUIDs`). */
  readonly moveUnitUIDs: readonly string[];
  /** `standard-move` only: chosen destination location id. */
  readonly moveDestinationLocationId: string | null;
  /** `answer-pending-choice` only: promptId -> chosen option ids. */
  readonly choiceOptionIds: Readonly<Record<string, readonly string[]>>;
  /** `assign-combat-damage` only: target unit object id -> user-entered amount. */
  readonly allocationAmounts: Readonly<Record<string, number>>;
}

export const EMPTY_DUEL_ACTIONS_SELECTION: DuelActionsSelection = {
  actionId: null,
  moveUnitUIDs: [],
  moveDestinationLocationId: null,
  choiceOptionIds: {},
  allocationAmounts: {}
};

export interface DuelCommandPacketIds {
  readonly requestId: string;
  readonly commandId: string;
}

export interface DuelActionsPanelV3Props {
  /** Authoritative P4 projection. The panel re-runs the P4 guard before rendering. */
  readonly projection: DuelProjectionV3Actions1;
  readonly connectionStatus: FullProductConnectionStatus;
  readonly commandPending: boolean;
  /** Optional compatibility diagnostics. The formal board handles these actions itself. */
  readonly showLegacySummary?: boolean;
  /** Card presentation is wired by the direct-card interaction workstream. */
  readonly presentation?: "panel" | "card";
  /** Filters the original projection actions; an empty list displays none. */
  readonly actionIds?: readonly string[];
  /** Typed callback; the panel only ever hands it a contract-guarded P4 packet. */
  readonly onCommand: (packet: DuelCommandMessageV3Actions1) => void;
  /** Injectable id source so command identity is testable/deterministic. */
  readonly generatePacketIds?: () => DuelCommandPacketIds;
  /**
   * Optional SSR/test seam for the temporary selection. It is still only local,
   * temporary state: the submit boundary re-validates it and resets it on any
   * scene change, exactly as a click-built selection would be. Empty by default.
   */
  readonly initialSelection?: DuelActionsSelection;
  /**
   * Optional, display-only catalog resolver so a card unit can show its real
   * title. Injected by the parent from the same catalog the board uses; the
   * panel degrades to a token name or a stable "单位N" ordinal without it.
   */
  readonly resolveCardName?: (cardId: string) => string;
  /**
   * Optional, display-only catalog resolver for a location's printing card. Only
   * ever consulted for a battlefield the projection's board did not expose.
   */
  readonly cardNameById?: Readonly<Record<string, string>>;
}

let packetSeq = 0;

function defaultPacketIds(): DuelCommandPacketIds {
  packetSeq += 1;
  const stamp = `${Date.now().toString(36)}-${packetSeq.toString(36)}`;
  return { requestId: `p4-req-${stamp}`, commandId: `p4-cmd-${stamp}` };
}

/** Shared presentation-only packet identity source; command validation remains unchanged. */
export function createDuelActionPacketIds(): DuelCommandPacketIds { return defaultPacketIds(); }

function pendingChoiceKey(choice: DuelPendingChoiceV3Actions1): string {
  if (choice === null) return "none";
  if ("choiceId" in choice) return `${choice.choiceId}:${choice.kind}`;
  return "summary";
}

/** Identity of the projection scene; any change clears the temporary selection. */
export function duelActionsSceneSignature(
  projection: DuelProjectionV3Actions1,
  connectionStatus: FullProductConnectionStatus
): string {
  const match = projection.match;
  const choiceKey = match.stage === "playing" ? pendingChoiceKey(match.frame.pendingChoice) : "none";
  return [
    match.matchId,
    String(match.stateVersion),
    projection.viewerPlayerId ?? "-",
    choiceKey,
    connectionStatus === "connected" ? "on" : "off"
  ].join("|");
}

/** Pure fold the component uses to clear a stale selection on scene change. */
export function selectionAfterSceneChange(
  selection: DuelActionsSelection,
  previousScene: string,
  nextScene: string
): DuelActionsSelection {
  return previousScene === nextScene ? selection : EMPTY_DUEL_ACTIONS_SELECTION;
}

export function isLegacyAction(action: DuelActionV3Actions1): boolean {
  return (LEGACY_KINDS as readonly string[]).includes(action.kind);
}

// --- Display adapters ------------------------------------------------------
// These map the projection's public board / catalog into player-friendly text.
// They are PURE LOOKUPS: they never change a rule, a choice, a permission or any
// submitted payload. Every command still carries the raw server token/UID/window
// by value, so a label can never be reconstructed back into a command.

function playingBoard(projection: DuelProjectionV3Actions1): DuelWireBoardLike | null {
  const match = projection.match;
  if (match.stage !== "playing") return null;
  const board = match.board as unknown;
  if (board === null || typeof board !== "object" || Array.isArray(board)) return null;
  const bases = (board as { bases?: unknown }).bases;
  const battlefields = (board as { battlefields?: unknown }).battlefields;
  const units = (board as { units?: unknown }).units;
  if (!Array.isArray(bases) || !Array.isArray(battlefields) || !Array.isArray(units)) return null;
  return {
    bases: bases as readonly DuelWireBaseLike[],
    battlefields: battlefields as readonly DuelWireBattlefieldLike[],
    units: units as readonly DuelWireUnit[]
  };
}

interface DuelWireBaseLike {
  readonly locationId: string;
  readonly ownerPlayerId: string;
}
interface DuelWireBattlefieldLike {
  readonly locationId: string;
  readonly cardId: string;
}
interface DuelWireBoardLike {
  readonly bases: readonly DuelWireBaseLike[];
  readonly battlefields: readonly DuelWireBattlefieldLike[];
  readonly units: readonly DuelWireUnit[];
}

/**
 * The scenario id a visitor owns, or `null` for a spectator. A spectator has no
 * "my base", so their own base can never be labelled with the opponent's name.
 */
function ownSeatId(projection: DuelProjectionV3Actions1): string | null {
  return projection.viewerPlayerId;
}

/** The opponent's seat id, or `null` when the roster does not name exactly two seats. */
function opponentSeatId(projection: DuelProjectionV3Actions1): string | null {
  const viewer = projection.viewerPlayerId;
  const match = projection.match;
  const roster = match.stage === "playing" ? match.roster : null;
  if (viewer === null || roster === null) return null;
  const seats = [roster[0]?.playerId, roster[1]?.playerId];
  if (!seats.includes(viewer)) return null;
  return seats[0] === viewer ? (seats[1] ?? null) : (seats[0] ?? null);
}

/** Public label for a unit: a real catalog title, a token's name, or a stable ordinal. */
export function duelUnitDisplayLabel(
  unit: DuelWireUnit | undefined,
  ordinal: number,
  resolveCardName?: (cardId: string) => string
): string {
  if (unit !== undefined) {
    const candidate = unit.trait.kind === "token" ? unit.trait.name : resolveCardName?.(unit.trait.cardId);
    if (candidate !== undefined && candidate.trim().length > 0) return candidate;
  }
  return `${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}${ordinal}`;
}

/**
 * Unit UIDs the projection references inside actions/pending choice but does not
 * necessarily list on the public board. Purely a display-completeness helper.
 */
function referencedUnitIds(projection: DuelProjectionV3Actions1): readonly string[] {
  const ids: string[] = [];
  for (const action of projection.actions) {
    if (action.kind === "standard-move") {
      ids.push(...action.selectableUnitUIDs);
      for (const destination of action.destinations) ids.push(...destination.eligibleUnitUIDs);
    }
  }
  const pending = ownerPendingChoice(projection);
  if (pending !== null && "targets" in pending) {
    for (const target of pending.targets) ids.push(target.unitObjectId);
  }
  return ids;
}

/**
 * Build a UID/object-id -> label map keyed by the public board in projection
 * order. Units the board does not expose (projection gaps) still receive a
 * stable, ID-free ordinal so callers can fall back safely.
 */
export function duelUnitLabelById(
  projection: DuelProjectionV3Actions1,
  resolveCardName?: (cardId: string) => string
): ReadonlyMap<string, string> {
  const board = playingBoard(projection);
  const map = new Map<string, string>();
  const units = board?.units ?? [];
  const known = new Set(units.map(unit => unit.objectId));
  const names = units.map((unit, index) => duelUnitDisplayLabel(unit, index + 1, resolveCardName));
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const locations = duelLocationLabelById(projection);
  units.forEach((unit, index) => {
    const name = names[index]!;
    map.set(unit.objectId, counts.get(name)! > 1
      ? `${name}（${locations.get(unit.locationId) ?? DUEL_ACTIONS_LOCATION_FALLBACK_LABEL} · ${index + 1}）`
      : name);
  });
  let ordinal = units.length;
  for (const referenced of referencedUnitIds(projection)) {
    if (known.has(referenced) || map.has(referenced)) continue;
    ordinal += 1;
    map.set(referenced, `${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}${ordinal}`);
  }
  return map;
}

/** The viewer's own owner-visible playing hand, or an empty list. */
function viewerHand(projection: DuelProjectionV3Actions1): readonly DuelWireCard[] {
  const viewer = projection.viewerPlayerId;
  const match = projection.match;
  if (viewer === null || match.stage !== "playing") return [];
  const me = match.players.find(player => player.playerId === viewer);
  return me?.hand ?? [];
}

/**
 * Resolve the human card name for a `play-card` action's `cardUID`.
 *
 * LEGAL-VISIBILITY ONLY: the UID is looked up exclusively in the viewer's own
 * projection-visible hand, and only a matching entry's `cardId` is handed to the
 * injected catalog resolver. This never guesses from the UID, never reads an
 * opponent/hidden zone, never searches a hand the viewer's projection does not
 * expose, and never surfaces a raw UID or card id as player text. Returns `null`
 * whenever the UID is unmatched, the projection is not playing, the viewer is a
 * spectator, or the catalog cannot name the printing — so callers keep their
 * existing action label unchanged.
 */
export function duelPlayCardName(
  projection: DuelProjectionV3Actions1,
  cardUID: string,
  resolveCardName?: (cardId: string) => string
): string | null {
  if (resolveCardName === undefined) return null;
  const card = viewerHand(projection).find(entry => entry.uid === cardUID);
  if (card === undefined) return null;
  const name = resolveCardName(card.cardId);
  // An empty result OR a resolver that echoes the raw card id (catalog miss) is
  // treated as unresolved so a raw id can never become player text.
  if (name.trim().length === 0 || name === card.cardId) return null;
  return name;
}

/**
 * Player-facing label for a `play-card` action. When the action's `cardUID`
 * resolves to a visible own-hand card and the catalog can name it, the server
 * label is suffixed with that card name (e.g. `打出单位：铸光者`). Otherwise the
 * server `action.label` is returned unchanged. Display only: the raw `cardUID`
 * is still the sole identity carried in the submitted command, so two printings
 * that share a name remain distinguishable by `action.id`/`cardUID`.
 */
export function duelActionDisplayLabel(
  action: DuelActionV3Actions1,
  projection: DuelProjectionV3Actions1,
  resolveCardName?: (cardId: string) => string
): string {
  if (action.kind === "play-card") {
    const name = duelPlayCardName(projection, action.cardUID, resolveCardName);
    if (name !== null) return `${action.label}${DUEL_ACTIONS_PLAY_CARD_LABEL_SEPARATOR}${name}`;
  }
  return action.label;
}

/** Build a location-id -> label map from the viewer's seat and the public battlefields. */
export function duelLocationLabelById(
  projection: DuelProjectionV3Actions1
): ReadonlyMap<string, string> {
  const board = playingBoard(projection);
  const map = new Map<string, string>();
  if (board === null) return map;
  const own = ownSeatId(projection);
  const opponent = opponentSeatId(projection);
  board.bases.forEach(base => {
    if (own !== null && base.ownerPlayerId === own) {
      map.set(base.locationId, DUEL_ACTIONS_BASE_LABEL);
    } else if (opponent !== null && base.ownerPlayerId === opponent) {
      map.set(base.locationId, DUEL_ACTIONS_OPPONENT_BASE_LABEL);
    }
  });
  board.battlefields.forEach((field, index) => {
    map.set(field.locationId, `${DUEL_ACTIONS_BATTLEFIELD_LABEL}${index + 1}`);
  });
  return map;
}

/**
 * Player text for one typed prompt: `选择模式` etc. The same kind repeating
 * inside a choice gets a stable `（2）` suffix. The prompt's real id is never
 * used as player text but is preserved unchanged in the submitted payload.
 */
export function duelPromptTitle(
  prompt: DuelWireChoicePromptV3Actions1,
  prompts: readonly DuelWireChoicePromptV3Actions1[]
): string {
  const base = `${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS[prompt.kind]}`;
  const sameKind = prompts.filter(item => item.kind === prompt.kind);
  if (sameKind.length <= 1) return base;
  const index = sameKind.findIndex(item => item.promptId === prompt.promptId);
  return `${base}（${index + 1}）`;
}

function ownerChoiceFor(
  choice: DuelPendingChoiceV3Actions1,
  choiceId: string
): DuelPendingChoiceOwnerV3Actions1 | null {
  if (choice === null || !("choiceId" in choice)) return null;
  return choice.choiceId === choiceId ? choice : null;
}

/**
 * Card-presentation form for one filtered action. Presentation only: it never
 * changes a command, a guard or a permission.
 *
 *  - `immediate`: the action carries no user-chosen parameter, so a single click
 *    may validate + submit through {@link submitDuelActionSelection} (e.g.
 *    `play-card`, `activate-ability`, `pass-priority`, `pass-focus`, `end-turn`).
 *  - `choice-options`: an owner `answer-pending-choice` with exactly one prompt
 *    bounded `min === max === 1`; every real server option becomes its own
 *    direct-submit button (e.g. pay / decline an extra cost). Required and
 *    optional prompt semantics are untouched because `min`/`max` still govern
 *    the collected answers.
 *  - `params`: every other action (move units, combat allocation, multi-prompt or
 *    multi-select choices); parameters are collected, then one confirm submits.
 */
export type DuelCardActionForm = "immediate" | "choice-options" | "params";

export function duelCardActionForm(
  action: DuelActionV3Actions1,
  pendingChoice: DuelPendingChoiceV3Actions1
): DuelCardActionForm {
  switch (action.kind) {
    case "play-card":
    case "activate-ability":
    case "pass-priority":
    case "pass-focus":
    case "end-turn":
      return "immediate";
    case "standard-move":
    case "assign-combat-damage":
      return "params";
    case "answer-pending-choice": {
      const owner = ownerChoiceFor(pendingChoice, action.choiceId);
      if (!owner || (owner.kind !== "play-choices" && owner.kind !== "effect-choices")) return "params";
      if (owner.prompts.length !== 1) return "params";
      const prompt = owner.prompts[0]!;
      if (prompt.minSelections !== 1 || prompt.maxSelections !== 1 || prompt.options.length === 0) {
        return "params";
      }
      return "choice-options";
    }
    default:
      return "params";
  }
}

/**
 * Selection for one direct card option click: a fresh single answer for that
 * prompt. The full answer packet is still built by {@link buildDuelCommand} from
 * the complete server prompt list, so a required/optional extra cost is answered
 * exactly as the projection demands (never swallowed, never defaulted).
 */
export function duelCardOptionSelection(
  action: DuelActionV3Actions1,
  prompt: DuelWireChoicePromptV3Actions1,
  optionId: string,
  base: DuelActionsSelection
): DuelActionsSelection {
  return {
    ...base,
    actionId: action.id,
    choiceOptionIds: { ...base.choiceOptionIds, [prompt.promptId]: [optionId] }
  };
}

/** Disabled reason for an action row, or `null` when it may be selected. */
export function actionDisabledReason(
  action: DuelActionV3Actions1,
  gate: DuelActionsGateState,
  pendingChoice: DuelPendingChoiceV3Actions1
): string | null {
  const gateReason = duelActionsGateReason(gate);
  if (gateReason !== null) return gateReason;
  if (action.kind === "answer-pending-choice" || action.kind === "assign-combat-damage") {
    const owner = ownerChoiceFor(pendingChoice, action.choiceId);
    if (!owner) return DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE;
    const ownerIsCombat = owner.kind === "combat-allocation";
    if (action.kind === "answer-pending-choice" && ownerIsCombat) return DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE;
    if (action.kind === "assign-combat-damage" && !ownerIsCombat) return DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE;
  }
  if (!action.enabled) return action.reason ?? DUEL_ACTIONS_BLOCKED_FALLBACK;
  return null;
}

/**
 * True only for the exact scene the rewording is licensed for: an observable,
 * fully-ready open Main Phase (per the pure window helper) where the viewer is
 * neither the turn owner nor the priority owner. Anything else — a Chain, a
 * payment, a choice, an unresolved execution, a closed state, a non-Main phase,
 * an observer — returns false and keeps the server reason verbatim.
 */
function isNormalReadyMainForNonOwner(projection: DuelProjectionV3Actions1): boolean {
  const viewer = projection.viewerPlayerId;
  if (viewer === null) return false;
  if (describeDuelWindowStatus(projection).label !== DUEL_WINDOW_STATUS_MAIN) return false;
  const match = projection.match;
  if (match.stage !== "playing") return false;
  return viewer !== match.frame.turnPlayerId && viewer !== match.frame.priorityPlayerId;
}

/**
 * Display-only reason shown on a disabled action row. Every reason is preserved
 * verbatim except the two generic server "waiting for the rules" placeholders,
 * and only in the exact ready-Main, non-owner scene where the honest guidance is
 * "waiting for the opponent". This neither changes `action.enabled` nor any
 * command builder, guard or validation — it is pure presentation of the string.
 */
export function duelActionDisabledReasonDisplay(
  reason: string,
  action: DuelActionV3Actions1,
  projection: DuelProjectionV3Actions1
): string {
  if (!(DUEL_ACTIONS_GENERIC_WAITING_REASONS as readonly string[]).includes(reason)) return reason;
  if (action.enabled) return reason;
  if (!isNormalReadyMainForNonOwner(projection)) return reason;
  return DUEL_ACTIONS_WAITING_OPPONENT_REASON;
}

/** True when a prompt's current selection satisfies its server min/max bounds. */
function promptSelectionOk(prompt: DuelWireChoicePromptV3Actions1, picked: readonly string[]): boolean {
  if (picked.length < prompt.minSelections || picked.length > prompt.maxSelections) return false;
  const ids = new Set(prompt.options.map(option => option.id));
  if (!picked.every(id => ids.has(id))) return false;
  return new Set(picked).size === picked.length;
}

/**
 * Resolve whether the selected action may be submitted. The action is assumed to
 * be the panel's selected action. Returns `null` when a valid command could be
 * built, otherwise a Chinese reason.
 */
export function resolveDuelActionIssue(
  action: DuelActionV3Actions1,
  selection: DuelActionsSelection,
  pendingChoice: DuelPendingChoiceV3Actions1,
  gate: DuelActionsGateState
): string | null {
  const gateReason = duelActionsGateReason(gate);
  if (gateReason !== null) return gateReason;
  if (!action.enabled) return action.reason ?? DUEL_ACTIONS_BLOCKED_FALLBACK;
  switch (action.kind) {
    case "play-card":
    case "activate-ability":
    case "pass-priority":
    case "pass-focus":
    case "end-turn":
      return null;
    case "standard-move": {
      const units = selection.moveUnitUIDs;
      if (units.length === 0) return DUEL_ACTIONS_MOVE_NEED_UNIT;
      if (!units.every(uid => action.selectableUnitUIDs.includes(uid))) return DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE;
      const destinationId = selection.moveDestinationLocationId;
      if (destinationId === null) return DUEL_ACTIONS_MOVE_NEED_DEST;
      const destination = action.destinations.find(entry => entry.locationId === destinationId);
      if (!destination) return DUEL_ACTIONS_MOVE_NEED_DEST;
      if (!units.every(uid => destination.eligibleUnitUIDs.includes(uid))) {
        return DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE;
      }
      return null;
    }
    case "answer-pending-choice": {
      const owner = ownerChoiceFor(pendingChoice, action.choiceId);
      if (!owner || (owner.kind !== "play-choices" && owner.kind !== "effect-choices")) {
        return DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE;
      }
      for (const prompt of owner.prompts) {
        if (prompt.options.length === 0) return DUEL_ACTIONS_NO_OPTIONS_NOTICE;
        if (!promptSelectionOk(prompt, selection.choiceOptionIds[prompt.promptId] ?? [])) {
          return DUEL_ACTIONS_CHOICE_NEED_SELECTION;
        }
      }
      return null;
    }
    case "assign-combat-damage": {
      const owner = ownerChoiceFor(pendingChoice, action.choiceId);
      if (!owner || owner.kind !== "combat-allocation") return DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE;
      const targetIds = new Set(owner.targets.map(target => target.unitObjectId));
      let sum = 0;
      for (const [unitObjectId, amount] of Object.entries(selection.allocationAmounts)) {
        if (!targetIds.has(unitObjectId)) return DUEL_ACTIONS_ALLOCATION_INVALID_TARGET;
        if (!Number.isSafeInteger(amount) || amount < 0) return DUEL_ACTIONS_ALLOCATION_INVALID_AMOUNT;
        sum += amount;
      }
      if (sum > owner.budget) return DUEL_ACTIONS_ALLOCATION_OVER_BUDGET;
      if (owner.budget > 0 && sum < 1) return DUEL_ACTIONS_ALLOCATION_NEED_TARGET;
      return null;
    }
    default:
      return DUEL_ACTIONS_BLOCKED_FALLBACK;
  }
}

/**
 * Build the opaque P4 command from server tokens/UIDs + the user's selection.
 * Never guesses a cost/Might/damage and never emits a state/proof/actor field.
 * Returns `null` when the selection is incomplete or the choice cannot be matched.
 */
export function buildDuelCommand(
  action: DuelActionV3Actions1,
  selection: DuelActionsSelection,
  pendingChoice: DuelPendingChoiceV3Actions1
): DuelWireCommandV3Actions1 | null {
  switch (action.kind) {
    case "play-card":
      return { type: "play-card", cardUID: action.cardUID, windowId: action.windowId };
    case "activate-ability":
      return {
        type: "activate-ability",
        sourceObjectId: action.sourceObjectId,
        abilityOptionId: action.abilityOptionId,
        windowId: action.windowId
      };
    case "pass-priority":
      return { type: "pass-priority", windowId: action.windowId };
    case "pass-focus":
      return { type: "pass-focus", windowId: action.windowId };
    case "end-turn":
      return { type: "end-turn", windowId: action.windowId };
    case "standard-move": {
      const destinationId = selection.moveDestinationLocationId;
      if (selection.moveUnitUIDs.length === 0 || destinationId === null) return null;
      return {
        type: "standard-move",
        windowId: action.windowId,
        unitUIDs: [...selection.moveUnitUIDs],
        destinationLocationId: destinationId
      };
    }
    case "answer-pending-choice": {
      const owner = ownerChoiceFor(pendingChoice, action.choiceId);
      if (!owner || (owner.kind !== "play-choices" && owner.kind !== "effect-choices")) return null;
      const answers = owner.prompts.map(prompt => ({
        promptId: prompt.promptId,
        optionIds: [...(selection.choiceOptionIds[prompt.promptId] ?? [])]
      }));
      return { type: "answer-pending-choice", choiceId: action.choiceId, answers };
    }
    case "assign-combat-damage": {
      const owner = ownerChoiceFor(pendingChoice, action.choiceId);
      if (!owner || owner.kind !== "combat-allocation") return null;
      const targetIds = new Set(owner.targets.map(target => target.unitObjectId));
      const assignments = Object.entries(selection.allocationAmounts)
        .filter(([unitObjectId, amount]) =>
          targetIds.has(unitObjectId) && Number.isSafeInteger(amount) && amount > 0)
        .map(([unitObjectId, amount]) => ({ unitObjectId, amount }));
      return { type: "assign-combat-damage", choiceId: action.choiceId, assignments };
    }
    default:
      return null;
  }
}

/**
 * Wrap a built command in the tagged P4 packet and re-validate it with the P4
 * command guard. Returns `null` when the guard rejects the payload, so a packet
 * can never reach `onCommand` unverified.
 */
export function buildDuelCommandPacket(
  action: DuelActionV3Actions1,
  selection: DuelActionsSelection,
  pendingChoice: DuelPendingChoiceV3Actions1,
  context: { readonly expectedVersion: number; readonly ids: DuelCommandPacketIds }
): DuelCommandMessageV3Actions1 | null {
  const command = buildDuelCommand(action, selection, pendingChoice);
  if (command === null) return null;
  const packet: DuelCommandMessageV3Actions1 = {
    type: "duel-command",
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: context.ids.requestId,
    commandId: context.ids.commandId,
    expectedVersion: context.expectedVersion,
    command
  };
  return isDuelCommandMessageV3Actions1(packet) ? packet : null;
}

export interface SubmitDuelActionArgs {
  readonly action: DuelActionV3Actions1;
  readonly selection: DuelActionsSelection;
  readonly pendingChoice: DuelPendingChoiceV3Actions1;
  readonly gate: DuelActionsGateState;
  readonly expectedVersion: number;
  readonly ids: DuelCommandPacketIds;
}

/**
 * The exact pure function the submit button uses. Returns the single guarded
 * packet to forward, or `null` when the action is gated or the selection is
 * incomplete. Boundary re-checked here so a render-time race cannot slip through.
 */
export function submitDuelActionSelection(
  args: SubmitDuelActionArgs
): DuelCommandMessageV3Actions1 | null {
  if (resolveDuelActionIssue(args.action, args.selection, args.pendingChoice, args.gate) !== null) {
    return null;
  }
  return buildDuelCommandPacket(args.action, args.selection, args.pendingChoice, {
    expectedVersion: args.expectedVersion,
    ids: args.ids
  });
}

function ownerPendingChoice(projection: DuelProjectionV3Actions1): DuelPendingChoiceV3Actions1 {
  return projection.match.stage === "playing" ? projection.match.frame.pendingChoice : null;
}

function matchEnded(projection: DuelProjectionV3Actions1): boolean {
  return projection.match.stage === "playing" && projection.match.frame.phase === "ended";
}

export function DuelActionsPanelV3({
  projection,
  connectionStatus,
  commandPending,
  showLegacySummary = true,
  onCommand,
  generatePacketIds = defaultPacketIds,
  initialSelection = EMPTY_DUEL_ACTIONS_SELECTION,
  presentation = "panel",
  actionIds,
  resolveCardName,
  cardNameById
}: DuelActionsPanelV3Props) {
  const projectionValid = isDuelProjectionV3Actions1(projection);
  const sceneSignature = duelActionsSceneSignature(projection, connectionStatus);

  const [scene, setScene] = useState(sceneSignature);
  const [selection, setSelection] = useState<DuelActionsSelection>(initialSelection);
  if (scene !== sceneSignature) {
    setScene(sceneSignature);
    setSelection(prev => selectionAfterSceneChange(prev, scene, sceneSignature));
  }

  const statusLabel = DUEL_ACTIONS_STATUS_LABELS[connectionStatus];

  const header = (
    <header className="full-product-duel-actions-head">
      <h3 className="full-product-duel-actions-title">{DUEL_ACTIONS_PANEL_LABEL}</h3>
      <span
        className={`full-product-duel-actions-status is-${connectionStatus}`}
        aria-label={`连接状态：${statusLabel}`}
      >
        {statusLabel}
      </span>
    </header>
  );

  if (!projectionValid) {
    return (
      <section
        className={`full-product-duel-actions${presentation === "card" ? " is-card-mode" : ""}`}
        aria-label={DUEL_ACTIONS_PANEL_LABEL}
      >
        {presentation === "card" ? null : header}
        <p className="full-product-duel-actions-notice" role="status">
          {DUEL_ACTIONS_PROJECTION_INVALID_NOTICE}
        </p>
      </section>
    );
  }

  const gate: DuelActionsGateState = {
    connectionStatus,
    commandPending,
    projectionValid,
    ended: matchEnded(projection)
  };
  const gateReason = duelActionsGateReason(gate);
  const isSpectator = projection.viewerPlayerId === null;
  const pendingChoice = ownerPendingChoice(projection);
  const p4Actions = projection.actions.filter(action => !isLegacyAction(action));
  const legacyActions = projection.actions.filter(isLegacyAction);
  // `actionIds` narrows the server's own action list by id; `[]` yields none
  // (never "all"), and an unmatched id simply contributes no button.
  const visibleActions = actionIds === undefined
    ? p4Actions
    : p4Actions.filter(action => actionIds.includes(action.id));
  // Card mode auto-expands the single filtered parameter action so a clicked or
  // dragged card opens its move/allocation form directly. `initialSelection`
  // still wins whenever it already carries an action id (real drag prefill).
  const cardAutoActionId = presentation === "card" && selection.actionId === null &&
    visibleActions.length === 1 && duelCardActionForm(visibleActions[0]!, pendingChoice) === "params"
    ? visibleActions[0]!.id
    : null;
  const effectiveSelection: DuelActionsSelection = cardAutoActionId === null
    ? selection
    : { ...selection, actionId: cardAutoActionId };
  const selectedAction = visibleActions.find(action => action.id === effectiveSelection.actionId) ?? null;
  const selectedIssue = selectedAction
    ? resolveDuelActionIssue(selectedAction, effectiveSelection, pendingChoice, gate)
    : null;
  const unitLabels = duelUnitLabelById(projection, resolveCardName);
  const locationLabels = duelLocationLabelById(projection);
  const locationName = (locationId: string): string => {
    const label = locationLabels.get(locationId);
    if (label !== undefined) return label;
    const board = playingBoard(projection);
    const field = board?.battlefields.find(entry => entry.locationId === locationId);
    const cardName = field ? cardNameById?.[field.cardId] : undefined;
    return cardName !== undefined && cardName.trim().length > 0
      ? cardName
      : DUEL_ACTIONS_LOCATION_FALLBACK_LABEL;
  };
  // Every render path passes a UID the projection already referenced, so the map
  // always resolves; the generic label only guards a projection gap and never
  // emits the raw object id as player text.
  const unitName = (objectId: string): string =>
    unitLabels.get(objectId) ?? DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX;

  const selectAction = (action: DuelActionV3Actions1) => {
    setSelection(prev => ({ ...prev, actionId: prev.actionId === action.id ? null : action.id }));
  };

  /** Validate one action/selection pair at the boundary, then forward its packet. */
  const submitAction = (action: DuelActionV3Actions1, actionSelection: DuelActionsSelection) => {
    const packet = submitDuelActionSelection({
      action,
      selection: actionSelection,
      pendingChoice,
      gate,
      expectedVersion: projection.match.stateVersion,
      ids: generatePacketIds()
    });
    if (packet === null) return;
    onCommand(packet);
  };

  const submitSelected = () => {
    if (selectedAction === null) return;
    submitAction(selectedAction, effectiveSelection);
  };

  const toggleMoveUnit = (unitUID: string) => {
    setSelection(prev => {
      const has = prev.moveUnitUIDs.includes(unitUID);
      return {
        ...prev,
        actionId: selectedAction?.id ?? prev.actionId,
        moveUnitUIDs: has
          ? prev.moveUnitUIDs.filter(uid => uid !== unitUID)
          : [...prev.moveUnitUIDs, unitUID]
      };
    });
  };

  const setMoveDestination = (locationId: string) => {
    setSelection(prev => ({
      ...prev,
      actionId: selectedAction?.id ?? prev.actionId,
      moveDestinationLocationId: locationId
    }));
  };

  const toggleChoiceOption = (prompt: DuelWireChoicePromptV3Actions1, optionId: string) => {
    setSelection(prev => {
      const current = prev.choiceOptionIds[prompt.promptId] ?? [];
      const has = current.includes(optionId);
      let next: readonly string[];
      if (has) {
        next = current.filter(id => id !== optionId);
      } else if (prompt.maxSelections <= 1) {
        next = [optionId];
      } else if (current.length >= prompt.maxSelections) {
        next = [...current.slice(1), optionId];
      } else {
        next = [...current, optionId];
      }
      return {
        ...prev,
        actionId: selectedAction?.id ?? prev.actionId,
        choiceOptionIds: { ...prev.choiceOptionIds, [prompt.promptId]: next }
      };
    });
  };

  const setAllocation = (unitObjectId: string, raw: string) => {
    setSelection(prev => {
      const amounts = { ...prev.allocationAmounts };
      const parsed = Number.parseInt(raw, 10);
      if (raw.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
        delete amounts[unitObjectId];
      } else {
        amounts[unitObjectId] = parsed;
      }
      return { ...prev, actionId: selectedAction?.id ?? prev.actionId, allocationAmounts: amounts };
    });
  };

  const renderParams = (action: DuelActionV3Actions1) => {
    switch (action.kind) {
      case "standard-move":
        return (
          <div className="full-product-duel-actions-params">
            <p className="full-product-duel-actions-param-title">{DUEL_ACTIONS_MOVE_UNITS_LABEL}</p>
            <div className="full-product-duel-actions-chip-row" role="group" aria-label={DUEL_ACTIONS_MOVE_UNITS_LABEL}>
              {action.selectableUnitUIDs.map(unitUID => {
                const pressed = selection.moveUnitUIDs.includes(unitUID);
                return (
                  <button
                    key={unitUID}
                    type="button"
                    className="full-product-duel-actions-chip"
                    aria-pressed={pressed}
                    disabled={gateReason !== null}
                    onClick={() => toggleMoveUnit(unitUID)}
                  >
                    {unitName(unitUID)}
                  </button>
                );
              })}
            </div>
            <p className="full-product-duel-actions-param-title">{DUEL_ACTIONS_MOVE_DEST_LABEL}</p>
            <div className="full-product-duel-actions-chip-row" role="group" aria-label={DUEL_ACTIONS_MOVE_DEST_LABEL}>
              {action.destinations.map(destination => {
                const pressed = selection.moveDestinationLocationId === destination.locationId;
                return (
                  <button
                    key={destination.locationId}
                    type="button"
                    className="full-product-duel-actions-chip"
                    aria-pressed={pressed}
                    disabled={gateReason !== null}
                    onClick={() => setMoveDestination(destination.locationId)}
                  >
                    {locationName(destination.locationId)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "answer-pending-choice": {
        const owner = ownerChoiceFor(pendingChoice, action.choiceId);
        if (!owner || (owner.kind !== "play-choices" && owner.kind !== "effect-choices")) {
          return <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE}</p>;
        }
        return (
          <div className="full-product-duel-actions-params">
            {owner.prompts.map(prompt => (
              <div key={prompt.promptId} className="full-product-duel-actions-prompt">
                <p className="full-product-duel-actions-param-title">
                  {`${duelPromptTitle(prompt, owner.prompts)}（选 ${prompt.minSelections}-${prompt.maxSelections}）`}
                </p>
                {prompt.options.length === 0 ? (
                  <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_NO_OPTIONS_NOTICE}</p>
                ) : (
                  <div className="full-product-duel-actions-chip-row" role="group" aria-label={duelPromptTitle(prompt, owner.prompts)}>
                    {prompt.options.map(option => {
                      const pressed = (selection.choiceOptionIds[prompt.promptId] ?? []).includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className="full-product-duel-actions-chip"
                          aria-pressed={pressed}
                          disabled={gateReason !== null}
                          onClick={() => toggleChoiceOption(prompt, option.id)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      }
      case "assign-combat-damage": {
        const owner = ownerChoiceFor(pendingChoice, action.choiceId);
        if (!owner || owner.kind !== "combat-allocation") {
          return <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE}</p>;
        }
        return (
          <div className="full-product-duel-actions-params">
            <p className="full-product-duel-actions-param-title">
              {`${DUEL_ACTIONS_ALLOCATION_BUDGET_LABEL}：${owner.budget}`}
            </p>
            <ul className="full-product-duel-actions-targets" aria-label={DUEL_ACTIONS_ALLOCATION_TARGETS_LABEL}>
              {owner.targets.map(target => (
                <li key={target.unitObjectId} className="full-product-duel-actions-target">
                  <span className="full-product-duel-actions-target-id">{unitName(target.unitObjectId)}</span>
                  <span className="full-product-duel-actions-target-lethal">{`致死需求 ${target.lethalNeed}`}</span>
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    className="full-product-duel-actions-target-input"
                    aria-label={`分配给 ${unitName(target.unitObjectId)} 的数量`}
                    value={selection.allocationAmounts[target.unitObjectId] ?? ""}
                    disabled={gateReason !== null}
                    onChange={event => setAllocation(target.unitObjectId, event.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      }
      default:
        return null;
    }
  };

  if (presentation === "card") {
    return (
      <section
        className="full-product-duel-actions is-card-mode"
        aria-label={DUEL_ACTIONS_PANEL_LABEL}
      >
        {isSpectator ? (
          <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_SPECTATOR_NOTICE}</p>
        ) : null}

        {!isSpectator && gateReason !== null ? (
          <p className="full-product-duel-actions-notice" role="status">{gateReason}</p>
        ) : null}

        {!isSpectator && pendingChoice !== null && !("choiceId" in pendingChoice) ? (
          <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_WAITING_CHOICE_NOTICE}</p>
        ) : null}

        {!isSpectator ? (
          <div className="full-product-duel-actions-list" aria-label={DUEL_ACTIONS_LIST_LABEL}>
            {visibleActions.length === 0 ? (
              <p className="full-product-duel-actions-empty">{DUEL_ACTIONS_NO_ACTIONS_NOTICE}</p>
            ) : (
              visibleActions.map(action => {
                const disabledReason = actionDisabledReason(action, gate, pendingChoice);
                const disabledReasonDisplay = disabledReason === null
                  ? null
                  : duelActionDisabledReasonDisplay(disabledReason, action, projection);
                const displayLabel = duelActionDisplayLabel(action, projection, resolveCardName);
                const form = duelCardActionForm(action, pendingChoice);

                if (form === "immediate") {
                  // No user-chosen parameter: one click validates + submits the
                  // same guarded packet the panel's confirm would have built.
                  const immediateSelection: DuelActionsSelection = { ...selection, actionId: action.id };
                  const immediateIssue = resolveDuelActionIssue(action, immediateSelection, pendingChoice, gate);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className="full-product-duel-actions-action is-direct"
                      aria-label={displayLabel}
                      disabled={disabledReason !== null || immediateIssue !== null}
                      title={disabledReasonDisplay ?? immediateIssue ?? displayLabel}
                      onClick={() => submitAction(action, immediateSelection)}
                    >
                      {displayLabel}
                    </button>
                  );
                }

                if (form === "choice-options" && action.kind === "answer-pending-choice") {
                  const owner = ownerChoiceFor(pendingChoice, action.choiceId);
                  const prompt = owner && (owner.kind === "play-choices" || owner.kind === "effect-choices")
                    ? owner.prompts[0]
                    : undefined;
                  if (prompt === undefined) {
                    return null;
                  }
                  const title = duelPromptTitle(prompt, [prompt]);
                  return (
                    <div key={action.id} className="full-product-duel-actions-card-choice">
                      <p className="full-product-duel-actions-param-title">{displayLabel}</p>
                      <div className="full-product-duel-actions-chip-row" role="group" aria-label={title}>
                        {prompt.options.map(option => {
                          // Each real option answers the complete prompt list, so a
                          // required/optional extra-cost prompt keeps its semantics.
                          const optionSelection = duelCardOptionSelection(action, prompt, option.id, selection);
                          const optionIssue = resolveDuelActionIssue(action, optionSelection, pendingChoice, gate);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className="full-product-duel-actions-chip"
                              aria-label={`${displayLabel}：${option.label}`}
                              disabled={disabledReason !== null || optionIssue !== null}
                              title={disabledReasonDisplay ?? optionIssue ?? option.label}
                              onClick={() => submitAction(action, optionSelection)}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const selectedForAction = effectiveSelection.actionId === action.id;
                return (
                  <div
                    key={action.id}
                    className={`full-product-duel-actions-item${selectedForAction ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="full-product-duel-actions-action"
                      aria-label={displayLabel}
                      aria-pressed={selectedForAction}
                      disabled={disabledReason !== null}
                      title={disabledReasonDisplay ?? displayLabel}
                      onClick={() => selectAction(action)}
                    >
                      {displayLabel}
                    </button>
                    {disabledReason !== null ? (
                      <span className="full-product-duel-actions-reason">{disabledReasonDisplay}</span>
                    ) : null}
                    {selectedForAction ? (
                      <>
                        {renderParams(action)}
                        <div className="full-product-duel-actions-submit-row">
                          <button
                            type="button"
                            className="full-product-duel-actions-submit"
                            aria-label={`${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}${displayLabel}`}
                            disabled={selectedIssue !== null}
                            title={selectedIssue ?? undefined}
                            onClick={submitSelected}
                          >
                            {DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}
                          </button>
                          {selectedIssue !== null ? (
                            <span className="full-product-duel-actions-reason">{selectedIssue}</span>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="full-product-duel-actions" aria-label={DUEL_ACTIONS_PANEL_LABEL}>
      {header}

      {isSpectator ? (
        <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_SPECTATOR_NOTICE}</p>
      ) : null}

      {!isSpectator && gateReason !== null ? (
        <p className="full-product-duel-actions-notice" role="status">{gateReason}</p>
      ) : null}

      {!isSpectator && pendingChoice !== null && !("choiceId" in pendingChoice) ? (
        <p className="full-product-duel-actions-notice" role="status">{DUEL_ACTIONS_WAITING_CHOICE_NOTICE}</p>
      ) : null}

      {!isSpectator ? (
        <div className="full-product-duel-actions-list" aria-label={DUEL_ACTIONS_LIST_LABEL}>
          {visibleActions.length === 0 ? (
            <p className="full-product-duel-actions-empty">{DUEL_ACTIONS_NO_ACTIONS_NOTICE}</p>
          ) : (
            visibleActions.map(action => {
              const disabledReason = actionDisabledReason(action, gate, pendingChoice);
              const disabledReasonDisplay = disabledReason === null
                ? null
                : duelActionDisabledReasonDisplay(disabledReason, action, projection);
              const selected = selection.actionId === action.id;
              // Display-only: an own-hand `play-card` shows the resolved card name.
              const displayLabel = duelActionDisplayLabel(action, projection, resolveCardName);
              return (
                <div
                  key={action.id}
                  className={`full-product-duel-actions-item${selected ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="full-product-duel-actions-action"
                    aria-label={displayLabel}
                    aria-pressed={selected}
                    disabled={disabledReason !== null}
                    title={disabledReasonDisplay ?? displayLabel}
                    onClick={() => selectAction(action)}
                  >
                    {displayLabel}
                  </button>
                  {disabledReason !== null ? (
                    <span className="full-product-duel-actions-reason">{disabledReasonDisplay}</span>
                  ) : null}
                  {selected ? (
                    <>
                      {renderParams(action)}
                      <div className="full-product-duel-actions-submit-row">
                        <button
                          type="button"
                          className="full-product-duel-actions-submit"
                          aria-label={`${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}${displayLabel}`}
                          disabled={selectedIssue !== null}
                          title={selectedIssue ?? undefined}
                          onClick={submitSelected}
                        >
                          {DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}
                        </button>
                        {selectedIssue !== null ? (
                          <span className="full-product-duel-actions-reason">{selectedIssue}</span>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {showLegacySummary && !isSpectator && legacyActions.length > 0 ? (
        <div className="full-product-duel-actions-legacy" aria-label={DUEL_ACTIONS_LEGACY_NOTE}>
          <p className="full-product-duel-actions-param-title">{DUEL_ACTIONS_LEGACY_NOTE}</p>
          <ul className="full-product-duel-actions-legacy-list">
            {legacyActions.map(action => (
              <li key={action.id} className="full-product-duel-actions-legacy-item">
                <span className="full-product-duel-actions-legacy-label">{action.label}</span>
                <span className="full-product-duel-actions-legacy-kind">{action.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
