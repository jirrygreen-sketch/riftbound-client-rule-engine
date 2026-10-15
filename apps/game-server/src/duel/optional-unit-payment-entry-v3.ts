/**
 * V3 entry adapter for the optional pure-Accelerate Unit payment flow.
 *
 * The V1 P6 service intentionally binds a choice to the head at which the
 * choice was issued.  That is correct for the initial proof, but the same
 * choice must also be usable after Core has advanced a native payment
 * continuation.  This adapter keeps the original receipt and journal
 * capability private, then rebuilds the complete entry facts from the current
 * head after Core proves that the payment continuation is closed.
 */
import {
  inspectDuelOptionalUnitPaymentV3,
  type DuelCanonicalPlayingStateV2,
  type DuelOptionalPlayReceiptDataV1,
  type DuelOptionalPlayReceiptV1,
  type DuelUnitEntryFactsV2,
  type DuelUnitEntryRequestV2,
  type DuelUnitEntryServiceV2,
  type DuelUnitPlaySessionV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import type { CardProgramAuthority } from "./card-program-authority.js";
import { createP4PureAccelerateEntryBoundaryV1 } from "./optional-unit-entry-boundary-v1.js";
import { createOptionalUnitNativeSourceP6, type OptionalUnitEntryBoundaryProofP6,
  type OptionalUnitNativeSourceInspectionP6 } from "./optional-unit-native-source-p6.js";
import {
  inspectDuelNativeOperationJournalBindingV2,
  type DuelNativeOperationJournalV2,
} from "./operation-journal-v2.js";

export interface OptionalUnitPaymentEntryV3Options {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  /** The exact current server head, owned by the same runtime as the journal. */
  readonly currentHead: () => DuelCanonicalPlayingStateV2;
  /** The nominal journal generation that owns the current head. */
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  /** The exact Unit action session currently owned by Core. */
  readonly currentUnitSession: () => DuelUnitPlaySessionV2;
  /** Identity guarded inspector from the genuine choice authority. */
  readonly inspectChoice: (receipt: DuelOptionalPlayReceiptV1) => DuelOptionalPlayReceiptDataV1;
}

export interface OptionalUnitPaymentEntryV3 {
  /**
   * Returns the entry service for one genuine choice receipt.  The returned
   * service is safe to retain across the payment window: it uses the same
   * receipt and journal capability when Core resumes the play.
   */
  readonly entryForReceipt: (receipt: DuelOptionalPlayReceiptV1) => DuelUnitEntryServiceV2;
}

type JournalPin = Readonly<{
  readonly authority: symbol;
}>;

type ReceiptPin = {
  readonly receipt: DuelOptionalPlayReceiptV1;
  readonly choice: DuelOptionalPlayReceiptDataV1;
  pin?: JournalPin;
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function unknownFacts(request: DuelUnitEntryRequestV2): DuelUnitEntryFactsV2 {
  return {
    matchId: request.matchId,
    stateVersion: request.stateVersion,
    eventSeq: request.eventSeq,
    actor: request.actor,
    uid: request.uid,
    cardId: request.cardId,
    sourceEpoch: request.sourceEpoch,
    baseLocationId: request.baseLocationId,
    programId: request.programId,
    sourceCensus: "unknown",
    sources: [],
    scopes: { play: "unknown", replacement: "unknown", static: "unknown",
      trigger: "unknown", pendingTasks: "unknown", chain: "unknown" },
  };
}

function completeScopes(value: OptionalUnitEntryBoundaryProofP6["scopes"]): boolean {
  return ["play", "replacement", "static", "trigger", "pendingTasks", "chain"]
    .every(key => value[key as keyof typeof value] === "clear");
}

function validJournalPin(options: OptionalUnitPaymentEntryV3Options,
  head: DuelCanonicalPlayingStateV2, pin?: JournalPin): JournalPin | null {
  let journal: DuelNativeOperationJournalV2;
  try { journal = options.currentJournal(); } catch { return null; }
  const binding = inspectDuelNativeOperationJournalBindingV2(journal);
  if (!binding || binding.journal !== journal ||
      (pin && binding.authority !== pin.authority) ||
      binding.head !== head || binding.observed !== head ||
      binding.census.matchId !== head.matchId ||
      binding.census.stateVersion !== head.stateVersion ||
      binding.census.eventSeq !== head.eventSeq ||
      options.currentJournal() !== journal || options.currentHead() !== head)
    return null;
  return pin ?? Object.freeze({ authority: binding.authority });
}

function choiceMatches(choice: DuelOptionalPlayReceiptDataV1,
  request: DuelUnitEntryRequestV2): boolean {
  return choice.matchId === request.matchId && choice.actor === request.actor &&
    choice.uid === request.uid && choice.cardId === request.cardId &&
    choice.sourceEpoch === request.sourceEpoch &&
    choice.sourceProgramFingerprint === request.programId &&
    (choice.decision === "pay" || choice.decision === "decline");
}

function proofFacts(request: DuelUnitEntryRequestV2,
  inspected: OptionalUnitNativeSourceInspectionP6,
  proof: OptionalUnitEntryBoundaryProofP6,
  programs: CardProgramAuthority): DuelUnitEntryFactsV2 | null {
  if (inspected.status !== "complete" || !inspected.census || !completeScopes(proof.scopes) ||
      proof.matchId !== request.matchId || proof.stateVersion !== request.stateVersion ||
      proof.eventSeq !== request.eventSeq || proof.actor !== request.actor ||
      proof.uid !== request.uid || proof.cardId !== request.cardId ||
      proof.sourceEpoch !== request.sourceEpoch || proof.baseLocationId !== request.baseLocationId ||
      proof.programId !== request.programId || proof.sources.length !== inspected.candidates.length)
    return null;
  const byUID = new Map(inspected.candidates.map(candidate => [candidate.uid, candidate]));
  const seen = new Set<string>();
  const sources: DuelUnitEntryFactsV2["sources"][number][] = [];
  for (const source of proof.sources) {
    const actual = source?.candidate && byUID.get(source.candidate.uid);
    if (!actual || actual !== source.candidate || seen.has(actual.uid) ||
        source.disposition !== "known-no-effect" || actual.cardId === null) return null;
    const zoneEpoch = actual.zoneEpoch;
    if (typeof zoneEpoch !== "number" || !Number.isSafeInteger(zoneEpoch) || zoneEpoch < 0) return null;
    const programId = actual.uid === request.uid ? request.programId :
      programs.resolvedProgramReference(actual.cardId)?.programId;
    if (!programId || source.programId !== programId) return null;
    seen.add(actual.uid);
    sources.push({ uid: actual.uid, zoneEpoch, programId,
      disposition: "known-no-effect" });
  }
  if (seen.size !== inspected.candidates.length || !seen.has(request.uid)) return null;
  return {
    matchId: request.matchId, stateVersion: request.stateVersion, eventSeq: request.eventSeq,
    actor: request.actor, uid: request.uid, cardId: request.cardId,
    sourceEpoch: request.sourceEpoch, baseLocationId: request.baseLocationId,
    programId: request.programId, sourceCensus: "complete", sources,
    scopes: { ...proof.scopes },
  };
}

export function createOptionalUnitPaymentEntryV3(
  options: OptionalUnitPaymentEntryV3Options,
): OptionalUnitPaymentEntryV3 {
  const boundary = createP4PureAccelerateEntryBoundaryV1({ catalog: options.catalog,
    programs: options.programs, currentHead: options.currentHead });
  const native = createOptionalUnitNativeSourceP6({ catalog: options.catalog,
    programs: options.programs, currentHead: options.currentHead,
    currentJournal: options.currentJournal,
    inspectChoice: options.inspectChoice, verifyEntryBoundary: boundary });
  const pins = new WeakMap<object, ReceiptPin>();
  let reading = false;
  let poisoned = false;

  const entryForReceipt = (rawReceipt: DuelOptionalPlayReceiptV1): DuelUnitEntryServiceV2 => {
    if (reading) {
      poisoned = true;
      return request => unknownFacts(request);
    }
    let pin: ReceiptPin | undefined;
    try {
      if (!rawReceipt || typeof rawReceipt !== "object") return request => unknownFacts(request);
      const choice = options.inspectChoice(rawReceipt);
      pin = pins.get(rawReceipt as object);
      if (!pin) {
        pin = { receipt: rawReceipt, choice };
        pins.set(rawReceipt as object, pin);
      } else if (pin.receipt !== rawReceipt || !same(pin.choice, choice)) {
        return request => unknownFacts(request);
      }
    } catch {
      return request => unknownFacts(request);
    }

    return request => {
      const fallback = unknownFacts(request);
      if (reading) {
        poisoned = true;
        return fallback;
      }
      reading = true;
      poisoned = false;
      try {
        if (!pin || !choiceMatches(pin.choice, request)) return fallback;
        const head = options.currentHead();
        const currentSession = options.currentUnitSession();
        if (!currentSession || currentSession.commandSession.match !== head ||
            head !== request.match || head.matchId !== request.matchId ||
            head.stateVersion !== request.stateVersion || head.eventSeq !== request.eventSeq)
          return fallback;
        // Core's identity-guarded inspector rejects copied action sessions, even
        // before the optional payment has been opened.
        const payment = inspectDuelOptionalUnitPaymentV3(currentSession);

        /* Every call at the issue head retains the strict V1 behavior. */
        if (pin.choice.stateVersion === request.stateVersion) {
          const result = native.entryForReceipt(rawReceipt)(request);
          if (result.sourceCensus !== "complete") return fallback;
          const journal = validJournalPin(options, head, pin.pin);
          if (!journal) return fallback;
          pin.pin ??= journal;
          if (!validJournalPin(options, head, pin.pin) ||
              options.currentUnitSession() !== currentSession) return fallback;
          return poisoned ? fallback : result;
        }

        /* A receipt may not be rebound to an unrelated continuation. */
        if (pin.choice.stateVersion > request.stateVersion || !pin.pin) return fallback;
        const journal = validJournalPin(options, head, pin.pin);
        if (!journal) return fallback;
        if (!payment || (payment.status !== "pending" && payment.status !== "completed") ||
            payment.actor !== pin.choice.actor ||
            payment.commandId !== pin.choice.commandId ||
            payment.cardUID !== pin.choice.uid || payment.cardId !== pin.choice.cardId ||
            payment.sourceEpoch !== pin.choice.sourceEpoch ||
            payment.programFingerprint !== pin.choice.sourceProgramFingerprint ||
            payment.decision !== pin.choice.decision || payment.baseLocationId !== request.baseLocationId ||
            payment.sourceUID !== pin.choice.uid || payment.taskId.length === 0 ||
            payment.paymentId.length === 0) return fallback;
        const task = currentSession.commandSession.requiredTasks.find(item => item.taskId === payment.taskId);
        const paymentBinding = currentSession.commandSession.priorityPayments.find(item =>
          item.paymentId === payment.paymentId);
        if (!task || task.status !== "completed" || task.actor !== payment.actor ||
            task.matchId !== head.matchId || task.paymentId !== payment.paymentId ||
            task.continuationId !== payment.continuationId ||
            task.opaqueSource.kind !== "card" || task.opaqueSource.referenceId !== payment.cardId ||
            task.opaqueSource.sourceUID !== payment.sourceUID ||
            !same(task.finalResolvedCost, payment.resolvedCost) ||
            (paymentBinding && (paymentBinding.status !== "completed" ||
              paymentBinding.actor !== payment.actor ||
              !same(paymentBinding.finalResolvedCost, payment.resolvedCost) ||
              !same(paymentBinding.opaqueSource, task.opaqueSource) ||
              paymentBinding.sourceBinding.taskId !== payment.taskId ||
              paymentBinding.sourceBinding.continuationId !== payment.continuationId)) ||
            head.frame.pendingPayment !== null ||
            currentSession.commandSession.requiredTasks.some(item => item.status !== "completed") ||
            currentSession.commandSession.priorityPayments.some(item => item.status !== "completed"))
          return fallback;

        const inspected = native.inspect(request);
        if (inspected.status !== "complete" || !inspected.census) return fallback;
        const proof = boundary(request, inspected.candidates, inspected.census);
        if (!proof) return fallback;
        const facts = proofFacts(request, inspected, proof, options.programs);
        if (!facts || options.currentHead() !== head ||
            options.currentUnitSession() !== currentSession ||
            !validJournalPin(options, head, pin.pin)) return fallback;
        return poisoned ? fallback : facts;
      } catch {
        return fallback;
      } finally {
        reading = false;
      }
    };
  };

  return Object.freeze({ entryForReceipt });
}

export const createDuelOptionalUnitPaymentEntryV3 = createOptionalUnitPaymentEntryV3;
