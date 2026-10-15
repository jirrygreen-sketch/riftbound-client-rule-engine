import type {
  ActionSelection,
  ConcedeAllowance,
  LegalAction,
  PlayableMatchView,
  TargetOption
} from "./types";
import {
  ACTION_OPTIONS_CONTRACT,
  type CommandTarget,
  type PlayerCommand,
  type ProjectionAction,
  type ProjectionActionOptions,
  type ProjectionActionTargetPolicy
} from "@riftbound/protocol";

export const ZONE_LABELS: Readonly<
  Record<string, string>
> = {
  hand: "手牌",
  deck: "牌库",
  "rune-deck": "符文库",
  rune: "符文",
  board: "战场",
  battlefield: "战场区域",
  discard: "弃牌",
  banish: "放逐",
  chain: "结算链"
};

/**
 * Returns the server action-options block when the projection carries a
 * contract this client understands. Returns null for legacy projections so the
 * fallback derivation keeps working.
 */
export function authoritativeActionOptions(
  view: PlayableMatchView
): ProjectionActionOptions | null {
  const options = view.projection.actionOptions;
  if (options === undefined) return null;
  if (options.contract !== ACTION_OPTIONS_CONTRACT) return null;
  return options;
}

/**
 * The action options are only executable when the server addressed this exact
 * viewer at this exact projection version. Spectator (null viewer) and stale
 * versions stay read-only.
 */
export function isActionOptionsExecutable(
  view: PlayableMatchView,
  options: ProjectionActionOptions
): boolean {
  return (
    view.connectionStatus === "connected" &&
    !view.commandPending &&
    view.projection.phase !== "ended" &&
    options.viewerPlayerId !== null &&
    options.viewerPlayerId === view.viewerPlayerId &&
    options.stateVersion === view.projection.version
  );
}

/** Stable UI key for an authorized wire target. */
export function commandTargetKey(target: CommandTarget): string {
  return target.kind === "object"
    ? `object:${target.objectId}`
    : `player:${target.playerId}`;
}

/**
 * Maps a selection of UI target keys back to wire targets using only the
 * server-authorized policy options. Rejects unauthorized, duplicated,
 * under/over-counted or forged selections.
 */
export function buildAuthoritativeTargets(
  targetIds: readonly string[],
  policy: ProjectionActionTargetPolicy
): readonly CommandTarget[] | null {
  if (targetIds.length < policy.minTargets || targetIds.length > policy.maxTargets) {
    return null;
  }
  const byKey = new Map<string, CommandTarget>();
  for (const option of policy.options) {
    const key = commandTargetKey(option);
    if (!byKey.has(key)) byKey.set(key, option);
  }
  const seen = new Set<string>();
  const targets: CommandTarget[] = [];
  for (const targetId of targetIds) {
    if (seen.has(targetId)) return null;
    seen.add(targetId);
    const target = byKey.get(targetId);
    if (target === undefined) return null;
    targets.push(target);
  }
  return targets;
}

export function isViewerCommandAllowed(view: PlayableMatchView): boolean {
  if (view.connectionStatus !== "connected" || view.commandPending) return false;
  const { projection, viewerPlayerId } = view;
  if (projection.phase === "ended") return false;
  if (projection.prompt !== null) {
    return projection.prompt.playerId === viewerPlayerId;
  }
  return projection.priority?.playerId === viewerPlayerId;
}

export function deriveLegalActions(view: PlayableMatchView): readonly LegalAction[] {
  const options = authoritativeActionOptions(view);
  if (options !== null) return deriveAuthoritativeActions(view, options);
  if (view.projection.actionOptions !== undefined) return [];
  return deriveFallbackActions(view);
}

function deriveAuthoritativeActions(
  view: PlayableMatchView,
  options: ProjectionActionOptions
): readonly LegalAction[] {
  const executable = isActionOptionsExecutable(view, options);
  const gateReason = authoritativeGateReason(view, options);
  return options.actions
    .filter(action => action.command.type !== "concede")
    .map(action => mapAuthoritativeAction(view, action, executable, gateReason));
}

function mapAuthoritativeAction(
  view: PlayableMatchView,
  action: ProjectionAction,
  executable: boolean,
  gateReason: string
): LegalAction {
  const command = action.command;
  const policy = action.targetPolicy;
  const requiresTargets =
    command.type === "play-card" &&
    (policy.minTargets > 0 || policy.maxTargets > 0);
  const blockedReason = executable
    ? action.enabled
      ? undefined
      : translatedBlockedReason(action.blockedReason)
    : gateReason;

  return {
    type: legalActionType(command),
    id: action.id,
    label: labelForAuthoritativeAction(view, action),
    disabled: !executable || !action.enabled,
    ready: executable && action.enabled && !requiresTargets,
    requiresCard: command.type === "play-card",
    requiresTargets,
    selectedCardId: command.type === "play-card" ? command.instanceId : null,
    targetPolicy: policy,
    authoritative: true,
    reason: blockedReason,
    command
  };
}

/**
 * Panel-visible action kinds. `concede` is intentionally excluded from the
 * panel list (it has its own control consumed through deriveConcedeAction), so
 * it only ever falls through to this mapper after being filtered out.
 */
function legalActionType(command: PlayerCommand): LegalAction["type"] {
  if (command.type === "play-card") return "play-card";
  if (command.type === "respond-to-prompt") return "respond-to-prompt";
  return "pass";
}

function translatedBlockedReason(reason: string | undefined): string {
  switch (reason) {
    case "judge-required": return "该能力需要裁决，暂不支持自动结算";
    case "unsupported-card-type": return "该牌类型尚未支持";
    case "no-legal-target": return "当前没有可选目标";
    default: return reason ?? "服务端已禁用该动作";
  }
}

function authoritativeGateReason(
  view: PlayableMatchView,
  options: ProjectionActionOptions
): string {
  if (view.connectionStatus !== "connected") return "连接恢复中，棋盘只读";
  if (view.commandPending) return "上一条命令确认中";
  if (view.projection.phase === "ended") return "对局已结束";
  if (options.viewerPlayerId === null) return "旁观视图只读";
  if (options.viewerPlayerId !== view.viewerPlayerId) return "动作投影不属于当前玩家";
  if (options.stateVersion !== view.projection.version) return "动作投影已过期";
  return "当前动作不可用";
}

function labelForAuthoritativeAction(
  view: PlayableMatchView,
  action: ProjectionAction
): string {
  const command = action.command;
  if (command.type === "pass") return "结束行动";
  if (command.type === "concede") return "认输";
  if (command.type === "respond-to-prompt") {
    const prompt = view.projection.prompt;
    const option = prompt?.options.find(
      candidate => candidate.id === command.optionId
    );
    return option?.label ?? command.optionId;
  }
  const instanceId = command.instanceId;
  const card = view.projection.players
    .find(player => player.id === view.viewerPlayerId)
    ?.hand.find(candidate => candidate.instanceId === instanceId);
  const cardId = card?.cardId ?? null;
  return `打出 ${cardId === null ? instanceId : view.resolveCardTitle(cardId)}`;
}

/**
 * The standalone concede control consumes the server allowance. When the
 * projection carries the action-options contract, the server decides whether
 * the viewer may concede (including while the opponent holds a prompt).
 * Connection and pending-command gating always still apply.
 */
export function deriveConcedeAction(view: PlayableMatchView): ConcedeAllowance {
  if (view.connectionStatus !== "connected") {
    return { enabled: false, reason: "断线只读" };
  }
  if (view.commandPending) {
    return { enabled: false, reason: "上一条命令确认中" };
  }
  const options = authoritativeActionOptions(view);
  if (options === null) {
    if (view.projection.actionOptions !== undefined) {
      return { enabled: false, reason: "动作协议不兼容" };
    }
    if (view.projection.phase === "ended") {
      return { enabled: false, reason: "对局已结束" };
    }
    return { enabled: true };
  }
  if (!isActionOptionsExecutable(view, options)) {
    return { enabled: false, reason: authoritativeGateReason(view, options) };
  }
  const concede = options.actions.find(action => action.command.type === "concede");
  if (concede === undefined) {
    return { enabled: false, reason: "服务端未授权认输" };
  }
  if (!concede.enabled) {
    return { enabled: false, reason: concede.blockedReason ?? "服务端未授权认输" };
  }
  return { enabled: true };
}

function deriveFallbackActions(view: PlayableMatchView): readonly LegalAction[] {
  const blocked = !isViewerCommandAllowed(view);
  const prompt = view.projection.prompt;
  const promptBlocked = blocked || prompt?.playerId === view.viewerPlayerId;
  const action: LegalAction = {
    type: "pass",
    id: "pass",
    label: "结束行动",
    disabled: promptBlocked,
    ready: !promptBlocked,
    reason: promptBlocked
      ? prompt?.playerId === view.viewerPlayerId
        ? "请先完成当前选择"
        : actionBlockedReason(view)
      : undefined,
    command: { type: "pass" }
  };

  if (blocked) return [action];

  if (prompt?.playerId === view.viewerPlayerId) {
    const optionStates = view.promptOptionStates?.[prompt.id] ?? {};
    return [
      action,
      ...prompt.options.map(option => ({
        type: "respond-to-prompt" as const,
        id: `${prompt.id}:${option.id}`,
        label: option.label,
        disabled: optionStates[option.id]?.disabled === true,
        ready: optionStates[option.id]?.disabled !== true,
        reason: optionStates[option.id]?.reason,
        command: {
          type: "respond-to-prompt" as const,
          promptId: prompt.id,
          optionId: option.id,
          stateVersion: prompt.stateVersion
        }
      }))
    ];
  }

  const viewer = view.projection.players.find(
    player => player.id === view.viewerPlayerId
  );
  if (!viewer || viewer.playableInstanceIds === undefined) return [action];

  return [
    action,
    ...viewer.playableInstanceIds.map(instanceId => {
      const card = viewer.hand.find(card => card.instanceId === instanceId);
      const cardId = card?.cardId ?? null;
      const targetRequirement =
        cardId === null ? [] : view.targetRequirements?.[cardId] ?? [];
      const requiresTargets = targetRequirement.length > 0;
      return {
        type: "play-card" as const,
        id: `play:${instanceId}`,
        label: `打出 ${cardId === null ? instanceId : view.resolveCardTitle(cardId)}`,
        disabled: false,
        ready: !requiresTargets,
        reason: requiresTargets ? "请先选择目标" : undefined,
        requiresCard: true,
        requiresTargets,
        selectedCardId: instanceId,
        command: { type: "play-card" as const, instanceId }
      };
    })
  ];
}

export function buildSubmissionFromSelection(
  selection: {
    readonly actionId: string | null;
    readonly cardId: string | null;
    readonly targetIds: readonly string[];
  },
  view: PlayableMatchView,
): PlayerCommand | null {
  const options = authoritativeActionOptions(view);
  if (options !== null) {
    return buildAuthoritativeSubmission(selection, view, options);
  }
  if (view.projection.actionOptions !== undefined) return null;
  return buildFallbackSubmission(selection, view);
}

function buildAuthoritativeSubmission(
  selection: {
    readonly actionId: string | null;
    readonly cardId: string | null;
    readonly targetIds: readonly string[];
  },
  view: PlayableMatchView,
  options: ProjectionActionOptions
): PlayerCommand | null {
  if (!isActionOptionsExecutable(view, options)) return null;
  if (selection.actionId === null) return null;

  const action = options.actions.find(candidate => candidate.id === selection.actionId);
  if (action === undefined || !action.enabled) return null;

  const command = action.command;
  if (command.type === "concede") return null;
  if (command.type !== "play-card") return selection.targetIds.length === 0 ? command : null;
  if (selection.cardId !== command.instanceId) return null;

  if (
    action.targetPolicy.options.length === 0 &&
    action.targetPolicy.minTargets === 0 &&
    action.targetPolicy.maxTargets === 0 &&
    selection.targetIds.length === 0
  ) {
    return { type: "play-card", instanceId: command.instanceId };
  }

  const targets = buildAuthoritativeTargets(selection.targetIds, action.targetPolicy);
  if (targets === null) return null;
  return {
    type: "play-card",
    instanceId: command.instanceId,
    targets: targets.length === 0 ? undefined : targets
  };
}

function buildFallbackSubmission(
  selection: {
    readonly actionId: string | null;
    readonly cardId: string | null;
    readonly targetIds: readonly string[];
  },
  view: PlayableMatchView,
): PlayerCommand | null {
  const action = deriveFallbackActions(view).find(
    candidate => candidate.id === selection.actionId
  );
  if (!action || action.disabled) return null;
  if (action.type === "pass" || action.type === "respond-to-prompt") {
    return action.command;
  }
  if (action.selectedCardId !== selection.cardId) return null;
  if (selection.cardId === null) return null;
  const requirements =
    view.targetRequirements?.[view.projection.players.find(
      player => player.id === view.viewerPlayerId
    )?.hand.find(card => card.instanceId === selection.cardId)?.cardId ?? ""] ?? [];
  const options = view.targets?.[
    view.projection.players
      .find(player => player.id === view.viewerPlayerId)
      ?.hand.find(card => card.instanceId === selection.cardId)?.cardId ?? ""
  ] ?? [];
  const optionIds = new Set(options.filter(option => !option.disabled).map(option => option.id));
  const uniqueTargetIds = new Set(selection.targetIds);
  const validTargets =
    selection.targetIds.every(targetId => optionIds.has(targetId)) &&
    uniqueTargetIds.size === selection.targetIds.length;
  if (!validTargets || uniqueTargetIds.size < requirements.length) return null;
  return { type: "play-card", instanceId: selection.cardId };
}

function actionBlockedReason(view: PlayableMatchView): string {
  if (view.connectionStatus === "disconnected") return "断线只读";
  if (view.connectionStatus !== "connected") return "连接恢复中，棋盘只读";
  if (view.commandPending) return "上一条命令确认中";
  if (view.projection.phase === "ended") return "对局已结束";
  const prompt = view.projection.prompt;
  if (prompt !== null) {
    return prompt.playerId === view.viewerPlayerId
      ? "等待选择"
      : `等待 ${playerName(view, prompt.playerId)} 选择`;
  }
  const priorityPlayerId = view.projection.priority?.playerId ?? null;
  if (priorityPlayerId !== view.viewerPlayerId) {
    return priorityPlayerId === null
      ? "等待权限投影"
      : `等待 ${playerName(view, priorityPlayerId)} 行动`;
  }
  return "当前动作不可用";
}

function playerName(view: PlayableMatchView, playerId: string): string {
  return (
    view.projection.players.find(player => player.id === playerId)?.name ?? playerId
  );
}

export function targetOptionsFor(
  view: PlayableMatchView,
  selection: Pick<ActionSelection, "cardId"> & {
    readonly actionId?: string | null;
  }
): readonly TargetOption[] {
  const options = authoritativeActionOptions(view);
  if (options !== null) {
    return authoritativeTargetOptions(view, options, selection);
  }
  if (view.projection.actionOptions !== undefined) return [];
  return fallbackTargetOptions(view, selection);
}

/**
 * Resolves the target chooser for the selected action. The authority path keys
 * by the action's own instance/action id so two instances of the same printing
 * never share a policy.
 */
function authoritativeTargetOptions(
  view: PlayableMatchView,
  options: ProjectionActionOptions,
  selection: Pick<ActionSelection, "cardId"> & {
    readonly actionId?: string | null;
  }
): readonly TargetOption[] {
  if (!isActionOptionsExecutable(view, options)) return [];
  const action = findAuthoritativeAction(options, selection);
  if (action === null || action.command.type !== "play-card") return [];
  return action.targetPolicy.options.map(target => ({
    id: commandTargetKey(target),
    label: targetLabel(view, target),
    objectId: target.kind === "object" ? target.objectId : undefined,
    playerId: target.kind === "player" ? target.playerId : undefined
  }));
}

export function findAuthoritativeAction(
  options: ProjectionActionOptions,
  selection: Pick<ActionSelection, "cardId"> & {
    readonly actionId?: string | null;
  }
): ProjectionAction | null {
  if (selection.actionId !== undefined && selection.actionId !== null) {
    const byId = options.actions.find(action => action.id === selection.actionId);
    if (byId !== undefined) return byId;
  }
  if (selection.cardId !== null) {
    return (
      options.actions.find(
        action =>
          action.command.type === "play-card" &&
          action.command.instanceId === selection.cardId
      ) ?? null
    );
  }
  return null;
}

function fallbackTargetOptions(
  view: PlayableMatchView,
  selection: Pick<ActionSelection, "cardId">
): readonly TargetOption[] {
  const card = view.projection.players
    .find(player => player.id === view.viewerPlayerId)
    ?.hand.find(card => card.instanceId === selection.cardId);
  if (!card) return [];
  return view.targets?.[card.cardId] ?? [];
}

function targetLabel(view: PlayableMatchView, target: CommandTarget): string {
  if (target.kind === "player") {
    return (
      view.projection.players.find(player => player.id === target.playerId)?.name ??
      target.playerId
    );
  }
  const object = (view.projection.objects ?? []).find(
    candidate => candidate.objectId === target.objectId
  );
  return object === undefined
    ? target.objectId
    : view.resolveCardTitle(object.cardId);
}
