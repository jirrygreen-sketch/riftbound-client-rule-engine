import type { RoomRequestFailure, RoomRequestReceipt } from "../net/GameClient";
import type { DeckByZone } from "../hooks/useCardCatalog";
import { cloneDeckByZone } from "./library";

/**
 * Pure confirmation rules for the room requests the desktop client tracks.
 *
 * The transport (`net/GameClient.ts`) only reports a *matched* receipt: a
 * success message whose `requestId` equals a request this socket actually sent,
 * annotated with the room version the server acknowledged. It deliberately does
 * not decide what that receipt means for the UI. That decision lives here, and
 * the invariant is always the same: a request is confirmed only by its own
 * receipt combined with a room projection that has caught up to the receipt's
 * room version. A version bump, another player's broadcast, or a cleared
 * "request pending" flag is never evidence for anyone's request.
 */

export type RoomStatus = "waiting" | "playing" | "ended";

/** The room/actor a request was captured for; used to reject stale replies. */
export interface RoomConfirmationContext {
  readonly roomId: string | null;
  readonly playerId: string | null;
}

export function contextMatchesRoom(
  context: RoomConfirmationContext | null,
  roomId: string | null,
  playerId: string | null
): boolean {
  return context !== null && context.roomId === roomId && context.playerId === playerId;
}

export function contextMatchesReceipt(
  context: RoomConfirmationContext | null,
  receipt: Pick<RoomRequestReceipt, "roomId" | "playerId">
): boolean {
  return context !== null &&
    context.roomId === receipt.roomId &&
    context.playerId === receipt.playerId;
}

/* ------------------------------------------------------------------ *
 * Switching a deck while the seat is ready
 * ------------------------------------------------------------------ */

/**
 * A deck switch waiting for the server to accept `set-ready(false)`.
 *
 * The captured deck snapshot is the only deck this flow may ever apply: while
 * the request is in flight the user can keep editing the library, so re-reading
 * the named entry at confirmation time would install a deck the server never
 * acknowledged.
 */
export interface DeckSwitchTracker {
  readonly status: "pending" | "confirmed";
  /** Request id of the `set-ready(false)` that has to be acknowledged. */
  readonly requestId: string;
  readonly context: RoomConfirmationContext;
  readonly deckId: string;
  readonly deck: DeckByZone;
  readonly name: string;
  readonly baselineErrorRevision: number;
}

export interface BeginDeckSwitchInput {
  readonly requestId: string;
  readonly context: RoomConfirmationContext;
  readonly deckId: string;
  readonly deck: DeckByZone;
  readonly name: string;
  readonly errorRevision: number;
}

export function beginDeckSwitch(input: BeginDeckSwitchInput): DeckSwitchTracker {
  return {
    status: "pending",
    requestId: input.requestId,
    context: { roomId: input.context.roomId, playerId: input.context.playerId },
    deckId: input.deckId,
    deck: cloneDeckByZone(input.deck),
    name: input.name,
    baselineErrorRevision: input.errorRevision
  };
}

/**
 * Proof that the captured `set-ready(false)` request was acknowledged *and* the
 * room projection already shows the seat as not ready.
 */
export interface ReadyCancellationWitness {
  readonly requestId: string;
  readonly requestType: "set-ready";
  readonly ready: false;
  readonly roomId: string;
  readonly playerId: string;
  readonly roomVersion: number;
}

export type DeckSwitchAbandonReason =
  | "room-changed"
  | "room-status"
  | "disconnected"
  | "error"
  | "request-failed"
  | "missing-version";

export interface DeckSwitchEvidence {
  readonly connected: boolean;
  readonly roomId: string | null;
  readonly playerId: string | null;
  readonly roomStatus: RoomStatus | null;
  readonly roomVersion: number | null;
  readonly selfReady: boolean | null;
  readonly receipt: RoomRequestReceipt | null;
  readonly failure: RoomRequestFailure | null;
  readonly errorRevision: number;
}

export type DeckSwitchDecision =
  | { readonly status: "pending"; readonly tracker: DeckSwitchTracker }
  | {
      readonly status: "confirmed";
      readonly tracker: DeckSwitchTracker;
      readonly witness: ReadyCancellationWitness;
    }
  | {
      readonly status: "abandoned";
      readonly reason: DeckSwitchAbandonReason;
      readonly notice: string;
    };

function abandonDeckSwitch(
  reason: DeckSwitchAbandonReason,
  notice: string
): DeckSwitchDecision {
  return { status: "abandoned", reason, notice };
}

/**
 * Everything that invalidates the pending switch. Checked before the receipt so
 * that a later projection can never resurrect an abandoned wait.
 */
function abandonsDeckSwitch(
  tracker: DeckSwitchTracker,
  evidence: DeckSwitchEvidence
): DeckSwitchDecision | null {
  if (tracker.context.roomId !== evidence.roomId || tracker.context.playerId !== evidence.playerId) {
    return abandonDeckSwitch("room-changed", "房间已变化，切换卡组未完成，请重试。");
  }
  if (evidence.roomStatus !== "waiting") {
    return abandonDeckSwitch("room-status", "房间状态已变化，切换卡组未完成，请重试。");
  }
  if (!evidence.connected) {
    return abandonDeckSwitch("disconnected", "连接已断开，切换卡组未完成，请重试。");
  }
  if (evidence.errorRevision !== tracker.baselineErrorRevision) {
    return abandonDeckSwitch("error", "切换卡组未完成，请重试。");
  }
  const failure = evidence.failure;
  if (
    failure !== null &&
    failure.requestId === tracker.requestId &&
    failure.requestType === "set-ready" &&
    failure.roomId === tracker.context.roomId &&
    failure.playerId === tracker.context.playerId
  ) {
    return abandonDeckSwitch(
      "request-failed",
      "服务器未确认取消准备，切换卡组未完成，请重试。"
    );
  }
  return null;
}

/**
 * Decides what the current evidence means for a pending deck switch.
 *
 * `confirmed` requires the seat's own `set-ready(false)` receipt, a matching
 * captured context, a room revision that has caught up to the receipt, the
 * projection actually reporting `ready === false`, a live handshaken connection,
 * and a room that is still waiting. Anything else either keeps waiting or
 * abandons the switch; it is never applied optimistically.
 */
export function evaluateDeckSwitch(
  tracker: DeckSwitchTracker,
  evidence: DeckSwitchEvidence
): DeckSwitchDecision {
  const abandon = abandonsDeckSwitch(tracker, evidence);
  if (abandon !== null) return abandon;

  const receipt = evidence.receipt;
  if (
    receipt === null ||
    receipt.requestType !== "set-ready" ||
    receipt.requestId !== tracker.requestId
  ) {
    // No receipt for this request yet: another player's broadcast, a version
    // bump, or a receipt for a different request can never vouch for ours.
    return { status: "pending", tracker };
  }
  if (
    !contextMatchesReceipt(tracker.context, receipt) ||
    receipt.roomId !== evidence.roomId ||
    receipt.playerId !== evidence.playerId
  ) {
    // The receipt exists but was not issued for this room/actor.
    return { status: "pending", tracker };
  }
  if (receipt.ready !== false) {
    // A `set-ready(true)` receipt cannot cancel a ready seat.
    return { status: "pending", tracker };
  }
  if (receipt.roomVersion === undefined) {
    return abandonDeckSwitch(
      "missing-version",
      "服务器回执缺少房间版本，切换卡组未完成，请重试。"
    );
  }
  if (evidence.roomVersion === null || evidence.roomVersion < receipt.roomVersion) {
    // The room projection has not reached the acknowledged revision yet.
    return { status: "pending", tracker };
  }
  if (evidence.selfReady !== false) {
    // Wait for the matching projection instead of inferring readiness from the
    // room version alone.
    return { status: "pending", tracker };
  }
  return {
    status: "confirmed",
    tracker: { ...tracker, status: "confirmed" },
    witness: {
      requestId: tracker.requestId,
      requestType: "set-ready",
      ready: false,
      roomId: receipt.roomId,
      playerId: receipt.playerId,
      roomVersion: receipt.roomVersion
    }
  };
}

/* ------------------------------------------------------------------ *
 * Plain submit-deck / set-ready receipts
 * ------------------------------------------------------------------ */

export interface SubmissionReceiptEvidence {
  readonly receipt: RoomRequestReceipt;
  readonly pendingRequestId: string | null;
  readonly context: RoomConfirmationContext | null;
  readonly roomId: string | null;
  readonly playerId: string | null;
  readonly roomVersion: number | null;
}

export type SubmissionReceiptDecision =
  | { readonly kind: "ignored" }
  | { readonly kind: "waiting" }
  | { readonly kind: "confirmed"; readonly roomVersion: number }
  | { readonly kind: "abandoned"; readonly notice: string };

/**
 * Confirms a `submit-deck` only from its own matched receipt plus a room
 * revision at least as new as the acknowledged one. A receipt without a room
 * version, or one that no longer belongs to the captured room context, drops the
 * in-flight marker without touching the last confirmed deck.
 */
export function evaluateSubmitDeckReceipt(
  evidence: SubmissionReceiptEvidence
): SubmissionReceiptDecision {
  const receipt = evidence.receipt;
  if (receipt.requestType !== "submit-deck") return { kind: "ignored" };
  if (evidence.pendingRequestId === null || evidence.pendingRequestId !== receipt.requestId) {
    return { kind: "ignored" };
  }
  if (
    !contextMatchesReceipt(evidence.context, receipt) ||
    receipt.roomId !== evidence.roomId ||
    receipt.playerId !== evidence.playerId
  ) {
    return { kind: "abandoned", notice: "房间已变化，本次提交未确认，请重试。" };
  }
  if (receipt.roomVersion === undefined) {
    return { kind: "abandoned", notice: "服务器回执缺少房间版本，本次提交未确认，请重试。" };
  }
  if (evidence.roomVersion === null || evidence.roomVersion < receipt.roomVersion) {
    return { kind: "waiting" };
  }
  return { kind: "confirmed", roomVersion: receipt.roomVersion };
}

export interface ReadyReceiptEvidence {
  readonly receipt: RoomRequestReceipt;
  readonly pendingRequestId: string | null;
  readonly context: RoomConfirmationContext | null;
  readonly roomId: string | null;
  readonly playerId: string | null;
  readonly roomVersion: number | null;
  readonly selfReady: boolean | null;
}

export type ReadyReceiptDecision =
  | { readonly kind: "ignored" }
  | { readonly kind: "waiting" }
  | { readonly kind: "acknowledged" }
  | { readonly kind: "abandoned"; readonly notice: string };

/**
 * Acknowledge a plain `set-ready` toggle (not tied to a deck switch) once both
 * its receipt and the projection that carries the new ready flag are visible.
 */
export function evaluateReadyReceipt(evidence: ReadyReceiptEvidence): ReadyReceiptDecision {
  const receipt = evidence.receipt;
  if (receipt.requestType !== "set-ready") return { kind: "ignored" };
  if (evidence.pendingRequestId === null || evidence.pendingRequestId !== receipt.requestId) {
    return { kind: "ignored" };
  }
  if (
    !contextMatchesReceipt(evidence.context, receipt) ||
    receipt.roomId !== evidence.roomId ||
    receipt.playerId !== evidence.playerId
  ) {
    return { kind: "abandoned", notice: "房间已变化，本次准备状态未确认，请重试。" };
  }
  if (receipt.roomVersion === undefined) {
    return { kind: "abandoned", notice: "服务器回执缺少房间版本，本次准备状态未确认，请重试。" };
  }
  if (evidence.roomVersion === null || evidence.roomVersion < receipt.roomVersion) {
    return { kind: "waiting" };
  }
  if (evidence.selfReady === null) return { kind: "waiting" };
  if (evidence.selfReady === receipt.ready) return { kind: "acknowledged" };
  return { kind: "waiting" };
}
