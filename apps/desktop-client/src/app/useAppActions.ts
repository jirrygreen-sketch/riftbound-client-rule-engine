import { useCallback } from "react";
import {
  cloneDeckByZone,
  deckFingerprint,
  findNamedDeck,
  removeNamedDeck,
  saveNamedDeck,
  updateNamedDeck,
  writeDeckLibrary
} from "../decks/library";
import { clearAppliedDeckSelection, writeAppliedDeckSelection } from "../decks/ui-preferences";
import { buildPlayableCommand } from "../full-product/transport";
import { type DeckByZone } from "../hooks/useCardCatalog";
import type { DeckLibrary } from "../decks/library";
import type { AppState } from "./useAppState";

export function useAppActions({
  errorRevision,
  roomId,
  roomView,
  submitPlayerCommand,
  submitDeck,
  setReady,
  preferenceStorage,
  actionSelection,
  catalogStatus,
  deck,
  setDeckFromSnapshot,
  libraryStorage,
  library,
  setLibrary,
  selectedLibraryDeckId,
  setSelectedLibraryDeckId,
  draftName,
  setDraftName,
  setLibraryNotice,
  setSubmission,
  setPendingReadyRequestId,
  submissionContextRef,
  pendingReadyContextRef,
  viewerPlayerId,
  roomSelf,
  playableMatchView,
  currentFingerprint,
  gate,
  commitLibrary
}: AppState & {
  commitLibrary: (next: DeckLibrary, message: string | null) => void;
}) {
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

  return {
    handleSaveAsNamed,
    importDeck,
    handleUpdateSelected,
    handleDeleteSelected,
    submitCurrentDeck,
    toggleReady,
    submitPlayableSelection
  };
}

export type AppActions = ReturnType<typeof useAppActions> & {
  readonly handleSelectDeck: (deckId: string | null) => void;
};
