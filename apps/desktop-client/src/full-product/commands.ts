import type { ActionSelection, LegalAction, PlayableMatchView } from "./types";
import type { PlayerCommand } from "@riftbound/protocol";

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
  const action = deriveLegalActions(view).find(
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
  selection: Pick<ActionSelection, "cardId">
) {
  const card = view.projection.players
    .find(player => player.id === view.viewerPlayerId)
    ?.hand.find(card => card.instanceId === selection.cardId);
  if (!card) return [];
  return view.targets?.[card.cardId] ?? [];
}
