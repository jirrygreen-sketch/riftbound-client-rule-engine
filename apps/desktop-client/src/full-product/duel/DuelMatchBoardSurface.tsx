import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import type {
  DuelActionV3Actions1,
  DuelCommandMessageV3Actions1,
  DuelProjectionV3Actions1,
  DuelProjectionTransport,
  DuelWireAction,
  DuelWireCard,
  DuelWireCommandV3Actions1,
  DuelWireMatchPlaying,
  DuelWireMatchSetup
} from "@riftbound/protocol";
import { DUEL_POWER_DOMAINS, DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import { DuelWindowStatus, describeDuelWindowStatus } from "../components/DuelWindowStatus";
import { DuelActionsPanelV3, isLegacyAction, createDuelActionPacketIds, EMPTY_DUEL_ACTIONS_SELECTION, submitDuelActionSelection } from "../components/DuelActionsPanelV3";
import type { DuelActionsSelection } from "../components/DuelActionsPanelV3";
import { DuelTableLayout } from "../components/DuelTableLayout";
import { ResourcePoolPanel } from "../components/ResourcePoolPanel";
import { DuelCardActionPopover } from "../interactions/DuelCardActionPopover";
import { duelCardActionIds, duelCardDropSelection, duelCardDropTargets } from "../interactions/duel-card-actions";
import type { DuelCardPopoverAnchor, DuelCardSurfaceZone } from "../interactions/duel-card-interaction";
import type { FullProductConnectionStatus } from "../types";
import {
  DUEL_CHAIN_LABEL,
  DUEL_HAND_CARD_WIDTH_PX,
  DUEL_MATCH_BOARD_LABEL,
  DUEL_MULLIGAN_OWNER_HINT,
  DUEL_MULLIGAN_WAIT_HINT,
  DUEL_NO_ACTIONS_NOTICE,
  DUEL_PHASE_LABELS,
  DUEL_SCORE_TRACK_LABEL,
  DUEL_SETUP_COMPLETE_HINT,
  DUEL_SPECTATOR_HAND_NOTICE,
  DUEL_SPECTATOR_RESOURCE_NOTICE,
  DUEL_WAITING_TURN_START_NOTICE,
  actionPanelActions,
  buildDuelWireCommand,
  cardEventIsInspect,
  duelLegendPowerDomains,
  duelInteractionLockedReason,
  duelPowerViews,
  mulliganResetKey,
  nameFor,
  paymentSummaryFor,
  resourcePoolPaymentSummary,
  resourcePoolStatusFor,
  resourceSourceActions,
  resolveDuelSides,
  toggleMulliganSelection,
  unitsAtLocation,
  DuelCardInteractionContext,
  useDuelCardInteraction
} from "./duel-board-model";
import type { DuelCardInteractionContextValue, DuelMatchBoardProps, DuelSides } from "./duel-board-model";
import {
  BaseBand,
  BattlefieldCard,
  CardArt,
  CardPreviewOverlay,
  DuelScoreRail,
  HiddenHand,
  PublicChainPanel,
  SetupBattlefieldCard,
  SetupIdentityBand,
  duelBoardGears,
  duelDeckCounts,
  duelLegendPermanent,
  duelPreviewTarget,
  duelPublicChainCards,
  duelResourceBase,
  duelScoreMarkerLabel,
  scoreTrackValues
} from "./DuelBoardComponents";
import type { DuelWirePlayingMatch } from "./DuelBoardComponents";

export function DuelMatchBoardSurface({
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
