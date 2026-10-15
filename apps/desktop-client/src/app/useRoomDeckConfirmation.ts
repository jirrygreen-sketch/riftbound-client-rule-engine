import { useCallback, useEffect } from "react";
import { deckFingerprint, findNamedDeck } from "../decks/library";
import { writeAppliedDeckSelection } from "../decks/ui-preferences";
import { evaluateReadyReceipt, evaluateSubmitDeckReceipt } from "../decks/room-confirmation";
import type { AppState } from "./useAppState";

export function useRoomDeckConfirmation({
  errorRevision,
  roomId,
  roomView,
  roomRequestReceipt,
  roomRequestFailure,
  preferenceStorage,
  setDeckFromSnapshot,
  library,
  setSelectedLibraryDeckId,
  setDraftName,
  setLibraryNotice,
  submission,
  setSubmission,
  pendingReadyRequestId,
  setPendingReadyRequestId,
  submissionContextRef,
  pendingReadyContextRef,
  viewerPlayerId,
  roomSelf,
  connected
}: AppState) {
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

  return { applyDeckSelection };
}
