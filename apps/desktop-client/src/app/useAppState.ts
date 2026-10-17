import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { type AppPage } from "../navigation/AppShell";
import { readPlayerProfile, writePlayerProfile, type PlayerProfile } from "../profile/player-profile";
import { readDisplaySettings, writeDisplaySettings, type DisplaySettings } from "../settings/display-settings";
import {
  readReplayLibrary,
  writeReplayLibrary,
  saveReplayRecording,
  type ReplayRecording
} from "../replays/replay-library";
import { type DeckBuilderEntry } from "../components/DeckBuilder";
import {
  emptySubmissionTracking,
  roomDeckPickerGate,
  type RoomDeckPickerZone,
  type SubmissionTracking
} from "../components/RoomDeckPicker";
import {
  deckFingerprint,
  deckTotalCount,
  deckZoneCounts,
  findNamedDeck,
  type DeckLibrary,
  type DeckLibraryStorage
} from "../decks/library";
import { resolveCatalogServerUrl, resolveSelectedDeckId } from "../decks/ui-preferences";
import { type DeckSwitchTracker } from "../decks/room-confirmation";
import { confirmedOwnerDeckFingerprint } from "../decks/owner-deck-confirmation";
import { commandTargetKey, deriveConcedeAction, deriveLegalActions } from "../full-product/commands";
import { buildPlayableMatchView, isFullProductRuleset, toPlayableConnectionStatus } from "../full-product/transport";
import type { ActionSelection } from "../full-product/types";
import {
  buildProjectedGameView,
  buildProjectedPlayerView,
  getActionState,
  type BoardCardInfo
} from "../game/projectionContract";
import { useCardCatalog, type DeckByZone } from "../hooks/useCardCatalog";
import { useDuelCardCatalog, type DuelCatalogStamp } from "../hooks/useDuelCardCatalog";
import { useGameClient } from "../hooks/useGameClient";
import { cardImageServerUrl, DEFAULT_CARD_SERVER_URL, type DeckZone } from "../net/CardCatalogClient";
import {
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID,
  type CardInstance,
  type DuelProjectionTransport
} from "@riftbound/protocol";
import { createUiBootstrap, type UiBootstrap } from "./ui-bootstrap";
import { DECK_ZONE_LABELS, DECK_ZONE_ORDER, DEFAULT_DRAFT_NAME, allowedZonesFor, isCardAbilityImplemented, buildCardLimits } from "./deck-policy";
import { mergeEvents } from "./events";
import { useV2Match } from "../hooks/useV2Match";
import { readV2UiEnabled, writeV2UiEnabled } from "../full-product/v2-ui-switch";

type AppTab = AppPage;

type SubmissionReceiptTracking = SubmissionTracking & {
  readonly pendingSubmissionRequestId: string | null;
  readonly pendingDeckSnapshot: DeckByZone | null;
};

export function useAppState() {
  const {
    status,
    handshakeReady,
    commandPending,
    requestPending,
    chatMessages,
    chatPending,
    chatError,
    sendChat,
    disconnect,
    projection,
    duelProjection,
    lastError,
    errorRevision,
    roomId,
    roomView,
    ownerDeckConfirmation,
    gameEvents,
    session,
    storedSession,
    activeServerUrl,
    connect,
    createRoom,
    joinRoom,
    pass,
    playCard,
    submitPlayerCommand,
    submitDuelCommand,
    submitDuelCommandPacket,
    concede,
    respondPrompt,
    submitDeck,
    setReady,
    roomRequestReceipt,
    roomRequestFailure,
    syncEvents,
    clearError
  } = useGameClient();
  // One tolerant read of local storage at mount: the named-deck library, the
  // persisted UI preferences, and the working draft are all restored from their
  // own independent keys. A full reload then keeps the user-chosen catalog
  // address and the named deck they were actually using.
  const [bootstrap] = useState<UiBootstrap>(() => createUiBootstrap());
  const preferenceStorage = bootstrap.storage;
  const [v2UiEnabled, setV2UiEnabledState] = useState(() => readV2UiEnabled(preferenceStorage));
  const setV2UiEnabled = useCallback((enabled: boolean): void => {
    if (writeV2UiEnabled(preferenceStorage, enabled)) setV2UiEnabledState(enabled);
  }, [preferenceStorage]);
  const [profile, setProfile] = useState(() => readPlayerProfile(preferenceStorage));
  const [displaySettings, setDisplaySettings] = useState(() => readDisplaySettings(preferenceStorage));
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [replayLibrary, setReplayLibrary] = useState(() => readReplayLibrary(preferenceStorage));
  const [replaySelection, setReplaySelection] = useState<{ id: string; index: number } | null>(null);
  const selectReplayFrame = useCallback((recording: ReplayRecording, index: number) => {
    setReplaySelection({ id: recording.id, index });
  }, []);
  const [replayNotice, setReplayNotice] = useState<string | null>(null);
  const [exitError, setExitError] = useState<string | null>(null);
  const liveReplay = useRef<{ key: string; frames: DuelProjectionTransport[] } | null>(null);

  const saveProfile = (next: PlayerProfile): boolean => {
    if (!writePlayerProfile(preferenceStorage, next)) return false;
    setProfile(next);
    return true;
  };
  const changeDisplaySettings = (next: DisplaySettings): void => {
    if (!writeDisplaySettings(preferenceStorage, next)) {
      setSettingsError("显示设置未能保存，请检查本机存储。");
      return;
    }
    setDisplaySettings(next);
    setSettingsError(null);
  };
  // Save only authenticated client projections. No private server archive or
  // opponent-only information enters the local replay library.
  useEffect(() => {
    if (!duelProjection || !roomId) return;
    const key = `${roomId}:${duelProjection.match.matchId}:${duelProjection.viewerPlayerId ?? "public"}`;
    if (liveReplay.current?.key !== key) liveReplay.current = { key, frames: [] };
    const frames = liveReplay.current.frames;
    const previous = frames.at(-1);
    if (previous?.match.stateVersion === duelProjection.match.stateVersion &&
        previous.match.eventSeq === duelProjection.match.eventSeq) return;
    if (frames.length >= 300) {
      setReplayNotice("本机回放已达到 300 个画面的保存上限，后续画面未记录。");
      return;
    }
    frames.push(structuredClone(duelProjection));
  }, [duelProjection, roomId]);
  const saveCurrentReplay = (): void => {
    const capture = liveReplay.current;
    if (!capture || capture.frames.length === 0 || !roomId) return;
    const recording: ReplayRecording = {
      id: capture.key, roomId,
      title: capture.frames[0]!.match.roster.map(seat => seat.displayName).join(" vs "),
      savedAt: new Date().toISOString(), frames: structuredClone(capture.frames)
    };
    const next = saveReplayRecording(replayLibrary, recording);
    if (!writeReplayLibrary(preferenceStorage, next)) {
      setReplayNotice("回放未能保存，请检查本机存储或记录大小。");
      return;
    }
    setReplayLibrary(next);
    setReplayNotice("已保存本机当前视角回放。");
  };


  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [actionSelection, setActionSelection] = useState<ActionSelection>({
    actionId: null,
    cardId: null,
    targetIds: []
  });
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [catalogServerUrl, setCatalogServerUrl] = useState<string>(() =>
    resolveCatalogServerUrl(bootstrap.preferences, DEFAULT_CARD_SERVER_URL)
  );
  const [activeDeckZone, setActiveDeckZone] = useState<DeckZone>("mainDeck");
  const [retryToken, setRetryToken] = useState(0);

  const {
    catalog,
    catalogStatus,
    catalogError,
    deck,
    setZoneFromEntries,
    setDeckFromSnapshot,
    validation,
    validationStatus,
    validationError,
    validateDeck,
    retryCatalog
  } = useCardCatalog({ serverUrl: catalogServerUrl, retryToken,
    constructedRegion: roomView?.constructedRegion ? {regionCode:roomView.constructedRegion.regionCode,eventDate:roomView.constructedRegion.eventDate} : null });

  const v2Match = useV2Match({
    enabled: v2UiEnabled && activeTab === "game-table",
    serverUrl: activeServerUrl,
    roomId,
    session: session ? { playerId: session.playerId, resumeToken: session.resumeToken } : null
  });

  const libraryStorage: DeckLibraryStorage | null = bootstrap.storage;
  const [library, setLibrary] = useState<DeckLibrary>(bootstrap.library);
  // The restored selection is only accepted when the stored deck id still
  // exists AND its content still equals the restored draft; otherwise the plain
  // draft is shown as "current".
  const restoredSelectionId = useMemo(
    () =>
      resolveSelectedDeckId({
        preferences: bootstrap.preferences,
        library: bootstrap.library,
        restoredDeck: bootstrap.restoredDeck
      }),
    [bootstrap]
  );
  const [selectedLibraryDeckId, setSelectedLibraryDeckId] = useState<string | null>(
    restoredSelectionId
  );
  const [draftName, setDraftName] = useState<string>(
    () => findNamedDeck(bootstrap.library, restoredSelectionId)?.name ?? DEFAULT_DRAFT_NAME
  );
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionReceiptTracking>({
    ...emptySubmissionTracking,
    pendingSubmissionRequestId: null,
    pendingDeckSnapshot: null
  });
  const [pendingSwitch, setPendingSwitch] = useState<DeckSwitchTracker | null>(null);
  const [pendingReadyRequestId, setPendingReadyRequestId] = useState<string | null>(null);
  const pendingSwitchDeckId = pendingSwitch?.deckId ?? null;
  const submissionContextRef = useRef<{ roomId: string | null; playerId: string | null } | null>(null);
  // Only the plain ready toggle uses this ref now; switching a deck carries its
  // own captured context inside the tracker.
  const pendingReadyContextRef = useRef<{ roomId: string | null; playerId: string | null } | null>(null);

  const viewerPlayerId = session?.playerId ?? null;
  const roomSelf = useMemo(
    () => roomView?.players.find(player => player.id === viewerPlayerId) ?? null,
    [roomView, viewerPlayerId]
  );
  const roomOpponent = useMemo(
    () => roomView?.players.find(player => player.id !== viewerPlayerId) ?? null,
    [roomView, viewerPlayerId]
  );
  const projectedGame = useMemo(() => buildProjectedGameView(projection), [projection]);
  const self = useMemo(
    () => buildProjectedPlayerView(projectedGame, viewerPlayerId),
    [projectedGame, viewerPlayerId]
  );
  const opponent = useMemo(
    () =>
      buildProjectedPlayerView(
        projectedGame,
        projectedGame.players.find(player => player.id !== viewerPlayerId)?.id ?? null
      ),
    [projectedGame, viewerPlayerId]
  );
  const selectedCard = useMemo<CardInstance | null>(() => {
    if (!self || !selectedCardId) return null;
    return self.hand.find(card => card.instanceId === selectedCardId) ?? null;
  }, [self, selectedCardId]);

  const connected = status === "connected" && handshakeReady;
  const fullProductEnabled = isFullProductRuleset(projection?.rulesetId);
  const mergedGameEvents = useMemo(
    () => mergeEvents(projection?.events ?? [], gameEvents),
    [gameEvents, projection?.events]
  );
  const actionState = getActionState({
    connected,
    commandPending,
    projection,
    viewerPlayerId,
    selectedCard
  });

  const builderCards = useMemo(() => {
    if (!catalog) return [];
    return catalog.cards
      .filter(card => allowedZonesFor(card).includes(activeDeckZone))
      .map(card => ({
        ...card,
        subtitle: card.subtitle ?? "",
        localizedName: card.localizedName ?? card.name,
        localizedSubtitle: card.localizedSubtitle ?? card.subtitle ?? "",
        imageUrl: cardImageServerUrl(catalogServerUrl, card.id)
      }));
  }, [activeDeckZone, catalog, catalogServerUrl]);

  const builderDeck = useMemo<readonly DeckBuilderEntry[]>(() =>
    Object.entries(deck[activeDeckZone])
      .map(([cardId, quantity]) => ({ cardId, quantity }))
      .sort((left, right) => left.cardId.localeCompare(right.cardId)),
    [activeDeckZone, deck]
  );

  const validationIssues = useMemo(() => {
    if (!validation) return [];
    return [
      ...validation.issues.map(issue => ({
        key: `issue:${issue.code}:${issue.canonicalCardId ?? ""}:${issue.cardId ?? ""}:${issue.zone ?? ""}`,
        message: issue.message
      })),
      ...validation.printingIssues.map(issue => ({
        key: `printing:${issue.cardId}:${issue.canonicalCardId ?? ""}:${issue.zone ?? ""}:${issue.status}`,
        message: issue.message
      }))
    ];
  }, [validation]);

  const cardLimits = useMemo(
    () => buildCardLimits(catalog?.cards ?? [], activeDeckZone, deck),
    [activeDeckZone, catalog, deck]
  );

  const resolveCardInfo = useCallback(
    (cardId: string): BoardCardInfo | null => {
      const card =
        catalog?.cards.find(candidate => candidate.id === cardId) ??
        catalog?.cards.find(candidate => candidate.canonicalCardId === cardId) ??
        null;
      if (!card) return null;
      return {
        title: [card.localizedName ?? card.name, card.localizedSubtitle ?? card.subtitle]
          .filter(Boolean)
          .join(" · "),
        imageUrl: card.imageUrl ?? cardImageServerUrl(catalogServerUrl, card.id),
        typeLabel: [card.cardType, ...card.domains].join(" · "),
        implemented: isCardAbilityImplemented(card)
      };
    },
    [catalog, catalogServerUrl]
  );
  // The live duel is labelled only from a catalog whose stamp equals the
  // authority's own (`DuelProjection.match`). The editor catalog is a reuse
  // candidate only on an exact stamp match; a different or older catalog never
  // relabels the duel, and this hook never writes draft/validation state.
  // A saved replay uses its own stamp even after the live session has ended.
  const selectedReplay = replayLibrary.recordings.find(recording => recording.id === replaySelection?.id) ?? null;
  const replayFrame = selectedReplay?.frames[replaySelection?.index ?? 0] ?? null;
  const displayedProjection = activeTab === "replays" ? replayFrame : duelProjection;
  const duelDataVersion = displayedProjection?.match.dataVersion ?? null;
  const duelCatalogDigest = displayedProjection?.match.catalogDigest ?? null;
  const duelCatalogStamp = useMemo<DuelCatalogStamp | null>(
    () => (duelDataVersion === null || duelCatalogDigest === null
      ? null
      : { dataVersion: duelDataVersion, catalogDigest: duelCatalogDigest }),
    [duelCatalogDigest, duelDataVersion]
  );
  const duelCatalog = useDuelCardCatalog({
    activeServerUrl: activeServerUrl ?? (activeTab === "replays" ? catalogServerUrl : null),
    stamp: duelCatalogStamp,
    reusableCatalog: catalog
  });
  const resolveDuelCardTitle = useCallback(
    (cardId: string) => duelCatalog.resolveCard(cardId)?.title ?? cardId,
    [duelCatalog.resolveCard]
  );
  const resolveDuelCardImage = useCallback(
    (cardId: string) => duelCatalog.resolveCard(cardId)?.imageUrl ?? null,
    [duelCatalog.resolveCard]
  );
  const resolveDuelCardDomains = useCallback(
    (cardId: string) => duelCatalog.resolveCard(cardId)?.domains ?? [],
    [duelCatalog.resolveCard]
  );
  const resolvePlayableCard = useCallback(
    (cardId: string) => {
      const info = resolveCardInfo(cardId);
      return info === null ? null : {
        title: info.title,
        imageUrl: info.imageUrl
      };
    },
    [resolveCardInfo]
  );
  const playableMatchView = useMemo(
    () =>
      fullProductEnabled && projection !== null && viewerPlayerId !== null
        ? buildPlayableMatchView({
            projection,
            viewerPlayerId,
            connectionStatus: projection.actionOptions === undefined
              ? "disconnected"
              : toPlayableConnectionStatus(status, handshakeReady),
            commandPending,
            resolveCard: resolvePlayableCard
          })
        : null,
    [
      commandPending,
      fullProductEnabled,
      handshakeReady,
      projection,
      resolvePlayableCard,
      status,
      viewerPlayerId
    ]
  );
  const legalActions = useMemo(
    () => (playableMatchView === null ? [] : deriveLegalActions(playableMatchView)),
    [playableMatchView]
  );
  const concedeAllowance = useMemo(
    () =>
      playableMatchView === null
        ? { enabled: false, reason: "未进入对局" }
        : deriveConcedeAction(playableMatchView),
    [playableMatchView]
  );
  const selectedCardLabel = selectedCard
    ? resolveCardInfo(selectedCard.cardId)?.title ?? selectedCard.cardId
    : "未选择手牌";

  const deckCardCount = useMemo(
    () => DECK_ZONE_ORDER.reduce(
      (total, zone) => total + Object.values(deck[zone]).reduce((sum, count) => sum + count, 0),
      0
    ),
    [deck]
  );

  const currentFingerprint = useMemo(() => deckFingerprint(deck), [deck]);
  const currentDeckTotal = useMemo(() => deckTotalCount(deck), [deck]);
  const currentDeckZones = useMemo<readonly RoomDeckPickerZone[]>(
    () => deckZoneCounts(deck).map(entry => ({
      zone: entry.zone,
      label: DECK_ZONE_LABELS[entry.zone],
      count: entry.count
    })),
    [deck]
  );
  const selectedLibraryDeck = useMemo(
    () => findNamedDeck(library, selectedLibraryDeckId),
    [library, selectedLibraryDeckId]
  );
  const currentDeckName = selectedLibraryDeck?.name ?? DEFAULT_DRAFT_NAME;

  // A fresh private echo from the current authenticated socket is the only
  // refresh witness for a catalog-backed room. Public flags, a restored draft,
  // and the editor's separate catalog URL cannot establish this identity.
  const catalogBackedRoom = roomView?.rulesetId === OFFICIAL_RULESET_ID ||
    roomView?.rulesetId === DUEL_RULESET_ID;
  const ownerVerifiedFingerprint = confirmedOwnerDeckFingerprint(ownerDeckConfirmation, {
    connected,
    roomId,
    playerId: viewerPlayerId,
    serverUrl: activeServerUrl,
    roomView,
    switching: pendingSwitchDeckId !== null
  }, deck);

  const gate = useMemo(
    () => roomDeckPickerGate({
      connected,
      reconnecting: status === "connecting" || status === "reconnecting",
      roomStatus: roomView?.status ?? null,
      requestPending: requestPending || pendingReadyRequestId !== null,
      switching: pendingSwitchDeckId !== null,
      selfReady: roomSelf?.ready ?? false,
      selfDeckSubmitted: roomSelf?.deckSubmitted ?? false,
      currentFingerprint,
      currentDeckEmpty: currentDeckTotal === 0,
      confirmedFingerprint: catalogBackedRoom
        ? ownerVerifiedFingerprint : submission.confirmedFingerprint,
      pendingFingerprint: submission.pendingFingerprint
    }),
    [
      connected,
      currentDeckTotal,
      currentFingerprint,
      catalogBackedRoom,
      ownerVerifiedFingerprint,
      pendingSwitchDeckId,
      pendingReadyRequestId,
      requestPending,
      roomSelf?.deckSubmitted,
      roomSelf?.ready,
      roomView?.status,
      status,
      submission.confirmedFingerprint,
      submission.pendingFingerprint
    ]
  );

  useEffect(() => {
    if (!projection) {
      setSelectedCardId(null);
      return;
    }
    if (
      selectedCardId &&
      !self?.hand.some(card => card.instanceId === selectedCardId)
    ) {
      setSelectedCardId(null);
    }
  }, [projection, selectedCardId, self?.hand]);

  useEffect(() => {
    if (!projection?.prompt) setPendingOptionId(null);
  }, [projection?.prompt]);

  useEffect(() => {
    if (!fullProductEnabled) {
      setActionSelection({ actionId: null, cardId: null, targetIds: [] });
      return;
    }
    if (playableMatchView === null) return;
    const selectedAction =
      legalActions.find(action => action.id === actionSelection.actionId) ?? null;
    if (actionSelection.actionId !== null && selectedAction === null) {
      // The authority no longer offers this action (version change, hand change,
      // reader-only viewer): drop the selection instead of submitting stale ids.
      setActionSelection({ actionId: null, cardId: null, targetIds: [] });
      return;
    }
    if (selectedAction === null) {
      const selectedCard = playableMatchView.projection.players
        .find(player => player.id === viewerPlayerId)
        ?.hand.find(card => card.instanceId === actionSelection.cardId);
      if (actionSelection.cardId !== null && selectedCard === undefined) {
        setActionSelection({ actionId: null, cardId: null, targetIds: [] });
      }
      return;
    }
    if (selectedAction.targetPolicy !== undefined) {
      const authorized = new Set(
        selectedAction.targetPolicy.options.map(commandTargetKey)
      );
      const kept = actionSelection.targetIds.filter(id => authorized.has(id));
      if (kept.length !== actionSelection.targetIds.length) {
        setActionSelection({ ...actionSelection, targetIds: kept });
      }
    }
  }, [
    actionSelection,
    fullProductEnabled,
    legalActions,
    playableMatchView,
    viewerPlayerId
  ]);

  useEffect(() => {
    if (errorRevision > 0) setPendingOptionId(null);
  }, [errorRevision]);

  // Navigate once on a room/match transition. Projection refreshes must not
  // pull a player away from the home page, settings, replay or lobby.
  const visibleRoomTransition = useRef<string | null>(null);
  useEffect(() => {
    const key = roomId === null ? null
      : `${roomId}:${roomView?.status ?? ""}:${duelProjection?.match.matchId ?? ""}`;
    if (key === visibleRoomTransition.current) return;
    visibleRoomTransition.current = key;
    if (duelProjection !== null || roomView?.status === "playing") setActiveTab("game-table");
    else if (roomView?.status === "waiting") setActiveTab("room");
  }, [roomId, duelProjection?.match.matchId, roomView?.status]);

  return {
    status,
    handshakeReady,
    commandPending,
    chatMessages,
    chatPending,
    chatError,
    sendChat,
    disconnect,
    projection,
    duelProjection,
    lastError,
    errorRevision,
    roomId,
    roomView,
    session,
    storedSession,
    activeServerUrl,
    connect,
    createRoom,
    joinRoom,
    pass,
    playCard,
    submitPlayerCommand,
    submitDuelCommand,
    submitDuelCommandPacket,
    concede,
    respondPrompt,
    submitDeck,
    setReady,
    roomRequestReceipt,
    roomRequestFailure,
    syncEvents,
    clearError,
    preferenceStorage,
    profile,
    setProfile,
    displaySettings,
    settingsError,
    replayLibrary,
    setReplayLibrary,
    replaySelection,
    setReplaySelection,
    selectReplayFrame,
    replayNotice,
    setReplayNotice,
    exitError,
    setExitError,
    saveProfile,
    changeDisplaySettings,
    saveCurrentReplay,
    selectedCardId,
    setSelectedCardId,
    actionSelection,
    setActionSelection,
    pendingOptionId,
    setPendingOptionId,
    activeTab,
    setActiveTab,
    catalogServerUrl,
    setCatalogServerUrl,
    activeDeckZone,
    setActiveDeckZone,
    setRetryToken,
    catalog,
    catalogStatus,
    catalogError,
    deck,
    setZoneFromEntries,
    setDeckFromSnapshot,
    validation,
    validationStatus,
    validationError,
    validateDeck,
    retryCatalog,
    libraryStorage,
    library,
    setLibrary,
    selectedLibraryDeckId,
    setSelectedLibraryDeckId,
    draftName,
    setDraftName,
    libraryNotice,
    setLibraryNotice,
    submission,
    setSubmission,
    pendingSwitch,
    setPendingSwitch,
    pendingReadyRequestId,
    setPendingReadyRequestId,
    submissionContextRef,
    pendingReadyContextRef,
    viewerPlayerId,
    roomSelf,
    self,
    opponent,
    selectedCard,
    connected,
    fullProductEnabled,
    mergedGameEvents,
    actionState,
    builderCards,
    builderDeck,
    validationIssues,
    cardLimits,
    resolveCardInfo,
    replayFrame,
    duelCatalog,
    resolveDuelCardTitle,
    resolveDuelCardImage,
    resolveDuelCardDomains,
    playableMatchView,
    concedeAllowance,
    selectedCardLabel,
    deckCardCount,
    currentFingerprint,
    currentDeckTotal,
    currentDeckZones,
    currentDeckName,
    gate,
    v2UiEnabled,
    setV2UiEnabled,
    v2Match
  };
}

export type AppState = ReturnType<typeof useAppState>;
