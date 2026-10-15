import type {
  DuelActionV3Actions1,
  DuelFrameV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

/**
 * Pure presentation seam for the public Duel Chain/window strip.
 *
 * NOT a wire contract and NOT an authority. It reads exactly one authoritative
 * {@link DuelProjectionV3Actions1} and reports a Chinese timing hint plus the
 * viewer's own, server-enabled `play-card` UIDs. It never re-derives a rule,
 * never reads card text/tags, never opens a card because of a printed
 * `Reaction` label, and never invents a timing window the server did not
 * project. A card is "playable" here *only* because the server marked its
 * `play-card` action `enabled`.
 *
 * Signals are evaluated in a fail-closed precedence that keeps an unpaid or
 * unresolved Chain from being chained, auto-declined or double-paid:
 *   ended -> pending payment -> pending choice -> Chain with a still-pending
 *   item -> finalized active Chain -> pending execution -> observable
 *   focus/combat -> closed state -> open Main Phase.
 * While a payment or a choice is outstanding the surface reports no playable
 * UID, so nothing downstream of an unfinished item is exposed. A Chain whose
 * public `pendingCount` is above zero is still completing an item (354 ->
 * 359), so it is not an opponent-declare Execute window: `active` alone is not
 * enough to announce a response, even when a contradictory projection carries an
 * `enabled` play/pass.
 *
 * The observable focus/combat step reads only (a) the viewer's own, server
 * `enabled` `pass-focus` action and (b) the public `board.battlefields`
 * `showdown`/`combat` status plus an owner-visible pending choice. It never
 * infers an actor from `turnPlayerId`/`focusPlayerId`, never guesses a hidden
 * choice's owner or options, and never leaks a budget/target to a non-owner.
 */

export const DUEL_WINDOW_STATUS_LABEL = "时点提示";

/** Player-facing status labels. */
export const DUEL_WINDOW_STATUS_PAYMENT = "正在支付施放费用";
export const DUEL_WINDOW_STATUS_CHOICE = "等待玩家选择";
export const DUEL_WINDOW_STATUS_PENDING_ITEM = "正在完成出牌";
export const DUEL_WINDOW_STATUS_CHAIN = "可连锁时点";
export const DUEL_WINDOW_STATUS_OPPONENT = "等待对手响应";
export const DUEL_WINDOW_STATUS_FOCUS = "对决焦点";
export const DUEL_WINDOW_STATUS_SHOWDOWN_WAIT = "对决进行中";
export const DUEL_WINDOW_STATUS_COMBAT_ALLOCATION = "战斗伤害分配";
export const DUEL_WINDOW_STATUS_COMBAT_WAIT = "战斗进行中";
export const DUEL_WINDOW_STATUS_RESOLVING = "结算中";
export const DUEL_WINDOW_STATUS_WAITING = "等待规则处理";
export const DUEL_WINDOW_STATUS_MAIN = "主阶段";
export const DUEL_WINDOW_STATUS_ENDED = "对局结束";
export const DUEL_WINDOW_STATUS_NOT_STARTED = "准备阶段";

/** Detail copy. Viewer guidance only; it asserts no rule verdict of its own. */
export const DUEL_WINDOW_STATUS_DETAIL_PAYMENT = "请先完成当前费用支付，后续操作以牌桌更新为准。";
export const DUEL_WINDOW_STATUS_DETAIL_CHOICE = "请完成当前选择以继续结算。";
export const DUEL_WINDOW_STATUS_DETAIL_PENDING_ITEM = "当前出牌尚未完成，可用操作以动作面板/牌桌更新为准。";
export const DUEL_WINDOW_STATUS_DETAIL_CHAIN = "你可以追加连锁，或让过优先权。";
export const DUEL_WINDOW_STATUS_DETAIL_OPPONENT = "对手持有优先权，等待其响应。";
export const DUEL_WINDOW_STATUS_DETAIL_FOCUS = "你可以让过焦点，推进当前对决。";
export const DUEL_WINDOW_STATUS_DETAIL_SHOWDOWN_WAIT = "对手正在处理当前对决，等待其完成。";
export const DUEL_WINDOW_STATUS_DETAIL_COMBAT_ALLOCATION = "请完成战斗伤害分配以继续结算。";
export const DUEL_WINDOW_STATUS_DETAIL_COMBAT_WAIT = "当前战斗仍在进行，请等待对手操作。";
export const DUEL_WINDOW_STATUS_DETAIL_RESOLVING = "连锁正在结算，请稍候。";
export const DUEL_WINDOW_STATUS_DETAIL_MAIN = "主阶段，可用操作以当前动作面板为准。";
export const DUEL_WINDOW_STATUS_DETAIL_ENDED = "对局已结束。";
export const DUEL_WINDOW_STATUS_DETAIL_NOT_STARTED = "对局尚未进入可操作阶段。";

/** Reuses the client's existing phase vocabulary; no new rule meaning is added. */
export const DUEL_WINDOW_STATUS_PHASE_LABELS: Readonly<Record<DuelFrameV3Actions1["phase"], string>> = {
  "awaiting-turn-start": "等待回合开始",
  awaken: "觉醒",
  beginning: "开始",
  scoring: "计分",
  channel: "引导",
  draw: "抽牌",
  main: DUEL_WINDOW_STATUS_MAIN,
  ending: "结束",
  expiration: "失效",
  ended: DUEL_WINDOW_STATUS_ENDED
};

export interface DuelWindowStatusModel {
  readonly label: string;
  readonly detail: string;
  /**
   * True only when the viewer holds a real, server-projected response: an active
   * Chain priority with a legal play/pass, or an own enabled `pass-focus` window.
   * It is a viewer-guidance flag, never a legality verdict of its own.
   */
  readonly responseAvailable: boolean;
  /** Viewer's own enabled `play-card` action UIDs, in server order. Never enemy hand or chain copies. */
  readonly playableCardUIDs: readonly string[];
}

export interface DuelWindowStatusProps {
  readonly projection: DuelProjectionV3Actions1;
}

/** Own, enabled `play-card` action card UIDs — the only source of a playable card here. */
function enabledPlayCardUIDs(actions: readonly DuelActionV3Actions1[]): readonly string[] {
  const uids: string[] = [];
  for (const action of actions) {
    if (action.kind === "play-card" && action.enabled && !uids.includes(action.cardUID)) uids.push(action.cardUID);
  }
  return uids;
}

function hasEnabledPassPriority(actions: readonly DuelActionV3Actions1[]): boolean {
  return actions.some(action => action.kind === "pass-priority" && action.enabled);
}

/**
 * The viewer's own, server-enabled `pass-focus` — the only signal that the
 * viewer is the acting player of the current duel focus window. The helper never
 * infers the focus actor from `turnPlayerId`/`focusPlayerId`.
 */
function hasEnabledPassFocus(actions: readonly DuelActionV3Actions1[]): boolean {
  return actions.some(action => action.kind === "pass-focus" && action.enabled);
}

/** Public, engagement-only facts the board exposes; nothing viewer-private. */
interface PublicDuelEngagement {
  readonly combat: boolean;
}

/**
 * Read the single public battlefield whose `showdown`/`combat` is `active`, or
 * `null` when the board exposes none. This is the only public engagement signal
 * available to a non-owner; it never names the acting player, a choice, or a
 * budget/target. Fails closed on an unexpected board shape.
 */
function publicActiveEngagement(projection: DuelProjectionV3Actions1): PublicDuelEngagement | null {
  const match = projection.match;
  if (match.stage !== "playing") return null;
  const board = match.board as unknown;
  if (board === null || typeof board !== "object" || Array.isArray(board)) return null;
  const battlefields = (board as { battlefields?: unknown }).battlefields;
  if (!Array.isArray(battlefields)) return null;
  let showdownSeen = false;
  for (const field of battlefields) {
    if (field === null || typeof field !== "object" || Array.isArray(field)) continue;
    const combat = (field as { combat?: unknown }).combat === "active";
    const showdown = (field as { showdown?: unknown }).showdown === "active";
    if (combat) return { combat: true };
    if (showdown) showdownSeen = true;
  }
  return showdownSeen ? { combat: false } : null;
}

function model(
  label: string,
  detail: string,
  responseAvailable: boolean,
  playableCardUIDs: readonly string[]
): DuelWindowStatusModel {
  return { label, detail, responseAvailable, playableCardUIDs };
}

/**
 * Derive the Chain/window hint for one public P4 projection. Fails closed: any
 * state the helper cannot read as an actionable window yields an inert status
 * with no playable UIDs.
 */
export function describeDuelWindowStatus(projection: DuelProjectionV3Actions1): DuelWindowStatusModel {
  const match = projection.match;
  if (match.stage !== "playing") {
    return model(DUEL_WINDOW_STATUS_NOT_STARTED, DUEL_WINDOW_STATUS_DETAIL_NOT_STARTED, false, []);
  }

  const viewer = projection.viewerPlayerId;
  const actions = Array.isArray(projection.actions) ? projection.actions : [];
  const frame = match.frame;

  if (frame.phase === "ended") {
    return model(DUEL_WINDOW_STATUS_ENDED, DUEL_WINDOW_STATUS_DETAIL_ENDED, false, []);
  }

  // An outstanding payment (own detail, or another actor's generic pending)
  // blocks every downstream Chain window until it is paid.
  if (frame.pendingPayment !== null) {
    return model(DUEL_WINDOW_STATUS_PAYMENT, DUEL_WINDOW_STATUS_DETAIL_PAYMENT, false, []);
  }

  // An owner choice likewise must complete before priority can move on. A choice
  // the server projected to the viewer as its own combat allocation is labelled
  // as such; any other owner/hidden choice stays the generic waiting label, so a
  // hidden owner or option set is never guessed.
  if (frame.pendingChoice !== null) {
    if ("kind" in frame.pendingChoice && frame.pendingChoice.kind === "combat-allocation") {
      return model(DUEL_WINDOW_STATUS_COMBAT_ALLOCATION, DUEL_WINDOW_STATUS_DETAIL_COMBAT_ALLOCATION, false, []);
    }
    return model(DUEL_WINDOW_STATUS_CHOICE, DUEL_WINDOW_STATUS_DETAIL_CHOICE, false, []);
  }

  // An active Chain with a still-pending item (354 -> 359) is completing an
  // CardPlay, NOT an Execute window others may chain into. This is decided from
  // the public `pendingCount` alone: a contradictory projection that also marks
  // an own play/pass `enabled` is not allowed to promote it to a response, so no
  // viewer — owner, opponent, spectator — is handed a playable UID here.
  if (frame.chain.active === true && frame.chain.pendingCount > 0) {
    return model(DUEL_WINDOW_STATUS_PENDING_ITEM, DUEL_WINDOW_STATUS_DETAIL_PENDING_ITEM, false, []);
  }

  if (frame.chain.active === true) {
    const ownPriority = viewer !== null && frame.priorityPlayerId === viewer;
    const legalResponse = ownPriority && (hasEnabledPassPriority(actions) || enabledPlayCardUIDs(actions).length > 0);
    if (legalResponse) {
      return model(DUEL_WINDOW_STATUS_CHAIN, DUEL_WINDOW_STATUS_DETAIL_CHAIN, true, enabledPlayCardUIDs(actions));
    }
    if (frame.priorityPlayerId === null)
      return model(DUEL_WINDOW_STATUS_RESOLVING, DUEL_WINDOW_STATUS_DETAIL_RESOLVING, false, []);
    // Priority is not the viewer's: wait for the opponent's response.
    if (!ownPriority) {
      return model(DUEL_WINDOW_STATUS_OPPONENT, DUEL_WINDOW_STATUS_DETAIL_OPPONENT, false, []);
    }
    // Priority is the viewer's but no legal play/pass is projected: fail closed to resolving.
    return model(DUEL_WINDOW_STATUS_RESOLVING, DUEL_WINDOW_STATUS_DETAIL_RESOLVING, false, []);
  }

  // A genuine pending execution still reports "waiting for the rules"; an
  // observable duel/combat field must not paper over unresolved processing.
  if (frame.execution.status === "pending") {
    return model(DUEL_WINDOW_STATUS_WAITING, "当前规则仍有待处理项，请等待牌桌更新。", false, []);
  }

  // Observable duel focus / combat. The only own signal is a server-enabled
  // `pass-focus`; otherwise the public `showdown`/`combat` status says a duel is
  // under way. A non-owner is never handed a hidden choice, a budget or a target.
  const engagement = publicActiveEngagement(projection);
  if (engagement !== null) {
    if (viewer !== null && hasEnabledPassFocus(actions)) {
      return model(DUEL_WINDOW_STATUS_FOCUS, DUEL_WINDOW_STATUS_DETAIL_FOCUS, true, []);
    }
    if (engagement.combat) {
      return model(DUEL_WINDOW_STATUS_COMBAT_WAIT, DUEL_WINDOW_STATUS_DETAIL_COMBAT_WAIT, false, []);
    }
    return model(DUEL_WINDOW_STATUS_SHOWDOWN_WAIT, DUEL_WINDOW_STATUS_DETAIL_SHOWDOWN_WAIT, false, []);
  }

  // A closed state the board does not explain as an observable duel still fails
  // closed to "waiting for the rules".
  if (!frame.stateOpen) {
    return model(DUEL_WINDOW_STATUS_WAITING, "当前规则仍有待处理项，请等待牌桌更新。", false, []);
  }

  if (frame.phase === "main") {
    return model(DUEL_WINDOW_STATUS_MAIN, DUEL_WINDOW_STATUS_DETAIL_MAIN, false, enabledPlayCardUIDs(actions));
  }

  // Any other phase (awaken/beginning/channel/draw/ending/expiration) carries
  // no Chain window of its own; report the phase label with an inert detail.
  const phaseLabel = DUEL_WINDOW_STATUS_PHASE_LABELS[frame.phase];
  return model(phaseLabel ?? DUEL_WINDOW_STATUS_NOT_STARTED, DUEL_WINDOW_STATUS_DETAIL_NOT_STARTED, false, []);
}

/**
 * Read-only Chinese timing strip. Renders one label/detail pair and, in a legal
 * Chain window, one inert marker per own enabled `play-card` action. It exposes
 * no click handler: the authoritative actions panel stays the only command
 * surface, so this component can never submit a payment, a choice or a play.
 */
export function DuelWindowStatus({ projection }: DuelWindowStatusProps) {
  const status = describeDuelWindowStatus(projection);
  return (
    <section
      className="full-product-duel-window-status"
      aria-label={DUEL_WINDOW_STATUS_LABEL}
      data-response-available={status.responseAvailable ? "true" : "false"}
    >
      <span className="full-product-duel-window-status-label">{status.label}</span>
      <span className="full-product-duel-window-status-detail">{status.detail}</span>
      {status.playableCardUIDs.length > 0 ? (
        <ul className="full-product-duel-window-status-playable-list">
          {status.playableCardUIDs.map(uid => (
            <li key={uid} className="full-product-duel-window-status-playable" data-card-uid={uid}>
              可出牌
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
