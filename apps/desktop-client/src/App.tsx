import { useCallback, useEffect, useMemo } from "react";
import {
  deckFingerprint,
  findNamedDeck,
  writeDeckLibrary,
  type DeckLibrary
} from "./decks/library";
import { clearAppliedDeckSelection, writeAppliedDeckSelection } from "./decks/ui-preferences";
import { beginDeckSwitch, evaluateDeckSwitch } from "./decks/room-confirmation";
import { AppView } from "./app/AppView";
import { useAppActions } from "./app/useAppActions";
import { useAppState } from "./app/useAppState";
import { useRoomDeckConfirmation } from "./app/useRoomDeckConfirmation";

export {
  allowedZonesFor,
  isCardAbilityImplemented,
  canSubmitRoomDeck,
  limitFor,
  buildCardLimits,
  sharedLimitZones,
  zoneCanonicalCount
} from "./app/deck-policy";

export function App() {
  const state = useAppState();
  const {
    errorRevision,
    roomId,
    roomView,
    setReady,
    roomRequestReceipt,
    roomRequestFailure,
    preferenceStorage,
    setDeckFromSnapshot,
    libraryStorage,
    library,
    setLibrary,
    setSelectedLibraryDeckId,
    setDraftName,
    setLibraryNotice,
    pendingSwitch,
    setPendingSwitch,
    viewerPlayerId,
    roomSelf,
    connected,
    gate
  } = state;
  const { applyDeckSelection } = useRoomDeckConfirmation(state);

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

  const actions = useAppActions({ ...state, commitLibrary });
  return <AppView {...state} {...actions} handleSelectDeck={handleSelectDeck} />;
}
