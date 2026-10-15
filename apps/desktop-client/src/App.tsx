import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { AppShell, type AppPage } from "./navigation/AppShell";
import { HomePage } from "./navigation/HomePage";
import { exitDesktopClient } from "./navigation/native-exit";
import { RoomLobby } from "./components/RoomLobby";
import { RoomChatPanel } from "./chat/RoomChatPanel";
import { ProfilePage } from "./profile/ProfilePage";
import { readPlayerProfile, writePlayerProfile, type PlayerProfile } from "./profile/player-profile";
import { DeckImportPanel } from "./decks/DeckImportPanel";
import { SettingsPage } from "./settings/SettingsPage";
import { MatchControls } from "./settings/MatchControls";
import { readDisplaySettings, writeDisplaySettings, type DisplaySettings } from "./settings/display-settings";
import { ReplayPage } from "./replays/ReplayPage";
import { readReplayLibrary, writeReplayLibrary, saveReplayRecording, removeReplayRecording,
  type ReplayRecording } from "./replays/replay-library";
import { ActionBar } from "./components/ActionBar";
import { ChainPanel } from "./components/ChainPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DeckBuilder, type DeckBuilderEntry } from "./components/DeckBuilder";
import { LogPanel } from "./components/LogPanel";
import { PlayerBoard } from "./components/PlayerBoard";
import { PromptPanel } from "./components/PromptPanel";
import {
  RoomDeckPicker,
  emptySubmissionTracking,
  roomDeckPickerGate,
  type RoomDeckPickerZone,
  type SubmissionTracking
} from "./components/RoomDeckPicker";
import {
  cloneDeckByZone,
  deckFingerprint,
  deckTotalCount,
  deckZoneCounts,
  findNamedDeck,
  readDeckLibrary,
  removeNamedDeck,
  saveNamedDeck,
  updateNamedDeck,
  writeDeckLibrary,
  type DeckLibrary,
  type DeckLibraryStorage
} from "./decks/library";
import {
  clearAppliedDeckSelection,
  readUiPreferences,
  resolveCatalogServerUrl,
  resolveSelectedDeckId,
  writeAppliedDeckSelection,
  writeCatalogServerUrl,
  type UiPreferences
} from "./decks/ui-preferences";
import {
  beginDeckSwitch,
  evaluateDeckSwitch,
  evaluateReadyReceipt,
  evaluateSubmitDeckReceipt,
  type DeckSwitchTracker
} from "./decks/room-confirmation";
import { confirmedOwnerDeckFingerprint } from "./decks/owner-deck-confirmation";
import { PlayableMatchBoard } from "./full-product/PlayableMatchBoard";
import { DuelMatchBoard } from "./full-product/DuelMatchBoard";
import {
  commandTargetKey,
  deriveConcedeAction,
  deriveLegalActions
} from "./full-product/commands";
import {
  buildPlayableCommand,
  buildPlayableMatchView,
  isFullProductRuleset,
  toPlayableConnectionStatus
} from "./full-product/transport";
import type { ActionSelection } from "./full-product/types";
import {
  buildProjectedGameView,
  buildProjectedPlayerView,
  getActionState,
  type BoardCardInfo
} from "./game/projectionContract";
import { readStoredDeck, useCardCatalog, type DeckByZone } from "./hooks/useCardCatalog";
import { useDuelCardCatalog, type DuelCatalogStamp } from "./hooks/useDuelCardCatalog";
import { useGameClient } from "./hooks/useGameClient";
import {
  cardImageServerUrl,
  DEFAULT_CARD_SERVER_URL,
  normalizeCardServerUrl,
  type CatalogCard,
  type DeckZone
} from "./net/CardCatalogClient";
import {
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID,
  RULESET_ID,
  type CardInstance,
  type GameEvent,
  type DuelProjectionTransport
} from "@riftbound/protocol";

type AppTab = AppPage;

const DECK_ZONE_LABELS: Readonly<Record<DeckZone, string>> = {
  mainDeck: "主卡组",
  runes: "符文",
  legend: "传说",
  champion: "英雄",
  battlefields: "战场",
  sideboard: "备牌"
};

const DECK_ZONE_ORDER: readonly DeckZone[] = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
];

const DEFAULT_DRAFT_NAME = "当前草稿";

type SubmissionReceiptTracking = SubmissionTracking & {
  readonly pendingSubmissionRequestId: string | null;
  readonly pendingDeckSnapshot: DeckByZone | null;
};

export function App() {
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

  // A submission is confirmed only by its own matched receipt plus a room
  // revision at least as new as the acknowledged one. A receipt missing its
  // room version, or one that no longer belongs to the captured room context,
  // drops the in-flight marker without ever touching the confirmed deck.
  useEffect(() => {
    if (!roomRequestReceipt) return;
    const decision = evaluateSubmitDeckReceipt({
      receipt: roomRequestReceipt,
      pendingRequestId: submission.pendingSubmissionRequestId,
      context: submissionContextRef.current,
      roomId,
      playerId: viewerPlayerId,
      roomVersion: roomView?.roomVersion ?? null
    });
    if (decision.kind === "abandoned") {
      submissionContextRef.current = null;
      setSubmission(previous => ({
        ...previous,
        pendingFingerprint: null,
        pendingSubmissionRequestId: null,
        pendingDeckSnapshot: null
      }));
      setLibraryNotice(decision.notice);
      return;
    }
    if (decision.kind !== "confirmed") return;
    const acknowledgedRequestId = roomRequestReceipt.requestId;
    submissionContextRef.current = null;
    setSubmission(previous => {
      if (previous.pendingSubmissionRequestId !== acknowledgedRequestId) return previous;
      return {
        ...previous,
        confirmedFingerprint:
          previous.pendingDeckSnapshot !== null &&
          deckFingerprint(previous.pendingDeckSnapshot) === previous.pendingFingerprint
            ? previous.pendingFingerprint
            : previous.confirmedFingerprint,
        pendingFingerprint: null,
        pendingSubmissionRequestId: null,
        pendingDeckSnapshot: null,
        baselineRoomVersion: decision.roomVersion
      };
    });
  }, [roomId, roomRequestReceipt, roomView?.roomVersion, submission.pendingSubmissionRequestId, viewerPlayerId]);

  useEffect(() => {
    if (!roomRequestFailure) return;
    const failure = roomRequestFailure;
    setSubmission(previous =>
      previous.pendingSubmissionRequestId === failure.requestId
        ? { ...previous, pendingFingerprint: null, pendingSubmissionRequestId: null, pendingDeckSnapshot: null }
        : previous
    );
    if (pendingReadyRequestId !== null && failure.requestId === pendingReadyRequestId) {
      pendingReadyContextRef.current = null;
      setPendingReadyRequestId(null);
    }
  }, [pendingReadyRequestId, roomRequestFailure]);

  // The plain ready toggle (no deck switch attached) is acknowledged once both
  // its own receipt and the projection carrying the new ready flag are visible.
  useEffect(() => {
    if (!roomRequestReceipt) return;
    const decision = evaluateReadyReceipt({
      receipt: roomRequestReceipt,
      pendingRequestId: pendingReadyRequestId,
      context: pendingReadyContextRef.current,
      roomId,
      playerId: viewerPlayerId,
      roomVersion: roomView?.roomVersion ?? null,
      selfReady: roomSelf?.ready ?? null
    });
    if (decision.kind === "ignored" || decision.kind === "waiting") return;
    pendingReadyContextRef.current = null;
    setPendingReadyRequestId(null);
    if (decision.kind === "abandoned") setLibraryNotice(decision.notice);
  }, [pendingReadyRequestId, roomId, roomRequestReceipt, roomSelf?.ready, roomView?.roomVersion, viewerPlayerId]);

  // A transport error revision can only invalidate a request that was already
  // in flight when it arrived; re-running on later requests must be a no-op, so
  // this effect is keyed on the revision alone.
  useEffect(() => {
    if (errorRevision === 0) return;
    setPendingReadyRequestId(current => (current === null ? current : null));
  }, [errorRevision]);

  // A submit can only be confirmed from a room revision observed on a live
  // connection; dropping the socket abandons the in-flight marker instead of
  // letting a later revision vouch for it.
  useEffect(() => {
    if (connected) return;
    setSubmission(previous => ({
      ...previous,
      pendingFingerprint: null,
      pendingSubmissionRequestId: null,
      pendingDeckSnapshot: null
    }));
    submissionContextRef.current = null;
    pendingReadyContextRef.current = null;
    setPendingReadyRequestId(null);
  }, [connected]);

  const applyDeckSelection = useCallback((deckId: string) => {
    const entry = findNamedDeck(library, deckId);
    if (!entry) {
      setLibraryNotice("该卡组已不存在，请重新选择。");
      return;
    }
    setDeckFromSnapshot(entry.deck);
    setSelectedLibraryDeckId(entry.id);
    setDraftName(entry.name);
    setLibraryNotice(null);
    // Persist only a selection that has actually been applied to the draft.
    writeAppliedDeckSelection(preferenceStorage, entry.id, deckFingerprint(entry.deck));
  }, [library, preferenceStorage, setDeckFromSnapshot]);

  // Switching decks while ready requires the server to accept `set-ready(false)`
  // first. Every decision comes from the pure tracker: a matching receipt, the
  // projection that reaches its room version, and a seat that really is not
  // ready. Nothing about the captured snapshot depends on the mutable library.
  const switchDecision = useMemo(
    () =>
      pendingSwitch === null
        ? null
        : evaluateDeckSwitch(pendingSwitch, {
            connected,
            roomId,
            playerId: viewerPlayerId,
            roomStatus: roomView?.status ?? null,
            roomVersion: roomView?.roomVersion ?? null,
            selfReady: roomSelf?.ready ?? null,
            receipt: roomRequestReceipt,
            failure: roomRequestFailure,
            errorRevision
          }),
    [
      connected,
      errorRevision,
      pendingSwitch,
      roomId,
      roomRequestFailure,
      roomRequestReceipt,
      roomSelf?.ready,
      roomView?.roomVersion,
      roomView?.status,
      viewerPlayerId
    ]
  );

  useEffect(() => {
    if (pendingSwitch === null || switchDecision === null) return;
    if (switchDecision.status === "pending") return;
    const settled = pendingSwitch;
    // Apply the captured snapshot; a library entry that changed while the
    // request was in flight must not replace what the server will use.
    if (switchDecision.status === "confirmed") {
      setDeckFromSnapshot(switchDecision.tracker.deck);
      setSelectedLibraryDeckId(settled.deckId);
      setDraftName(settled.name);
      setLibraryNotice("房间已确认取消准备，卡组已切换。");
      // The captured candidate is persisted only now, after the server's
      // matched set-ready(false) receipt and projection have confirmed it.
      writeAppliedDeckSelection(
        preferenceStorage,
        settled.deckId,
        deckFingerprint(switchDecision.tracker.deck)
      );
    } else {
      setLibraryNotice(switchDecision.notice);
    }
    setPendingSwitch(current =>
      current !== null && current.requestId === settled.requestId ? null : current
    );
  }, [pendingSwitch, preferenceStorage, setDeckFromSnapshot, switchDecision]);

  const commitLibrary = useCallback((next: DeckLibrary, message: string | null) => {
    const result = writeDeckLibrary(libraryStorage, next);
    setLibrary(next);
    setLibraryNotice(result.ok ? message : result.message);
  }, [libraryStorage]);

  const handleSelectDeck = useCallback((deckId: string | null) => {
    if (deckId === null) {
      setSelectedLibraryDeckId(null);
      clearAppliedDeckSelection(preferenceStorage);
      return;
    }
    if (!gate.canSelectDeck) return;
    if (roomView?.status === "waiting" && (roomSelf?.ready ?? false)) {
      const entry = findNamedDeck(library, deckId);
      if (!entry) return;
      const requestId = setReady(false);
      if (requestId !== null) {
        setPendingSwitch(beginDeckSwitch({
          requestId,
          context: { roomId, playerId: viewerPlayerId },
          deckId: entry.id,
          deck: entry.deck,
          name: entry.name,
          errorRevision
        }));
        setLibraryNotice("已请求取消准备，收到房间确认后切换卡组。");
      }
      return;
    }
    applyDeckSelection(deckId);
  }, [applyDeckSelection, errorRevision, gate.canSelectDeck, library, preferenceStorage, roomId, roomSelf?.ready, roomView?.status, setReady, viewerPlayerId]);

  const handleSaveAsNamed = useCallback(() => {
    const result = saveNamedDeck(library, { name: draftName, deck });
    if (!result.ok) {
      setLibraryNotice(result.reason);
      return;
    }
    commitLibrary(result.library, `已保存卡组「${result.entry.name}」。`);
    setSelectedLibraryDeckId(result.entry.id);
    setDraftName(result.entry.name);
    writeAppliedDeckSelection(
      preferenceStorage,
      result.entry.id,
      deckFingerprint(result.entry.deck)
    );
  }, [commitLibrary, deck, draftName, library, preferenceStorage]);

  const importDeck = (nextDeck: DeckByZone, name: string): boolean => {
    if (!gate.canSelectDeck || roomSelf?.ready === true || catalogStatus !== "ready") return false;
    const result = saveNamedDeck(library, { name, deck: nextDeck });
    if (!result.ok) { setLibraryNotice(result.reason); return false; }
    const persisted = writeDeckLibrary(libraryStorage, result.library);
    if (!persisted.ok) { setLibraryNotice(persisted.message); return false; }
    setLibrary(result.library);
    setDeckFromSnapshot(result.entry.deck);
    setSelectedLibraryDeckId(result.entry.id);
    setDraftName(result.entry.name);
    writeAppliedDeckSelection(preferenceStorage, result.entry.id, deckFingerprint(result.entry.deck));
    setLibraryNotice(`已导入「${result.entry.name}」，请校验后提交给房间。`);
    return true;
  };

  const handleUpdateSelected = useCallback(() => {
    if (selectedLibraryDeckId === null) return;
    const result = updateNamedDeck(library, selectedLibraryDeckId, {
      name: draftName,
      deck
    });
    if (!result.ok) {
      setLibraryNotice(result.reason);
      return;
    }
    commitLibrary(result.library, `已更新卡组「${result.entry.name}」。`);
    setDraftName(result.entry.name);
  }, [commitLibrary, deck, draftName, library, selectedLibraryDeckId]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedLibraryDeckId === null) return;
    const entry = findNamedDeck(library, selectedLibraryDeckId);
    commitLibrary(
      removeNamedDeck(library, selectedLibraryDeckId),
      entry ? `已删除卡组「${entry.name}」。` : null
    );
    setSelectedLibraryDeckId(null);
    clearAppliedDeckSelection(preferenceStorage);
  }, [commitLibrary, library, preferenceStorage, selectedLibraryDeckId]);

  const submitCurrentDeck = useCallback(() => {
    if (!gate.canSubmitDeck) return;
    const requestId = submitDeck(deck);
    if (requestId === null) return;
    submissionContextRef.current = { roomId, playerId: viewerPlayerId };
    setSubmission(previous => ({
      ...previous,
      pendingFingerprint: currentFingerprint,
      pendingSubmissionRequestId: requestId,
      pendingDeckSnapshot: cloneDeckByZone(deck),
      baselineRoomVersion: roomView?.roomVersion ?? 0,
      baselineErrorRevision: errorRevision
    }));
  }, [
    currentFingerprint,
    deck,
    errorRevision,
    gate.canSubmitDeck,
    roomView?.roomVersion,
    submitDeck
  ]);

  const toggleReady = useCallback(() => {
    if (!gate.canToggleReady) return;
    const requestId = setReady(!(roomSelf?.ready ?? false));
    if (requestId !== null) {
      pendingReadyContextRef.current = { roomId, playerId: viewerPlayerId };
      setPendingReadyRequestId(requestId);
    }
  }, [gate.canToggleReady, roomId, roomSelf?.ready, setReady, viewerPlayerId]);

  const submitPlayableSelection = useCallback(() => {
    if (playableMatchView === null) return;
    const command = buildPlayableCommand(actionSelection, playableMatchView);
    if (command !== null) submitPlayerCommand(command);
  }, [actionSelection, playableMatchView, submitPlayerCommand]);

  const inMatch = duelProjection !== null || roomView?.status === "playing";
  const chat = <RoomChatPanel key={roomId ?? "no-room"} messages={chatMessages ?? []}
    viewerPlayerId={session?.playerId ?? null} connected={status === "connected" && handshakeReady && roomId !== null}
    pending={chatPending ?? false} onSend={sendChat} error={chatError ?? null} />;
  const controls = <div className="match-local-controls">
    <MatchControls settings={displaySettings} onChange={changeDisplaySettings}
      onGoHome={() => setActiveTab("home")} onGoRoom={() => setActiveTab("room")}
      onConcede={duelProjection === null && projection !== null ? concede : undefined}
      canConcede={concedeAllowance.enabled} />
    <button className="button" type="button" onClick={saveCurrentReplay} disabled={!duelProjection}>保存回放</button>
    {settingsError ? <span role="alert">{settingsError}</span> : null}
    {replayNotice ? <span role="status">{replayNotice}</span> : null}
  </div>;
  const exit = (): void => {
    disconnect();
    setActiveTab("home");
    void exitDesktopClient().catch(() => setExitError("客户端未能关闭，请使用窗口关闭按钮退出。"));
  };

  return (
    <AppShell page={activeTab} onNavigate={setActiveTab} onExit={exit}
      playerName={profile.name} connected={status === "connected" && handshakeReady} inMatch={inMatch}>
    <div className="app-content" data-card-scale={displaySettings.cardScale}
      data-reduced-motion={displaySettings.reducedMotion} data-show-card-names={displaySettings.showCardNames}>
      {exitError ? <p role="alert">{exitError}</p> : null}
      {activeTab === "home" ? (
        <HomePage onNavigate={setActiveTab} onExit={exit} playerName={profile.name}
          connected={status === "connected" && handshakeReady} inMatch={inMatch}
          roomId={roomId} deckCount={library.decks.length} />
      ) : activeTab === "profile" ? (
        <ProfilePage profile={profile} onSave={saveProfile} inRoom={roomId !== null} />
      ) : activeTab === "settings" ? (
        <SettingsPage settings={displaySettings} onChange={changeDisplaySettings} saveError={settingsError} />
      ) : activeTab === "replays" ? (
        <ReplayPage library={replayLibrary} selectedId={replaySelection?.id ?? null}
          selectedFrameIndex={replaySelection?.index ?? 0}
          onSelectFrame={selectReplayFrame}
          onDelete={id => {
            const next = removeReplayRecording(replayLibrary, id);
            if (writeReplayLibrary(preferenceStorage, next)) {
              setReplayLibrary(next);
              if (replaySelection?.id === id) setReplaySelection(null);
            } else setReplayNotice("回放删除未能保存。");
          }}
          viewer={replayFrame ? <DuelMatchBoard projection={replayFrame}
            connectionStatus="connected" commandPending={false} readOnly
            onCommand={() => {}} resolveCardTitle={resolveDuelCardTitle} resolveCardImage={resolveDuelCardImage}
            resolveCardDomains={resolveDuelCardDomains} /> : null} />
      ) : activeTab === "deck-builder" ? (
        <main className="deck-shell" aria-label="卡组编辑">
          <section className="deck-summary" aria-label="卡组状态">
            <div>
              <h2>我的卡组</h2>
              <p>{`卡组总计 ${deckCardCount} 张 · 当前区域：${DECK_ZONE_LABELS[activeDeckZone]}`}</p>
            </div>
            <form
              className="catalog-controls"
              onSubmit={event => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("catalog-server");
                if (input instanceof HTMLInputElement) {
                  const normalized = normalizeCardServerUrl(input.value);
                  if (normalized) {
                    setCatalogServerUrl(normalized);
                    // Only the user-set catalog address is stored; it is never
                    // derived from the separate WS room address.
                    writeCatalogServerUrl(preferenceStorage, normalized);
                  }
                }
                setRetryToken(token => token + 1);
                retryCatalog();
              }}
            >
              <label className="field">
                <span>仓库服务地址</span>
                <input
                  name="catalog-server"
                  defaultValue={catalogServerUrl}
                  spellCheck={false}
                  autoComplete="url"
                />
              </label>
              <button className="button primary" type="submit">
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </form>
            <button
              className="button primary"
              type="button"
              onClick={() => {
                void validateDeck();
              }}
              disabled={catalogStatus !== "ready" || validationStatus === "pending"}
            >
              <ShieldCheck size={16} aria-hidden />
              校验卡组
            </button>
          </section>

          <section className="deck-library" aria-label="卡组库">
            <div className="deck-library-head">
              <h3>卡组库</h3>
              <p>把当前草稿保存为命名卡组，之后可在房间页选用。</p>
            </div>
            <div className="deck-library-save">
              <label className="field">
                <span>卡组名称</span>
                <input
                  value={draftName}
                  maxLength={40}
                  spellCheck={false}
                  onChange={event => setDraftName(event.target.value)}
                />
              </label>
              <button className="button primary" type="button" onClick={handleSaveAsNamed}>
                <Save size={16} aria-hidden />
                保存为命名卡组
              </button>
              <button
                className="button"
                type="button"
                onClick={handleUpdateSelected}
                disabled={selectedLibraryDeckId === null}
              >
                <Upload size={16} aria-hidden />
                更新所选卡组
              </button>
              <button
                className="button"
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedLibraryDeckId === null}
              >
                <Trash2 size={16} aria-hidden />
                删除所选
              </button>
            </div>
            {library.decks.length === 0 ? (
              <p className="hint">还没有保存的卡组。填写名称后点“保存为命名卡组”。</p>
            ) : (
              <ul className="deck-library-list">
                {library.decks.map(entry => (
                  <li
                    key={entry.id}
                    className={entry.id === selectedLibraryDeckId ? "active" : ""}
                  >
                    <span className="deck-library-name">{entry.name}</span>
                    <span className="deck-library-meta">{`${deckTotalCount(entry.deck)} 张`}</span>
                    <button
                      className="button"
                      type="button"
                      onClick={() => handleSelectDeck(entry.id)}
                      disabled={!gate.canSelectDeck}
                      title={gate.selectBlockedReason ?? "载入到当前草稿"}
                    >
                      载入
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {libraryNotice ? <p className="hint" role="status">{libraryNotice}</p> : null}
          </section>

          <DeckImportPanel deck={deck} cards={catalog?.cards ?? []}
            disabled={!gate.canSelectDeck || roomSelf?.ready === true || catalogStatus !== "ready"}
            onImport={importDeck} />

          {catalogStatus === "loading" ? (
            <section className="catalog-state">
              <RefreshCw size={20} aria-hidden />
              <p>正在加载官方仓库...</p>
            </section>
          ) : catalogStatus === "error" ? (
            <section className="catalog-state error">
              <AlertTriangle size={20} aria-hidden />
              <p>{catalogError}</p>
              <button className="button primary" type="button" onClick={retryCatalog}>
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </section>
          ) : (
            <>
              <nav className="deck-zone-tabs" aria-label="卡组区域">
                {DECK_ZONE_ORDER.map(zone => (
                  <button
                    key={zone}
                    type="button"
                    className={activeDeckZone === zone ? "active" : ""}
                    aria-pressed={activeDeckZone === zone}
                    onClick={() => setActiveDeckZone(zone)}
                  >
                    {DECK_ZONE_LABELS[zone]}
                  </button>
                ))}
              </nav>
              <DeckBuilder
                cards={builderCards}
                deck={builderDeck}
                cardLimits={cardLimits}
                onChange={nextDeck => setZoneFromEntries(activeDeckZone, nextDeck)}
              />
            </>
          )}

          {validationStatus === "error" || validation ? (
            <section className={`validation-panel ${validation?.valid === false ? "invalid" : ""}`} role="status">
              {validationStatus === "error" || validation?.valid === false ? (
                <AlertTriangle size={18} aria-hidden />
              ) : (
                <CheckCircle2 size={18} aria-hidden />
              )}
              <div>
                {validationError ? (
                  <p>{validationError}</p>
                ) : validation?.valid ? (
                  <p>服务端校验通过。</p>
                ) : validation ? (
                  <ul>
                    {validationIssues.map(issue => (
                      <li key={issue.key}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      ) : activeTab === "room" ? (
        <main className="room-shell room-page" aria-label="房间连接">
          {roomView ? (
            <RoomLobby room={roomView} viewerPlayerId={viewerPlayerId} deckPicker={
<RoomDeckPicker
            namedDecks={library.decks}
            selectedDeckId={selectedLibraryDeckId}
            currentDeckName={currentDeckName}
            currentDeckTotal={currentDeckTotal}
            currentZones={currentDeckZones}
            deckState={gate.deckState}
            gate={gate}
            draftName={draftName}
            onDraftNameChange={setDraftName}
            onSelectDeck={handleSelectDeck}
            onSaveAsNamed={handleSaveAsNamed}
            onUpdateSelected={handleUpdateSelected}
            onDeleteSelected={handleDeleteSelected}
            onEditDeck={() => setActiveTab("deck-builder")}
            notice={libraryNotice}
          />
            } chat={chat} onSubmitDeck={submitCurrentDeck} onToggleReady={toggleReady}
              onSync={syncEvents} canSubmitDeck={gate.canSubmitDeck} canToggleReady={gate.canToggleReady}
              readyLabel={gate.readyLabel} submitBlockedReason={gate.submitBlockedReason}
              readyBlockedReason={gate.readyBlockedReason} onEnterGame={() => setActiveTab("game-table")} />
          ) : (
          <ConnectionPanel
            playerName={profile.name}
            onPlayerNameChange={name => setProfile(current => ({...current,name}))}
            status={status}
            handshakeReady={handshakeReady}
            roomId={roomId}
            storedSession={storedSession}
            activeServerUrl={activeServerUrl}
            lastError={lastError}
            onConnect={connect}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onClearError={clearError}
          />
          )}
        </main>
      ) : duelProjection !== null ? (
        <main className="table-shell">
          {duelCatalog.status === "loading" ? (
            <section className="catalog-state" role="status" aria-label="对局卡牌目录">
              <p>正在从当前对局服务加载卡牌名称与图片…</p>
            </section>
          ) : duelCatalog.status === "error" ? (
            <section className="catalog-state error" role="alert" aria-label="对局卡牌目录">
              <p>{duelCatalog.error ?? "无法加载对局卡牌目录。"}</p>
              <button className="button" type="button" onClick={duelCatalog.retry}>
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </section>
          ) : null}
          {lastError ? (
            <section className="catalog-state error" role="alert" aria-label="对局操作提示">
              <p>{lastError}</p>
              <button className="button" type="button" aria-label="关闭对局提示" onClick={clearError}>
                关闭
              </button>
            </section>
          ) : null}
          <DuelMatchBoard
            projection={duelProjection}
            connectionStatus={toPlayableConnectionStatus(status, handshakeReady)}
            commandPending={commandPending}
            onCommand={submitDuelCommand}
            onActionPacket={submitDuelCommandPacket}
            resolveCardTitle={resolveDuelCardTitle}
            resolveCardImage={resolveDuelCardImage}
            resolveCardDomains={resolveDuelCardDomains}
            controls={controls}
            chat={chat}
          />
        </main>
      ) : fullProductEnabled && playableMatchView !== null ? (
        <main className="table-shell">
          <PlayableMatchBoard
            view={playableMatchView}
            selection={actionSelection}
            onSelectionChange={setActionSelection}
            onSubmit={() => submitPlayableSelection()}
          />
          <button
            className="button"
            type="button"
            onClick={concede}
            disabled={!concedeAllowance.enabled}
            title={concedeAllowance.reason}
          >
            认输
          </button>
        </main>
      ) : (
        <main className="table-shell">
          <PlayerBoard
            player={opponent}
            viewerPlayerId={viewerPlayerId}
            sideName="对手公开区域"
            selectedCardId={null}
            canSelect={false}
            isActive={projection?.activePlayerId === opponent?.playerId}
            resolveCardInfo={resolveCardInfo}
          />

          <ChainPanel projection={projection} />

          <PlayerBoard
            player={self}
            viewerPlayerId={viewerPlayerId}
            sideName="我的区域"
            selectedCardId={selectedCardId}
            onSelectCard={card => {
              setSelectedCardId(card.instanceId);
            }}
            onPlayCard={playCard}
            canSelect={actionState.canPass || actionState.canRespondPrompt}
            isActive={projection?.activePlayerId === viewerPlayerId}
            resolveCardInfo={resolveCardInfo}
          />
        </main>
      )}

      {activeTab === "game-table" && duelProjection === null && !fullProductEnabled ? (
        <footer className="bottom-rail">
          <ActionBar
            selectedCard={selectedCard}
            canAct={actionState.canPass}
            canPlay={actionState.canPlay}
            blockedReason={actionState.blockedReason}
            onPass={pass}
            onPlayCard={playCard}
            selectedCardLabel={selectedCardLabel}
          />
        </footer>
      ) : null}

      {activeTab === "game-table" && duelProjection === null ? (
        <aside className="side-rail">
          {controls}
          {roomId ? chat : null}
          {!fullProductEnabled ? <PromptPanel
            prompt={projection?.prompt ?? null}
            viewerPlayerId={viewerPlayerId}
            pendingOptionId={pendingOptionId}
            disabled={commandPending || !actionState.canRespondPrompt}
            onRespond={(promptId, optionId, stateVersion) => {
              setPendingOptionId(optionId);
              respondPrompt(promptId, optionId, stateVersion);
            }}
          /> : null}
          <LogPanel log={mergedGameEvents} />
        </aside>
      ) : null}
    </div>
    </AppShell>
  );
}

interface UiBootstrap {
  readonly storage: Storage | null;
  readonly library: DeckLibrary;
  readonly preferences: UiPreferences;
  readonly restoredDeck: DeckByZone;
}

/**
 * Tolerant, single-shot read of the three independent local keys this app owns
 * at mount. Each reader degrades to empty on missing/corrupt data and never
 * throws, so a broken storage never blocks the editor.
 */
function createUiBootstrap(): UiBootstrap {
  const storage = typeof window === "undefined" ? null : window.localStorage;
  return {
    storage,
    library: readDeckLibrary(storage),
    preferences: readUiPreferences(storage),
    restoredDeck: readStoredDeck(storage)
  };
}

export function allowedZonesFor(card: CatalogCard): readonly DeckZone[] {
  if (card.allowedZones !== undefined) return card.allowedZones;
  return allowedZonesFromCardType(card);
}

export function isCardAbilityImplemented(card: CatalogCard): boolean {
  const supportedFoundationTypes = new Set([
    "unit",
    "spell",
    "battlefield",
    "champion",
    "legend"
  ]);

  return card.ability.trim().length === 0 &&
    supportedFoundationTypes.has(card.cardType.trim().toLowerCase());
}

export function canSubmitRoomDeck(options: {
  requestPending: boolean;
  roomStatus: "waiting" | "playing" | "ended" | null;
}): boolean {
  return !options.requestPending && options.roomStatus === "waiting";
}

function mergeEvents(
  left: readonly GameEvent[],
  right: readonly GameEvent[]
): readonly GameEvent[] {
  const bySeq = new Map(left.map(event => [event.seq, event]));
  for (const event of right) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function allowedZonesFromCardType(card: CatalogCard): readonly DeckZone[] {
  const cardType = card.cardType.toLowerCase();
  const tags = card.tags.map(tag => tag.toLowerCase());
  if (cardType === "rune") return ["runes"];
  if (cardType === "legend") return ["legend"];
  if (cardType === "battlefield") return ["battlefields"];
  if (cardType === "champion" || tags.includes("champion")) {
    return ["mainDeck", "champion", "sideboard"];
  }
  return ["mainDeck", "sideboard"];
}

export function limitFor(card: CatalogCard, zone: DeckZone): number {
  const zoneLimit =
    zone === "runes" ? 12 :
    zone === "battlefields" ? 1 :
    zone === "legend" ? 1 :
    3;
  return card.maxCopies === undefined ? zoneLimit : Math.min(card.maxCopies, zoneLimit);
}

export function buildCardLimits(
  cards: readonly CatalogCard[],
  activeZone: DeckZone,
  deck: DeckByZone
): Map<string, number> {
  const candidates = new Map<string, { limit: number; hasLegalPrinting: boolean }>();

  const limits = new Map<string, number>();
  for (const card of cards) {
    if (!allowedZonesFor(card).includes(activeZone)) continue;

    const current = candidates.get(card.canonicalCardId) ?? {
      limit: 0,
      hasLegalPrinting: false
    };
    const printingLimit = limitFor(card, activeZone);
    if (
      card.banned !== true &&
      card.available !== false &&
      printingLimit > 0
    ) {
      current.limit = Math.max(current.limit, printingLimit);
      current.hasLegalPrinting = true;
    }
    candidates.set(card.canonicalCardId, current);
  }

  for (const [canonicalCardId, candidate] of candidates) {
    const usedElsewhere = sharedLimitZones(activeZone)
      .filter(zone => zone !== activeZone)
      .reduce(
        (total, zone) => total + zoneCanonicalCount(deck, zone, canonicalCardId, cards),
        0
      );
    limits.set(
      canonicalCardId,
      candidate.hasLegalPrinting
        ? Math.max(0, candidate.limit - usedElsewhere)
        : 0
    );
  }
  return limits;
}

export function sharedLimitZones(activeZone: DeckZone): readonly DeckZone[] {
  const sharedZones: readonly DeckZone[] = ["mainDeck", "champion", "sideboard"];
  return sharedZones.includes(activeZone) ? sharedZones : [activeZone];
}

export function zoneCanonicalCount(
  deck: DeckByZone,
  zone: DeckZone,
  canonicalCardId: string,
  cards: readonly CatalogCard[]
): number {
  const printingIds = new Set(
    cards
      .filter(card => card.canonicalCardId === canonicalCardId)
      .map(card => card.id)
  );
  return Object.entries(deck[zone]).reduce(
    (total, [printingId, quantity]) =>
      printingIds.has(printingId) ? total + quantity : total,
    0
  );
}
