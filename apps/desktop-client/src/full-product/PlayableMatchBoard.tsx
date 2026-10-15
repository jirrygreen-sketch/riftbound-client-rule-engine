import type { PlayerCommand, ProjectionObject, ProjectionZone } from "@riftbound/protocol";
import { BoardZones } from "./components/BoardZones";
import { MatchStatusBar } from "./MatchStatusBar";
import { PromptActionPanel } from "./PromptActionPanel";
import {
  ZONE_LABELS,
  authoritativeActionOptions,
  buildSubmissionFromSelection,
  commandTargetKey,
  deriveLegalActions,
  findAuthoritativeAction,
  targetOptionsFor
} from "./commands";
import type {
  ActionSelection,
  PlayableCard,
  PlayableMatchView,
  SubmissionContext,
  SubmitCommand,
  ZoneSummary
} from "./types";

const ZONES: readonly ProjectionZone[] = [
  "hand",
  "deck",
  "rune-deck",
  "rune",
  "board",
  "base",
  "battlefield",
  "champion",
  "legend",
  "discard",
  "banish",
  "chain"
];

const ZONE_LABELS_FULL = {
  ...ZONE_LABELS,
  base: "基地",
  champion: "英雄",
  legend: "传说"
} as Readonly<Record<ProjectionZone, string>>;

const PRIVATE_ZONES: ReadonlySet<ProjectionZone> = new Set([
  "hand",
  "deck",
  "rune-deck"
]);

export interface PlayableMatchBoardProps {
  readonly view: PlayableMatchView;
  readonly selection: ActionSelection;
  readonly onSelectionChange: (selection: ActionSelection) => void;
  readonly onSubmit: SubmitCommand;
}

export function PlayableMatchBoard({
  view,
  selection,
  onSelectionChange,
  onSubmit
}: PlayableMatchBoardProps) {
  return (
    <div className="full-product-match" aria-label="Riftbound playable match">
      <MatchStatusBar view={view} />
      <BoardZones
        view={view}
        selectedActionId={selection.actionId}
        selectedCardId={selection.cardId}
        selectedTargetIds={selection.targetIds}
        onSelectCard={card =>
          onSelectionChange(selectCard(card, view, selection))
        }
        onSelectTarget={targetId =>
          onSelectionChange(selectTarget(targetId, view, selection))
        }
      />
      <PromptActionPanel
        view={view}
        selection={selection}
        onSelectionChange={onSelectionChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}

export function targetOptionsForSelectedCard(
  view: PlayableMatchView,
  selection: Pick<ActionSelection, "cardId">
): readonly import("./types").TargetOption[] {
  const action = deriveLegalActions(view).find(
    candidate =>
      candidate.type === "play-card" &&
      candidate.selectedCardId === selection.cardId
  );
  return targetOptionsFor(view, {
    actionId: action?.id ?? null,
    cardId: selection.cardId
  });
}

export function buildZones(view: PlayableMatchView): readonly ZoneSummary[] {
  const objects = view.projection.objects ?? [];
  return ZONES.map(zone => {
    const zoneObjects = view.projection.players.flatMap(player =>
      visibleZoneObjects(view, player.id, zone)
    );
    const declaredCount = view.projection.players.reduce(
      (total, player) => total + (player.zoneCounts?.[zone] ?? 0),
      0
    );
    return {
      zone,
      label: ZONE_LABELS_FULL[zone] ?? zone,
      count: declaredCount,
      objects: zoneObjects,
      hidden: PRIVATE_ZONES.has(zone),
      selecting: false
    };
  });
}

export function isZoneVisibleToViewer(
  view: PlayableMatchView,
  ownerPlayerId: string,
  zone: ProjectionZone
): boolean {
  return ownerPlayerId === view.viewerPlayerId || !PRIVATE_ZONES.has(zone);
}

export function visibleZoneObjects(
  view: PlayableMatchView,
  ownerPlayerId: string,
  zone: ProjectionZone
): readonly ProjectionObject[] {
  if (!isZoneVisibleToViewer(view, ownerPlayerId, zone)) return [];
  return (view.projection.objects ?? []).filter(
    object =>
      object.ownerPlayerId === ownerPlayerId &&
      object.zone === zone &&
      (object.faceUp || ownerPlayerId === view.viewerPlayerId)
  );
}

export function buildBoardModel(view: PlayableMatchView) {
  return {
    zones: buildZones(view),
    actions: deriveLegalActions(view)
  };
}

export function submissionContext(
  selection: ActionSelection,
  view: PlayableMatchView
): SubmissionContext {
  const action = deriveLegalActions(view).find(
    candidate => candidate.id === selection.actionId
  );
  return {
    actionType: action?.type ?? null,
    cardId: selection.cardId,
    targetIds: selection.targetIds,
    projection: view.projection
  };
}

export function selectCard(
  card: PlayableCard,
  view: PlayableMatchView,
  selection: ActionSelection
): ActionSelection {
  const action = deriveLegalActions(view).find(
    candidate => candidate.type === "play-card" && candidate.selectedCardId === card.instanceId
  );
  return {
    ...selection,
    actionId: action?.id ?? null,
    cardId: card.instanceId,
    targetIds: []
  };
}

export function selectTarget(
  targetId: string,
  view: PlayableMatchView,
  selection: ActionSelection
): ActionSelection {
  const options = authoritativeActionOptions(view);
  if (options !== null) {
    const action = findAuthoritativeAction(options, selection);
    if (action === null || action.command.type !== "play-card") return selection;
    const policy = action.targetPolicy;
    const authorized = new Set(policy.options.map(commandTargetKey));
    if (!authorized.has(targetId)) return selection;
    if (selection.targetIds.includes(targetId)) {
      return {
        ...selection,
        targetIds: selection.targetIds.filter(id => id !== targetId)
      };
    }
    if (selection.targetIds.length >= policy.maxTargets) return selection;
    return { ...selection, targetIds: [...selection.targetIds, targetId] };
  }

  const card = view.projection.players
    .find(player => player.id === view.viewerPlayerId)
    ?.hand.find(card => card.instanceId === selection.cardId);
  if (!card) return selection;
  const option = (view.targets?.[card.cardId] ?? []).find(
    candidate => candidate.id === targetId && candidate.disabled !== true
  );
  if (!option) return selection;
  return {
    ...selection,
    targetIds: selection.targetIds.includes(targetId)
      ? selection.targetIds.filter(id => id !== targetId)
      : [...selection.targetIds, targetId]
  };
}

export function submitSelectedAction(
  selection: ActionSelection,
  view: PlayableMatchView,
  onSubmit: (command: PlayerCommand, context: SubmissionContext) => void
): boolean {
  const command = buildSubmissionFromSelection(selection, view);
  if (command === null) return false;
  onSubmit(command, submissionContext(selection, view));
  return true;
}
