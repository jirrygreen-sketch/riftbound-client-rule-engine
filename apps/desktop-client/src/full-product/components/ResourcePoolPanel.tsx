import "./ResourcePoolPanel.css";

import type { ReactElement } from "react";

/**
 * Display-only contract for the duel resource pool.
 *
 * These types are a local presentation seam, NOT a wire contract. The parent
 * task's adapter will map the authoritative public Duel projection onto this
 * exact shape. The panel never invents resources, never optimistically mutates
 * a balance, and never derives a command: every "+"/"-"/"获取资源" entry only
 * forwards an action id to `onAction`, and only when that id is a real, enabled
 * action supplied by the upper layer *and* the current gate is open.
 */
export type ResourcePoolStatus =
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "waiting";

export interface ResourceCounterView {
  /** Authoritative, non-negative safe integer. Rendered verbatim, never guessed. */
  readonly amount: number;
  /** Action ids supplied by the upper layer; absent means "no entry". */
  readonly increaseActionId?: string;
  readonly decreaseActionId?: string;
}

export interface ResourcePowerView {
  /** Adapter-owned identity (domain id or "any"); never hardcoded here. */
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly increaseActionId?: string;
  readonly decreaseActionId?: string;
}

export interface ResourceActionView {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly enabled: boolean;
  readonly blockedReason?: string;
  /**
   * Optional, display-only provenance hint. When the upper layer tags a legal
   * source as a base rune or a gold token, the panel groups the buttons under a
   * 符文 / 金币 heading so the two spend paths are told apart at a glance. The
   * panel never infers the kind, and grouping changes neither the forwarded
   * action id nor the gate. Absent means "ungrouped": the list renders flat,
   * exactly as before.
   */
  readonly sourceKind?: "rune" | "gold";
}

/** Optional, display-only payment preview. It must never deduct anything. */
export interface ResourcePaymentSummaryView {
  readonly label?: string;
  readonly energyCost?: number;
  readonly powerCosts?: readonly {
    readonly label: string;
    readonly amount: number;
  }[];
}

export interface ResourcePoolPanelProps {
  readonly energy: ResourceCounterView;
  /**
   * Six domains + universal power, all provided by the adapter. The panel does
   * NOT hardcode a domain list or merge anything into a fabricated "any" bucket.
   */
  readonly powers: readonly ResourcePowerView[];
  /** Upper-layer-provided legal "获取资源" sources (runes / gold). */
  readonly sourceActions: readonly ResourceActionView[];
  /** Upper-layer-provided counters. Same shape as sources. */
  readonly counterActions?: readonly ResourceActionView[];
  readonly status: ResourcePoolStatus;
  readonly commandPending: boolean;
  readonly ended: boolean;
  readonly onAction: (actionId: string) => void;
  readonly paymentSummary?: ResourcePaymentSummaryView;
  /**
   * Optional dense presentation for the Duel table row.
   *
   * Defaults to `false`, which keeps the original full-height panel markup
   * byte-for-byte. When `true` the panel renders two headline totals (energy
   * and the summed power), one chip per supplied power category, and a
   * collapsible source/detail area, so a full-height pool never squeezes the
   * central battlefields. The power total only reuses the validated
   * `validateResourceCounts` sum; it is never merged into a payable bucket.
   * Gate, action and count rules are unchanged: the dense view still fails
   * closed, still forwards only supplied and enabled action ids, and never
   * deducts anything.
   */
  readonly compact?: boolean;
  /**
   * Optional, local-only replay flag. Defaults to `false` and preserves every
   * existing caller byte-for-byte. When `true` the pool renders as read-only
   * with replay wording ("回放只读" / "回放视角，资源池只读") instead of
   * claiming a connection state or "指令处理中", and every entry is gated
   * exactly like the pending / ended cases. It is a presentation-only input:
   * it never mutates a count, a payment preview or a wire action.
   */
  readonly readOnly?: boolean;
}

export const RESOURCE_POOL_INCOMPLETE_NOTICE = "资源投影不完整，资源池已只读";
export const NO_SOURCE_ACTIONS_NOTICE = "暂无可用来源";
export const NO_STEP_ACTION_REASON = "无可用操作";
export const ACTION_NOT_PROVIDED_REASON = "该操作未由上层提供";
export const ACTION_BLOCKED_FALLBACK = "该操作当前不可用";
export const RETENTION_NOTE = "余额在本回合保留，回合结束时清空";
export const RETENTION_HINT = "主阶段开始时同样清空资源池。";
export const PAYMENT_DISPLAY_ONLY_NOTE = "仅展示，不会自动扣减";

/** Dense-view wording. Plain player language only; no implementation jargon. */
export const COMPACT_RESOURCE_INCOMPLETE_NOTICE = "资源数据不完整，本区只读";
export const COMPACT_ACTION_BLOCKED_FALLBACK = "该操作当前不可用";
export const COMPACT_DETAILS_LABEL = "查看详情";

/**
 * Plain-language reminder that the shown balance and pending cost are the
 * authoritative server projection for the current chained / payment step, and
 * that spending is only ever the job of a supplied, enabled action. Display-only:
 * it never changes a count, a gate, a command or the payment summary.
 */
export const PAYMENT_PHASE_NOTE = "连锁/支付阶段：余额与待付费用以服务器数据为准。";
/**
 * Replay wording. A paused replay frame is read-only because it is a recording,
 * not because a command is in flight or a link is down, so the notice never
 * claims "处理中" or a connection state.
 */
export const REPLAY_RESOURCE_READONLY_NOTICE = "回放视角，资源池只读";
export const REPLAY_COMPACT_RESOURCE_READONLY_NOTICE = "回放视角，本区只读";
export const REPLAY_RESOURCE_STATUS_LABEL = "回放只读";
export const SOURCE_GROUP_RUNE_LABEL = "符文";
export const SOURCE_GROUP_GOLD_LABEL = "金币";

const INVALID_AMOUNT = "—";

export interface ResourceGateState {
  readonly status: ResourcePoolStatus;
  readonly commandPending: boolean;
  readonly ended: boolean;
  /** False when any authoritative count failed validation (fail closed). */
  readonly projectionComplete: boolean;
  /**
   * True for a replay / recorded frame. Optional and defaulting to `false` so
   * every existing caller and gate object keeps its exact behavior; when set it
   * wins over the connection/ended/pending wording, because a recording is
   * read-only for a different reason.
   */
  readonly readOnly?: boolean;
}

/**
 * Single source of truth for "is any resource interaction allowed?".
 *
 * Returns `null` when the pool is interactive, otherwise a human-readable
 * Chinese reason. `projectionComplete: false` wins over everything so a broken
 * projection can never be papered over by an otherwise "connected" status.
 */
export function resourceGateReason(state: ResourceGateState): string | null {
  if (!state.projectionComplete) return RESOURCE_POOL_INCOMPLETE_NOTICE;
  if (state.readOnly) return REPLAY_RESOURCE_READONLY_NOTICE;
  if (state.ended) return "对局已结束，资源池只读";
  switch (state.status) {
    case "disconnected":
      return "连接已断开，资源池只读";
    case "reconnecting":
      return "正在重连，资源池只读";
    case "waiting":
      return "等待其他玩家，资源池只读";
    case "connected":
      break;
  }
  if (state.commandPending) return "指令处理中，资源池只读";
  return null;
}

/**
 * Dense-view counterpart of {@link resourceGateReason}.
 *
 * Same precedence and same fail-closed behavior, but the wording stays in plain
 * player language ("本区只读" instead of the fuller panel's wording) so no
 * implementation vocabulary leaks into the tight Duel table row.
 */
export function compactResourceNotice(state: ResourceGateState): string | null {
  if (!state.projectionComplete) return COMPACT_RESOURCE_INCOMPLETE_NOTICE;
  if (state.readOnly) return REPLAY_COMPACT_RESOURCE_READONLY_NOTICE;
  if (state.ended) return "对局已结束，本区只读";
  switch (state.status) {
    case "disconnected":
      return "连接已断开，本区只读";
    case "reconnecting":
      return "正在重连，本区只读";
    case "waiting":
      return "等待其他玩家，本区只读";
    case "connected":
      break;
  }
  if (state.commandPending) return "指令处理中，本区只读";
  return null;
}

export function isValidResourceAmount(value: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export interface ResourceProjectionValidation {
  readonly complete: boolean;
  readonly messages: readonly string[];
  /** Sum of every provided power; 0 when the projection is incomplete. */
  readonly powerTotal: number;
}

/**
 * Validate the authoritative counts. A single bad count fails the whole
 * projection so the panel never renders NaN/negatives and never hides a broken
 * power behind a plausible-looking total.
 */
export function validateResourceCounts(
  energy: ResourceCounterView,
  powers: readonly ResourcePowerView[]
): ResourceProjectionValidation {
  const messages: string[] = [];
  if (!isValidResourceAmount(energy.amount)) {
    messages.push("能量数值无效（投影不完整）");
  }
  let total = 0;
  let powersValid = true;
  for (const power of powers) {
    if (!isValidResourceAmount(power.amount)) {
      messages.push(`符能「${power.label}」数值无效（投影不完整）`);
      powersValid = false;
      continue;
    }
    total += power.amount;
  }
  if (powersValid && !Number.isSafeInteger(total)) {
    messages.push("符能合计超出安全整数范围（投影不完整）");
    powersValid = false;
  }
  const complete = messages.length === 0;
  return { complete, messages, powerTotal: complete ? total : 0 };
}

/** Look up action ids across both upper-layer lists (sources first, deduped). */
export function combineResourceActions(
  sourceActions: readonly ResourceActionView[],
  counterActions: readonly ResourceActionView[] = []
): readonly ResourceActionView[] {
  const seen = new Set<string>();
  const combined: ResourceActionView[] = [];
  for (const action of [...sourceActions, ...counterActions]) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    combined.push(action);
  }
  return combined;
}

/** A display-only grouping of the supplied sources by their tagged provenance. */
export interface ResourceSourceGroup {
  readonly kind: "rune" | "gold" | "all";
  readonly label: string;
  readonly actions: readonly ResourceActionView[];
}

/**
 * Split the supplied sources into 符文 / 金币 groups when the upper layer tagged
 * them. When no action carries a `sourceKind`, the whole list is returned as one
 * unnamed group so the markup stays flat and the original order is preserved.
 * The grouping never reorders tagged actions and never drops one.
 */
export function groupResourceSources(
  sources: readonly ResourceActionView[]
): readonly ResourceSourceGroup[] {
  if (sources.length === 0) return [];
  const hasKind = sources.some(action => action.sourceKind !== undefined);
  if (!hasKind) return [{ kind: "all", label: "", actions: sources }];
  const runes = sources.filter(action => action.sourceKind === "rune");
  const gold = sources.filter(action => action.sourceKind === "gold");
  const untagged = sources.filter(action => action.sourceKind === undefined);
  const groups: ResourceSourceGroup[] = [];
  if (runes.length > 0) {
    groups.push({ kind: "rune", label: SOURCE_GROUP_RUNE_LABEL, actions: runes });
  }
  if (gold.length > 0) {
    groups.push({ kind: "gold", label: SOURCE_GROUP_GOLD_LABEL, actions: gold });
  }
  if (untagged.length > 0) {
    groups.push({ kind: "all", label: "", actions: untagged });
  }
  return groups;
}

export function findResourceAction(
  actions: readonly ResourceActionView[],
  actionId: string | undefined
): ResourceActionView | null {
  if (!actionId) return null;
  return actions.find(action => action.id === actionId) ?? null;
}

/**
 * Resolve the action id that may actually be dispatched, or `null` when the
 * request would exceed the panel's authority. This is the exact guard the
 * click handlers use, so a disabled/unknown/gated button can never fire
 * `onAction` — the panel cannot fabricate a command from `onAction` alone.
 */
export function resolveResourceActionRequest(
  actionId: string | undefined,
  actions: readonly ResourceActionView[],
  gate: ResourceGateState
): string | null {
  if (!actionId) return null;
  if (resourceGateReason(gate) !== null) return null;
  const action = findResourceAction(actions, actionId);
  if (!action || !action.enabled) return null;
  return actionId;
}

/** Disabled reason for a +/- entry, or `null` when it may be pressed. */
export function describeStepDisabledReason(
  actionId: string | undefined,
  actions: readonly ResourceActionView[],
  gate: ResourceGateState
): string | null {
  if (!actionId) return NO_STEP_ACTION_REASON;
  const gateReason = resourceGateReason(gate);
  if (gateReason) return gateReason;
  const action = findResourceAction(actions, actionId);
  if (!action) return ACTION_NOT_PROVIDED_REASON;
  if (!action.enabled) return action.blockedReason ?? ACTION_BLOCKED_FALLBACK;
  return null;
}

/** Disabled reason for a listed action button, or `null` when it may be pressed. */
export function describeActionDisabledReason(
  action: ResourceActionView,
  gate: ResourceGateState
): string | null {
  const gateReason = resourceGateReason(gate);
  if (gateReason) return gateReason;
  if (!action.enabled) return action.blockedReason ?? ACTION_BLOCKED_FALLBACK;
  return null;
}

const STATUS_LABELS: Readonly<Record<ResourcePoolStatus, string>> = {
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开",
  waiting: "等待中"
};

function compactStatusLabel(gate: ResourceGateState): string {
  if (!gate.projectionComplete) return "数据异常";
  if (gate.readOnly) return REPLAY_RESOURCE_STATUS_LABEL;
  if (gate.ended) return "已结束";
  if (gate.status === "reconnecting") return "重连中";
  if (gate.status === "disconnected") return "已断开";
  if (gate.status === "waiting") return "等待中";
  if (gate.commandPending) return "处理中";
  return "已连接";
}

function displayAmount(value: number, complete: boolean): string {
  return complete && isValidResourceAmount(value) ? String(value) : INVALID_AMOUNT;
}

function StepButton({
  actionId,
  kind,
  ownerLabel,
  actions,
  gate,
  onAction
}: {
  readonly actionId: string | undefined;
  readonly kind: "increase" | "decrease";
  readonly ownerLabel: string;
  readonly actions: readonly ResourceActionView[];
  readonly gate: ResourceGateState;
  readonly onAction: (actionId: string) => void;
}) {
  const reason = describeStepDisabledReason(actionId, actions, gate);
  const disabled = reason !== null;
  const symbol = kind === "increase" ? "＋" : "−";
  const label = `${kind === "increase" ? "增加" : "减少"}${ownerLabel}`;
  return (
    <button
      type="button"
      className="full-product-resource-pool-step"
      aria-label={label}
      title={disabled ? reason ?? undefined : label}
      disabled={disabled}
      onClick={() => {
        // Re-check the gate at event time; never trust the render-time state.
        const request = resolveResourceActionRequest(actionId, actions, gate);
        if (request) onAction(request);
      }}
    >
      {symbol}
    </button>
  );
}

/**
 * Render the supplied source buttons, grouped under 符文 / 金币 headings when the
 * upper layer tagged them. Untagged sources flow through one plain list so the
 * markup stays byte-for-byte flat and ordering is unchanged. The wrapper only
 * adds presentation hooks; the forwarded action id and the gate are untouched.
 */
function renderSourceGroups(
  sources: readonly ResourceActionView[],
  renderButton: (action: ResourceActionView) => ReactElement
): ReactElement {
  const groups = groupResourceSources(sources);
  if (groups.length === 1 && groups[0]!.label === "") {
    return (
      <div className="full-product-resource-pool-action-list">{sources.map(renderButton)}</div>
    );
  }
  return (
    <div className="full-product-resource-pool-source-groups">
      {groups.map(group => (
        <div
          key={group.kind}
          className="full-product-resource-pool-source-group"
          data-source-kind={group.kind}
        >
          <h5 className="full-product-resource-pool-source-group-title">{group.label}</h5>
          <div className="full-product-resource-pool-action-list">
            {group.actions.map(renderButton)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResourcePoolPanel({
  energy,
  powers,
  sourceActions,
  counterActions = [],
  status,
  commandPending,
  ended,
  onAction,
  paymentSummary,
  compact = false,
  readOnly = false
}: ResourcePoolPanelProps) {
  const validation = validateResourceCounts(energy, powers);
  const complete = validation.complete;
  const actions = combineResourceActions(sourceActions, counterActions);
  const gate: ResourceGateState = {
    status,
    commandPending,
    ended,
    projectionComplete: complete,
    readOnly
  };
  const readOnlyReason = resourceGateReason(gate);

  const renderActionButton = (action: ResourceActionView) => {
    const reason = describeActionDisabledReason(action, gate);
    const disabled = reason !== null;
    return (
      <button
        key={action.id}
        type="button"
        className="full-product-resource-pool-action"
        aria-label={action.label}
        disabled={disabled}
        title={disabled ? reason ?? undefined : action.detail ?? action.label}
        onClick={() => {
          const request = resolveResourceActionRequest(action.id, actions, gate);
          if (request) onAction(request);
        }}
      >
        <span className="full-product-resource-pool-action-label">{action.label}</span>
        {action.detail ? (
          <span className="full-product-resource-pool-action-detail">{action.detail}</span>
        ) : null}
        {disabled && reason ? (
          <span className="full-product-resource-pool-action-reason">{reason}</span>
        ) : null}
      </button>
    );
  };

  const renderPaymentAmount = (value: number | undefined): string =>
    value === undefined ? INVALID_AMOUNT : displayAmount(value, isValidResourceAmount(value));

  if (compact) {
    const notice = compactResourceNotice(gate);
    const statusLabel = compactStatusLabel(gate);
    const renderCompactAction = (action: ResourceActionView) => {
      // Dense view keeps the same authority: gate first, supplied+enabled only,
      // plain-language reason, and the shared request guard on click.
      const reason = notice ?? (action.enabled ? null : action.blockedReason ?? COMPACT_ACTION_BLOCKED_FALLBACK);
      const disabled = reason !== null;
      return (
        <button
          key={action.id}
          type="button"
          className="full-product-resource-pool-action"
          aria-label={action.label}
          disabled={disabled}
          title={disabled ? reason ?? undefined : action.detail ?? action.label}
          onClick={() => {
            const request = resolveResourceActionRequest(action.id, actions, gate);
            if (request) onAction(request);
          }}
        >
          <span className="full-product-resource-pool-action-label">{action.label}</span>
          {action.detail ? (
            <span className="full-product-resource-pool-action-detail">{action.detail}</span>
          ) : null}
          {disabled && reason ? (
            <span className="full-product-resource-pool-action-reason">{reason}</span>
          ) : null}
        </button>
      );
    };

    return (
      <section
        className="full-product-resource-pool full-product-resource-pool-compact"
        aria-label="资源池"
      >
        <header className="full-product-resource-pool-head">
          <h3 className="full-product-resource-pool-title">资源</h3>
          <span
            className={`full-product-resource-pool-status is-${status}`}
            aria-label={`资源状态：${statusLabel}${notice ? `；${notice}` : ""}`}
          >
            {statusLabel}
          </span>
        </header>

        <div
          className="full-product-resource-pool-totals full-product-resource-pool-compact-totals"
          aria-label="资源池计数器：能量与符能合计"
        >
          <span className="full-product-resource-pool-total is-energy" data-res="energy">
            <i>能量</i>
            <b aria-label="能量总额">{displayAmount(energy.amount, complete)}</b>
          </span>
          <span className="full-product-resource-pool-total is-power">
            <i>符能</i>
            <b aria-label="符能合计">{complete ? String(validation.powerTotal) : INVALID_AMOUNT}</b>
          </span>
        </div>

        <details className="full-product-resource-pool-details" open={paymentSummary ? true : undefined}>
          <summary className="full-product-resource-pool-details-summary">
            {COMPACT_DETAILS_LABEL}
          </summary>
          {notice ? (
            <p className="full-product-resource-pool-readonly" role="status">
              {notice}
            </p>
          ) : null}

          {!complete ? (
            <ul className="full-product-resource-pool-errors" aria-label="资源投影问题">
              {validation.messages.map(message => (
                <li key={message} className="full-product-resource-pool-error">
                  {message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="full-product-resource-pool-chips" aria-label="符能分类">
            {powers.map(power => (
              <span
                key={power.id}
                className="full-product-resource-pool-chip is-power"
                data-power={power.id}
              >
                <i>{power.label}</i>
                <b aria-label={`当前${power.label}符能`}>
                  {displayAmount(power.amount, complete)}
                </b>
              </span>
            ))}
          </div>

          {paymentSummary ? (
            <div className="full-product-resource-pool-payment" aria-label="待支付摘要">
              <span className="full-product-resource-pool-payment-title">
                {paymentSummary.label ?? "本次支付"}
              </span>
              <span className="full-product-resource-pool-payment-line">
                能量 {renderPaymentAmount(paymentSummary.energyCost)}
              </span>
              {(paymentSummary.powerCosts ?? []).map(cost => (
                <span
                  key={`${cost.label}:${cost.amount}`}
                  className="full-product-resource-pool-payment-line"
                >
                  {cost.label} {renderPaymentAmount(cost.amount)}
                </span>
              ))}
              <span className="full-product-resource-pool-payment-note">
                {PAYMENT_DISPLAY_ONLY_NOTE}
              </span>
              <span className="full-product-resource-pool-payment-phase">{PAYMENT_PHASE_NOTE}</span>
            </div>
          ) : null}

          <div className="full-product-resource-pool-actions-block" aria-label="获取资源">
            <h4 className="full-product-resource-pool-subtitle">获取资源（符文 / 金币）</h4>
            {sourceActions.length === 0 ? (
              <p className="full-product-resource-pool-empty">{NO_SOURCE_ACTIONS_NOTICE}</p>
            ) : (
              renderSourceGroups(sourceActions, renderCompactAction)
            )}
          </div>

          {counterActions.length > 0 ? (
            <div className="full-product-resource-pool-actions-block" aria-label="资源调整">
              <div className="full-product-resource-pool-action-list">
                {counterActions.map(renderCompactAction)}
              </div>
            </div>
          ) : null}

          <p className="full-product-resource-pool-note" title={RETENTION_HINT}>
            {RETENTION_NOTE}
          </p>
        </details>
      </section>
    );
  }

  return (
    <section className="full-product-resource-pool" aria-label="资源池">
      <header className="full-product-resource-pool-head">
        <h3 className="full-product-resource-pool-title">资源池</h3>
        <span
          className={`full-product-resource-pool-status is-${status}`}
          aria-label={readOnly ? `资源状态：${REPLAY_RESOURCE_STATUS_LABEL}` : `连接状态：${STATUS_LABELS[status]}`}
        >
          {readOnly ? REPLAY_RESOURCE_STATUS_LABEL : STATUS_LABELS[status]}
        </span>
      </header>

      <p className="full-product-resource-pool-note" title={RETENTION_HINT}>
        {RETENTION_NOTE}
      </p>

      {readOnlyReason ? (
        <p className="full-product-resource-pool-readonly" role="status">
          {readOnlyReason}
        </p>
      ) : null}

      {!complete ? (
        <ul className="full-product-resource-pool-errors" aria-label="资源投影问题">
          {validation.messages.map(message => (
            <li key={message} className="full-product-resource-pool-error">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="full-product-resource-pool-totals"
        aria-label="资源池计数器：能量与符能合计"
      >
        <span className="full-product-resource-pool-total is-energy">
          <i>能量</i>
          <b aria-label="能量总额">{displayAmount(energy.amount, complete)}</b>
        </span>
        <span className="full-product-resource-pool-total is-power">
          <i>符能（合计）</i>
          <b aria-label="符能合计">{complete ? String(validation.powerTotal) : INVALID_AMOUNT}</b>
        </span>
      </div>

      <div className="full-product-resource-pool-line is-energy" data-res="energy">
        <span className="full-product-resource-pool-key">能量</span>
        <StepButton
          actionId={energy.decreaseActionId}
          kind="decrease"
          ownerLabel="能量"
          actions={actions}
          gate={gate}
          onAction={onAction}
        />
        <span className="full-product-resource-pool-value" aria-label="当前能量">
          {displayAmount(energy.amount, complete)}
        </span>
        <StepButton
          actionId={energy.increaseActionId}
          kind="increase"
          ownerLabel="能量"
          actions={actions}
          gate={gate}
          onAction={onAction}
        />
      </div>

      <ul className="full-product-resource-pool-powers" aria-label="符能明细">
        {powers.map(power => (
          <li
            key={power.id}
            className="full-product-resource-pool-line is-power"
            data-power={power.id}
          >
            <span className="full-product-resource-pool-key">{power.label}</span>
            <StepButton
              actionId={power.decreaseActionId}
              kind="decrease"
              ownerLabel={`${power.label}符能`}
              actions={actions}
              gate={gate}
              onAction={onAction}
            />
            <span className="full-product-resource-pool-value" aria-label={`当前${power.label}符能`}>
              {displayAmount(power.amount, complete)}
            </span>
            <StepButton
              actionId={power.increaseActionId}
              kind="increase"
              ownerLabel={`${power.label}符能`}
              actions={actions}
              gate={gate}
              onAction={onAction}
            />
          </li>
        ))}
      </ul>

      <div className="full-product-resource-pool-actions-block" aria-label="获取资源">
        <h4 className="full-product-resource-pool-subtitle">获取资源（符文 / 金币）</h4>
        {sourceActions.length === 0 ? (
          <p className="full-product-resource-pool-empty">{NO_SOURCE_ACTIONS_NOTICE}</p>
        ) : (
          renderSourceGroups(sourceActions, renderActionButton)
        )}
      </div>

      {counterActions.length > 0 ? (
        <div className="full-product-resource-pool-actions-block" aria-label="资源调整">
          <h4 className="full-product-resource-pool-subtitle">资源调整</h4>
          <div className="full-product-resource-pool-action-list">
            {counterActions.map(renderActionButton)}
          </div>
        </div>
      ) : null}

      {paymentSummary ? (
        <div className="full-product-resource-pool-payment" aria-label="待支付摘要">
          <span className="full-product-resource-pool-payment-title">
            {paymentSummary.label ?? "本次支付"}
          </span>
          <span className="full-product-resource-pool-payment-line">
            能量 {renderPaymentAmount(paymentSummary.energyCost)}
          </span>
          {(paymentSummary.powerCosts ?? []).map(cost => (
            <span
              key={`${cost.label}:${cost.amount}`}
              className="full-product-resource-pool-payment-line"
            >
              {cost.label} {renderPaymentAmount(cost.amount)}
            </span>
          ))}
          <span className="full-product-resource-pool-payment-note">
            {PAYMENT_DISPLAY_ONLY_NOTE}
          </span>
          <span className="full-product-resource-pool-payment-phase">{PAYMENT_PHASE_NOTE}</span>
        </div>
      ) : null}
    </section>
  );
}
