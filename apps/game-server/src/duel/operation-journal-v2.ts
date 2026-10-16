/**
 * Native Core operation journal for the server source-closure boundary.
 *
 * The journal is intentionally an in-process capability.  It never accepts a
 * copied match, a copied provenance object, or a candidate census as proof.
 * `observe` walks the Core-owned native ancestry and records every intermediate
 * commit before publishing a new observed head.  The source-closure DTO is
 * assembled only from those records and the currently admitted Core state.
 */
import { createHash } from "node:crypto";
import {
  assertAdmittedDuelMatchV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelNativeTokenHistoryV2,
  inspectDuelChainCommittedProofV2,
  type DuelChainCommittedProofV2,
  type DuelChainResolutionAuthorityV2,
  type DuelPhysicalZone,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  type DuelMatchStateV2,
  type DuelTokenBirthJournalEntryV2,
  type DuelTokenRetirementJournalEntryV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureDrawSubjectV2,
  type DuelPhaseSourceClosureLedgerV2,
  type DuelPhaseSourceClosureJournalInputV2,
  type DuelPhaseSourceClosurePreExitV2,
  type DuelPhaseSourceClosureRuntimeEntryV2,
  type DuelPhaseSourceClosureTransitionV2,
  type DuelPhaseSourceClosureEventV2,
  type DuelPhaseSourceClosurePhaseV2,
} from "@riftbound/engine-core/duel";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import { JournalWriter, digestJournalValue, type Journal } from "./runtime/journal/index.js";
const REQUIREMENTS: readonly DuelPhaseClosureRequirementV2[] = Object.freeze([
  "all-source-candidate-closure",
  "hidden-zone-event-subjects",
  "continuous-effect-registry",
  "cleanup-queue-and-replacements",
  "runtime-subevent-journal",
  "recursive-conquer-event-journal",
  "draw-subject-journal",
  "pre-exit-event-journal",
  "kill-trigger-effect-cases",
  "zone-transition-journal",
]);

const GOLD_REFERENCE = JSON.stringify({
  intrinsicId: "riftbound-duel-official-v1:intrinsic-token:gold-gear",
  kind: "duel-intrinsic-token-ability-reference",
  ruleset: "riftbound-duel-official-v1",
  schemaVersion: 1,
});

type NativeEventV2 = DuelPhaseSourceClosureEventV2 | "mulligan" | "setup" | "channel" | "intrinsic-step" | "unknown";
type RuntimeLedgerNameV2 = "activeEffects" | "chain" | "effectQueue" | "feprOutstanding";
type RuntimeLedgerStatusV2 = "pending" | "resolved";

export interface DuelNativeOperationLabelV2 {
  readonly operationId: string;
  readonly eventId: string;
  readonly event: NativeEventV2;
  readonly phase?: DuelPhaseSourceClosurePhaseV2;
  /** A phase context is bound to the exact commit clock and task identity. */
  readonly taskId?: string;
  readonly sourceUID?: string;
  readonly controllerPlayerId?: string;
}

export interface DuelNativeObservedCommitV2 extends DuelNativeOperationLabelV2 {
  /** Optional explicit clock guard.  The native path remains the authority. */
  readonly stateVersion?: number;
  readonly eventSeq?: number;
}

export interface DuelNativeOperationPathV2 {
  readonly ancestor: DuelMatchStateV2;
  readonly descendant: DuelMatchStateV2;
  /** Exactly one trusted owner label for every native commit in the path. */
  readonly commits?: readonly DuelNativeObservedCommitV2[];
  /** Compatibility names for callers that call the same labels operations. */
  readonly labels?: readonly DuelNativeObservedCommitV2[];
  readonly operations?: readonly DuelNativeObservedCommitV2[];
}

export interface DuelNativeSourceWorkV2 {
  readonly operationId: string;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly sourceUID: string;
  readonly zoneEpoch: number;
  readonly controllerPlayerId: string | null;
  readonly programReference: string;
  readonly status?: RuntimeLedgerStatusV2;
}

export interface DuelNativeRuntimeEffectV2 {
  readonly ledger: RuntimeLedgerNameV2;
  readonly operationId: string;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly entry: DuelPhaseSourceClosureRuntimeEntryV2;
  /** Private owner binding; a similarly named effect in another Chain cannot close this work. */
  readonly resolutionBinding?: {
    readonly authority: DuelChainResolutionAuthorityV2;
    readonly chainId: string;
    readonly executorId: string;
  };
  /** A resolved entry needs the actual executor receipt for the enrolled Chain. */
  readonly resolution?: {
    readonly eventId: string;
    readonly proofId: string;
    readonly committedProof?: DuelChainCommittedProofV2;
  };
}

export interface DuelNativeRuntimeRetirementV2 {
  readonly ledger: RuntimeLedgerNameV2;
  readonly operationId: string;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly effectId: string;
  readonly committedProof?: DuelChainCommittedProofV2;
}

export interface DuelNativeOperationJournalOptionsV2 {
  readonly genesis: DuelMatchStateV2;
  /** Optional owner callback.  A copied state returned by this callback fails closed. */
  readonly currentHead?: () => DuelMatchStateV2 | null;
  readonly getCurrentHead?: () => DuelMatchStateV2 | null;
  /** Detached program references from the genuine server registry. */
  readonly programReference?: (cardId: string) => string | undefined;
  /** Convenience binding for the genuine CardProgramAuthority. */
  readonly programs?: CardProgramAuthority;
}

export interface DuelProtectedGlobalSourceSnapshotV2 {
  readonly scope: "exact";
  readonly status: "resolved";
  readonly input: DuelPhaseSourceClosureJournalInputV2;
  readonly candidateKeys: readonly string[];
  readonly journalRevision: number;
  readonly candidateSetRevision: number;
  readonly proofId: string;
  readonly coverage: readonly {
    readonly requirement: DuelPhaseClosureRequirementV2;
    readonly journalRevision: number;
    readonly proofId: string;
  }[];
}

/** Private cost census. Pending work is reported as pending, never phase-closed. */
export interface DuelNativeCostSourceV2 {
  readonly uid: string;
  readonly sourceEpoch: number | null;
  readonly cardId: string | null;
  readonly ownerPlayerId: string | null;
  readonly controllerPlayerId: string | null;
  readonly programReference: string | null;
  readonly carrier: "object" | "pre-exit" | "runtime-effect" | "source-work";
  readonly zone: DuelPhysicalZone;
  readonly bindingRevision: number;
  readonly status: "live" | "pending" | "resolved";
  readonly ledger?: RuntimeLedgerNameV2;
  readonly effectId?: string;
  readonly sourceUID?: string;
}

export interface DuelNativeCostCensusV2 {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly journalRevision: number;
  readonly candidateSetRevision: number;
  readonly sources: readonly DuelNativeCostSourceV2[];
  readonly unresolvedNativeHistory: boolean;
  readonly phaseClosed: false;
}

export interface DuelNativeOperationJournalV2 {
  readonly read: (context: DuelPhaseSourceClosureContextV2) => DuelProtectedGlobalSourceSnapshotV2 | null;
  readonly readCostCensus: () => DuelNativeCostCensusV2 | null;
  readonly tokenBirth: (uid: string) => DuelTokenBirthJournalEntryV2 | null;
  readonly tokenRetirement: (uid: string) => DuelTokenRetirementJournalEntryV2 | null;
  readonly currentHead: () => DuelMatchStateV2;
  readonly observedHead: () => DuelMatchStateV2;
  readonly observe: (path: DuelNativeOperationPathV2) => void;
  readonly observeNativePath: (path: DuelNativeOperationPathV2) => void;
  readonly observeCommitPath: (path: DuelNativeOperationPathV2) => void;
  readonly bindContext: (context: DuelPhaseSourceClosureContextV2, operationId?: string) => void;
  readonly registerSourceWork: (work: DuelNativeSourceWorkV2) => void;
  readonly registerSource: (work: DuelNativeSourceWorkV2) => void;
  readonly registerRuntimeEffect: (effect: DuelNativeRuntimeEffectV2) => void;
  readonly registerEffect: (effect: DuelNativeRuntimeEffectV2) => void;
  readonly retireRuntimeEffect: (retirement: DuelNativeRuntimeRetirementV2) => void;
  readonly listCommits: () => readonly DuelNativeJournalCommitV2[];
  /** Private proposal fork. A caller can discard it without advancing the published journal. */
  readonly fork: (currentHead?: () => DuelMatchStateV2 | null) => DuelNativeOperationJournalV2;
  readonly revision: () => number;
  readonly journal: () => Journal;
}

export interface DuelNativeJournalTransitionV2 {
  readonly operationId: string;
  readonly eventId: string;
  readonly uid: string;
  readonly from: DuelPhysicalZone;
  readonly to: DuelPhysicalZone;
  readonly fromZoneEpoch: number;
  readonly toZoneEpoch: number;
  readonly proofId: string;
}

export interface DuelNativeJournalCommitV2 {
  readonly before: DuelMatchStateV2;
  readonly after: DuelMatchStateV2;
  readonly label: DuelNativeOperationLabelV2;
  readonly transitions: readonly DuelNativeJournalTransitionV2[];
  readonly preExitSources: readonly DuelPhaseSourceClosurePreExitV2[];
  readonly drawSubjects: readonly DuelPhaseSourceClosureDrawSubjectV2[];
  readonly tokenBirths: readonly DuelTokenBirthJournalEntryV2[];
  readonly tokenRetirements: readonly DuelTokenRetirementJournalEntryV2[];
  readonly unresolved: boolean;
}

interface RuntimeRecordV2 {
  readonly ledger: RuntimeLedgerNameV2;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly entry: DuelPhaseSourceClosureRuntimeEntryV2;
  readonly operationId: string;
  readonly status: RuntimeLedgerStatusV2;
  readonly proofId: string;
  readonly resolutionBinding?: DuelNativeRuntimeEffectV2["resolutionBinding"];
}

interface WorkRecordV2 extends DuelNativeSourceWorkV2 {
  readonly status: RuntimeLedgerStatusV2;
}

interface ContextRecordV2 {
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly operationId: string;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor && "value" in descriptor) freezeDeep(descriptor.value, seen);
  }
  Object.freeze(value);
  return value;
}

function zoneKey(zone: DuelPhysicalZone): string {
  return "locationId" in zone
    ? JSON.stringify([zone.kind, zone.locationId])
    : JSON.stringify([zone.kind, zone.zonePlayerId]);
}

function copyZone(zone: DuelPhysicalZone): DuelPhysicalZone {
  return "locationId" in zone
    ? { kind: zone.kind, locationId: zone.locationId }
    : { kind: zone.kind, zonePlayerId: zone.zonePlayerId };
}

function nonBoard(zone: DuelPhysicalZone): boolean {
  return zone.kind !== "board-base" && zone.kind !== "board-battlefield" && zone.kind !== "legend-zone";
}

function expectedEpoch(from: DuelPhysicalZone, to: DuelPhysicalZone, before: number): number {
  return before + (nonBoard(from) || nonBoard(to) ? 1 : 0);
}

function candidateKey(candidate: DuelPhaseSourceClosureCandidateV2): string {
  return JSON.stringify([
    candidate.carrier,
    candidate.uid,
    candidate.zoneEpoch,
    candidate.zone.kind,
    "locationId" in candidate.zone ? candidate.zone.locationId : candidate.zone.zonePlayerId,
  ]);
}

function contextKey(context: DuelPhaseSourceClosureContextV2): string {
  return JSON.stringify([
    context.matchId,
    context.dataVersion,
    context.catalogDigest,
    context.turn,
    context.taskId,
    context.phase,
    context.event,
    context.clock.stateVersion,
    context.clock.eventSeq,
  ]);
}

function contextCoreEqual(a: DuelPhaseSourceClosureContextV2, b: DuelPhaseSourceClosureContextV2): boolean {
  return a.matchId === b.matchId && a.dataVersion === b.dataVersion &&
    a.catalogDigest === b.catalogDigest && a.turn === b.turn && a.taskId === b.taskId &&
    a.phase === b.phase && a.event === b.event && same(a.clock, b.clock);
}

function eventIsClosureEvent(value: string): value is DuelPhaseSourceClosureEventV2 {
  return [
    "awaken", "begin", "hold", "channel", "draw", "main", "ending", "expiration",
    "fepr", "required-cleanup", "lethal-kill", "burnout", "pre-exit", "zone-transition",
    "draw-subject", "continuous", "chain", "effect-queue", "fepr-outstanding",
  ].includes(value);
}

function fail(label: string): never {
  throw new TypeError(`Duel native operation journal: ${label}`);
}

function assertLabel(label: DuelNativeObservedCommitV2): void {
  if (!nonBlank(label.operationId) || !nonBlank(label.eventId)) fail("operation and event IDs required");
  if (!["mulligan", "setup", "channel", "intrinsic-step", "unknown"].includes(label.event) &&
      !eventIsClosureEvent(label.event)) fail("unsupported operation event");
  if (label.phase !== undefined && !eventIsClosureEvent(label.phase)) fail("unsupported operation phase");
  if (label.taskId !== undefined && !nonBlank(label.taskId)) fail("empty task ID");
  if (label.sourceUID !== undefined && !nonBlank(label.sourceUID)) fail("empty source UID");
  if (label.controllerPlayerId !== undefined && !nonBlank(label.controllerPlayerId)) fail("empty controller");
  if (label.stateVersion !== undefined && !safeCount(label.stateVersion)) fail("invalid state version label");
  if (label.eventSeq !== undefined && !safeCount(label.eventSeq)) fail("invalid event sequence label");
}

function allCandidates(state: DuelMatchStateV2): readonly DuelPhaseSourceClosureCandidateV2[] {
  if (state.stage !== "playing") return Object.freeze([]);
  return enumerateDuelPhaseSourceClosureCandidatesV2(state);
}

function setupZoneMap(state: DuelMatchStateV2): ReadonlyMap<string, { readonly zone: DuelPhysicalZone; readonly epoch: number }> {
  const map = new Map<string, { zone: DuelPhysicalZone; epoch: number }>();
  const epochs = new Map<string, number>();
  const latest = new Map<string, DuelPhysicalZone>();
  for (const [uid, zone] of Object.entries(state.provenance.initialZonesByUID)) {
    latest.set(uid, copyZone(zone));
    epochs.set(uid, 0);
  }
  for (const step of state.provenance.transitions) {
    latest.set(step.uid, copyZone(step.to));
    epochs.set(step.uid, (epochs.get(step.uid) ?? 0) + (nonBoard(step.from) || nonBoard(step.to) ? 1 : 0));
  }
  for (const [uid, zone] of latest) map.set(uid, { zone, epoch: epochs.get(uid) ?? 0 });
  return map;
}

function candidateMaps(before: DuelMatchStateV2, after: DuelMatchStateV2): {
  readonly before: ReadonlyMap<string, DuelPhaseSourceClosureCandidateV2>;
  readonly after: ReadonlyMap<string, DuelPhaseSourceClosureCandidateV2>;
  readonly beforeZones: ReadonlyMap<string, { readonly zone: DuelPhysicalZone; readonly epoch: number }>;
  readonly afterZones: ReadonlyMap<string, { readonly zone: DuelPhysicalZone; readonly epoch: number }>;
} {
  const beforeValues = allCandidates(before);
  const afterValues = allCandidates(after);
  const beforeMap = new Map(beforeValues.map(candidate => [candidate.uid, candidate]));
  const afterMap = new Map(afterValues.map(candidate => [candidate.uid, candidate]));
  const beforeZones = setupZoneMap(before);
  const afterZones = setupZoneMap(after);
  for (const candidate of beforeValues) {
    if (candidate.zoneEpoch !== null) beforeZones instanceof Map && beforeZones.set(candidate.uid,
      { zone: copyZone(candidate.zone), epoch: candidate.zoneEpoch });
  }
  for (const candidate of afterValues) {
    if (candidate.zoneEpoch !== null) afterZones instanceof Map && afterZones.set(candidate.uid,
      { zone: copyZone(candidate.zone), epoch: candidate.zoneEpoch });
  }
  return { before: beforeMap, after: afterMap, beforeZones, afterZones };
}

function sourceFromBefore(
  before: DuelMatchStateV2,
  uid: string,
  maps: ReturnType<typeof candidateMaps>,
): DuelPhaseSourceClosureCandidateV2 | null {
  const source = maps.before.get(uid);
  if (source) return Object.freeze({ ...source, carrier: "pre-exit" as const, zone: Object.freeze(copyZone(source.zone)) });
  const location = maps.beforeZones.get(uid);
  if (!location) return null;
  const original = before.provenance.originalPhysicalCards.find(card => card.uid === uid);
  if (!original) return null;
  const kind: DuelPhaseSourceClosureCandidateV2["kind"] = original.cardType === "Champion"
    ? "champion" : original.cardType === "Legend" ? "legend" : original.cardType === "Battlefield"
      ? "battlefield" : original.cardType === "Rune" ? "rune" : "card";
  return Object.freeze({ uid, kind, cardId: original.cardId, zoneEpoch: location.epoch,
    controllerPlayerId: original.ownerPlayerId, zone: Object.freeze(copyZone(location.zone)),
    ownerPlayerId: original.ownerPlayerId, locationId: "locationId" in location.zone ? location.zone.locationId : null,
    attachedToUID: null, visibility: "internal", carrier: "pre-exit" });
}

function tokenReference(birth: DuelTokenBirthJournalEntryV2): {
  readonly uid: string;
  readonly kind: "gold" | "recruit";
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: "current" | "pre-exit";
  readonly controllerPlayerId: string;
  readonly referenceKind: "gold-cr-intrinsic" | "recruit-birth";
  readonly programReference: string;
  readonly sourceProofId: string;
} {
  if (birth.kind === "gold") return Object.freeze({
    uid: birth.tokenUID, kind: birth.kind, sourceEffectId: birth.sourceEffectId,
    eventId: birth.eventId, sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
    sourceMode: birth.sourceMode, controllerPlayerId: birth.controllerPlayerId,
    referenceKind: "gold-cr-intrinsic", programReference: GOLD_REFERENCE,
    sourceProofId: birth.sourceProofId,
  });
  return Object.freeze({
    uid: birth.tokenUID, kind: birth.kind, sourceEffectId: birth.sourceEffectId,
    eventId: birth.eventId, sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
    sourceMode: birth.sourceMode, controllerPlayerId: birth.controllerPlayerId,
    referenceKind: "recruit-birth", programReference: JSON.stringify({
      birthEventId: birth.eventId, catalogDigest: birth.catalogDigest,
      dataVersion: birth.dataVersion, kind: "recruit-birth-reference", matchId: birth.matchId,
      schemaVersion: 1, sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
      sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
      sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID,
    }), sourceProofId: birth.sourceProofId,
  });
}

function ledger(
  name: RuntimeLedgerNameV2,
  context: DuelPhaseSourceClosureContextV2,
  revision: number,
  entries: readonly RuntimeRecordV2[],
): DuelPhaseSourceClosureLedgerV2 {
  const active = entries.filter(item => item.ledger === name);
  return Object.freeze({
    status: active.length === 0 ? "empty" : "entries",
    ledgerId: `${name}:${context.matchId}`,
    revision,
    proofId: `native-journal:${name}:${revision}:${context.clock.stateVersion}:${context.clock.eventSeq}`,
    matchId: context.matchId, dataVersion: context.dataVersion, catalogDigest: context.catalogDigest,
    turn: context.turn, taskId: context.taskId, clock: Object.freeze({ ...context.clock }),
    entries: Object.freeze(active.map(item => Object.freeze({ ...item.entry, zone: Object.freeze(copyZone(item.entry.zone)) }))),
  });
}

function factCoverage(revision: number, census: readonly string[], input: DuelPhaseSourceClosureJournalInputV2):
  readonly DuelProtectedGlobalSourceSnapshotV2["coverage"][number][] {
  const facts = createHash("sha256").update(JSON.stringify([revision, census, input.transitions.length, input.drawSubjects.length,
    input.preExitSources.length, input.tokenReferences.length,
    input.activeEffects.entries.length, input.chain.entries.length,
    input.effectQueue.entries.length, input.feprOutstanding.entries.length])).digest("hex");
  return Object.freeze(REQUIREMENTS.map(requirement => Object.freeze({
    requirement, journalRevision: revision, proofId: `native-journal:observed-facts:${requirement}:${facts}`,
  })));
}

interface PrivateJournalSeed {
  readonly head: DuelMatchStateV2;
  readonly commits: readonly DuelNativeJournalCommitV2[];
  readonly operationIds: ReadonlySet<string>;
  readonly contexts: ReadonlyMap<string, ContextRecordV2>;
  readonly sourceWorks: ReadonlyMap<string, WorkRecordV2>;
  readonly runtime: ReadonlyMap<string, RuntimeRecordV2>;
  readonly handledEvents: ReadonlySet<string>;
  readonly revision: number;
  readonly candidateSetRevision: number;
  /** The authority minted for the root journal; forks inherit it by identity. */
  readonly nominalAuthority: symbol;
  readonly unifiedJournal?: Journal;
}

/**
 * This table is deliberately module-private.  A frozen object with the same
 * methods, a JSON clone, a Proxy, or a journal from another authority can
 * never acquire an entry in it.
 */
const NOMINAL_JOURNALS = new WeakMap<object, {
  readonly authority: symbol;
  readonly genesis: DuelMatchStateV2;
}>();
const GENUINE_JOURNALS = new WeakSet<object>();

export interface DuelNativeOperationJournalBindingV2 {
  /** Opaque identity token used only by trusted server owners to pin lineage. */
  readonly authority: symbol;
  readonly journal: DuelNativeOperationJournalV2;
  readonly head: DuelMatchStateV2;
  readonly observed: DuelMatchStateV2;
  readonly commits: readonly DuelNativeJournalCommitV2[];
  readonly census: DuelNativeCostCensusV2;
  readonly revision: number;
  readonly candidateSetRevision: number;
}

function nominalCensusMatchesHead(
  census: DuelNativeCostCensusV2,
  head: DuelMatchStateV2,
  revision: number,
  candidateSetRevision: number,
): boolean {
  if (!census || census.matchId !== head.matchId || census.stateVersion !== head.stateVersion ||
      census.eventSeq !== head.eventSeq || census.journalRevision !== revision ||
      census.candidateSetRevision !== candidateSetRevision || census.phaseClosed !== false ||
      !Array.isArray(census.sources)) return false;
  if (head.stage !== "playing") return false;
  const candidates = new Map(allCandidates(head).map(candidate => [candidate.uid, candidate]));
  const seenObjects = new Set<string>();
  for (const source of census.sources) {
    if (!source || !nonBlank(source.uid) || !safeCount(source.bindingRevision)) return false;
    if (source.carrier === "object") {
      const candidate = candidates.get(source.uid);
      if (!candidate || seenObjects.has(source.uid) || source.sourceEpoch !== candidate.zoneEpoch ||
          source.cardId !== candidate.cardId || source.ownerPlayerId !== candidate.ownerPlayerId ||
          source.controllerPlayerId !== candidate.controllerPlayerId ||
          zoneKey(source.zone) !== zoneKey(candidate.zone) || source.status !== "live" ||
          source.bindingRevision !== candidateSetRevision) return false;
      seenObjects.add(source.uid);
    }
  }
  return seenObjects.size === candidates.size;
}

/**
 * Read the process-local journal capability and its clocks in one guarded
 * operation.  The input must be the exact object returned by the factory (or
 * an exact lineage fork); structural lookalikes are intentionally rejected.
 */
export function inspectDuelNativeOperationJournalBindingV2(
  journal: unknown,
): DuelNativeOperationJournalBindingV2 | null {
  if (!journal || typeof journal !== "object" || !GENUINE_JOURNALS.has(journal)) return null;
  const identity = NOMINAL_JOURNALS.get(journal);
  if (!identity) return null;
  const value = journal as DuelNativeOperationJournalV2;
  try {
    const revision = value.revision();
    const candidateSetRevision = (() => {
      const census = value.readCostCensus();
      return census?.candidateSetRevision;
    })();
    const head = value.currentHead();
    const observed = value.observedHead();
    const commits = value.listCommits();
    const census = value.readCostCensus();
    if (!safeCount(revision) || !safeCount(candidateSetRevision) || !head || observed !== head ||
        !census || !nominalCensusMatchesHead(census, head, revision, candidateSetRevision) ||
        !Array.isArray(commits) || commits.length === 0 || commits.at(-1)?.after !== observed ||
        commits[0]?.before !== identity.genesis ||
        commits.slice(1).some((commit, index) => commit.before !== commits[index]!.after)) return null;
    const snapshot = JSON.stringify(census);
    // End-of-read re-attestation closes the window in which a trusted owner
    // could replace its head or census while this inspection was in progress.
    if (value.revision() !== revision || value.currentHead() !== head || value.observedHead() !== observed ||
        value.listCommits().at(-1)?.after !== observed ||
        JSON.stringify(value.readCostCensus()) !== snapshot) return null;
    return Object.freeze({ authority: identity.authority, journal: value, head, observed,
      commits: Object.freeze([...commits]), census, revision, candidateSetRevision });
  } catch { return null; }
}

/** Create a server-owned native operation journal. */
export function createDuelNativeOperationJournalV2(
  options: DuelNativeOperationJournalOptionsV2,
): DuelNativeOperationJournalV2 {
  return createJournal(options);
}
function createJournal(options: DuelNativeOperationJournalOptionsV2,
  seed?: PrivateJournalSeed): DuelNativeOperationJournalV2 {
  if (!options || typeof options !== "object" || options.genesis === null) fail("options/genesis required");
  try { assertAdmittedDuelMatchV2(options.genesis); } catch { fail("admitted genesis required"); }
  const genesis = options.genesis;
  if (genesis.stage !== "setup" || genesis.stateVersion !== 0 || genesis.eventSeq !== 0 ||
      genesis.provenance.transitions.length !== 0) fail("genesis must be the untouched setup root");
  try {
    const history = inspectDuelNativeTokenHistoryV2(genesis);
    if (history.births.length !== 0 || history.retirements.length !== 0) fail("genesis token history must be empty");
  } catch { fail("genesis token history is not an admitted native history"); }
  const currentHead = options.currentHead ?? options.getCurrentHead;
  if (currentHead !== undefined) {
    try {
      if (currentHead() !== (seed?.head ?? genesis)) fail("current head must start at the owned journal head");
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("Duel native operation journal:")) throw error;
      fail("current head must start at genesis");
    }
  }
  const programs = options.programs;
  if (programs) {
    getCardProgramRegistryForRuntime(programs);
    if (programs.catalogStamp.dataVersion !== genesis.dataVersion ||
        programs.catalogStamp.digest !== genesis.catalogDigest) fail("program authority catalog mismatch");
  }
  const programReference = programs
    ? (cardId: string) => programs.resolvedProgramReference(cardId)?.encodedReference
    : options.programReference;
  const nominalAuthority = seed?.nominalAuthority ?? Symbol("duel-native-journal-authority");
  const observed = { value: seed?.head ?? genesis as DuelMatchStateV2 };
  const genesisPlayers = (genesis as unknown as {
    players?: readonly { playerId?: string; displayName?: string }[];
    setup?: { players?: readonly { playerId?: string; displayName?: string }[] };
  }).players ?? (genesis as unknown as { setup?: { players?: readonly { playerId?: string; displayName?: string }[] } }).setup?.players ??
    genesis.turnOrder.map(playerId => ({ playerId, displayName: playerId }));
  const unifiedJournal = new JournalWriter(seed?.unifiedJournal ?? {
    header: {
      engineVersion: "riftbound-game-server:native-operation-current", matchId: genesis.matchId, roomId: genesis.matchId,
      catalogDigest: genesis.catalogDigest, rosterDigest: digestJournalValue(genesisPlayers),
      trustedDeckDigest: digestJournalValue(genesis.provenance.originalPhysicalCards), seed: digestJournalValue([genesis.matchId, genesis.catalogDigest]),
      seats: genesisPlayers.map(player => ({ playerId: player.playerId ?? "unknown-player", name: player.displayName ?? player.playerId ?? "player" })),
      creation: { deterministicSeed: digestJournalValue([genesis.matchId, genesis.catalogDigest]), creator: "game-server" },
    }, stateVersion: genesis.stateVersion, eventSeq: genesis.eventSeq, roomVersion: 0,
    stateDigest: digestJournalValue(genesis), privateStateDigest: digestJournalValue(genesis),
  });
  const commits: DuelNativeJournalCommitV2[] = [...(seed?.commits ?? [])];
  const operationIds = new Set<string>(seed?.operationIds);
  const contexts = new Map<string, ContextRecordV2>(seed?.contexts);
  const sourceWorks = new Map<string, WorkRecordV2>(seed?.sourceWorks);
  const runtime = new Map<string, RuntimeRecordV2>(seed?.runtime);
  const handledEvents = new Set<string>(seed?.handledEvents);
  let revision = seed?.revision ?? 0;
  let candidateSetRevision = seed?.candidateSetRevision ?? 0;

  const assertCurrentCallback = (): DuelMatchStateV2 | null => {
    if (currentHead === undefined) return observed.value;
    try {
      const current = currentHead();
      return current === observed.value ? current : null;
    } catch { return null; }
  };

  const findCommit = (operationId: string): DuelNativeJournalCommitV2 | undefined =>
    commits.find(commit => commit.label.operationId === operationId);

  const validateContext = (context: DuelPhaseSourceClosureContextV2): void => {
    if (!context || context.matchId !== genesis.matchId || context.dataVersion !== genesis.dataVersion ||
        context.catalogDigest !== genesis.catalogDigest || !safeCount(context.turn) ||
        !nonBlank(context.taskId) || !safeCount(context.clock?.stateVersion) ||
        !safeCount(context.clock?.eventSeq)) fail("invalid context");
    const current = assertCurrentCallback();
    if (!current || current.stage !== "playing" || current.stateVersion !== context.clock.stateVersion ||
        current.eventSeq !== context.clock.eventSeq || current.frame.turnNumber !== context.turn ||
        !context.taskId.includes(`turn-${context.turn}:`)) fail("context is not the observed head");
  };

  const observe = (path: DuelNativeOperationPathV2): void => {
    if (!path || path.ancestor !== observed.value) fail("ancestor is not the unique observed head");
    try { assertAdmittedDuelMatchV2(path.descendant); } catch { fail("descendant is not admitted Core state"); }
    if (path.ancestor.matchId !== genesis.matchId || path.descendant.matchId !== genesis.matchId ||
        path.ancestor.dataVersion !== genesis.dataVersion || path.descendant.dataVersion !== genesis.dataVersion ||
        path.ancestor.catalogDigest !== genesis.catalogDigest || path.descendant.catalogDigest !== genesis.catalogDigest)
      fail("foreign match or catalog");
    const nativePath = inspectDuelNativeCommitPathV2(path.ancestor, path.descendant);
    const labels = path.commits ?? path.labels ?? path.operations;
    if (!labels || nativePath.length !== labels.length) fail("one owner label per native commit required");
    const prepared: DuelNativeJournalCommitV2[] = [];
    const preparedIds = new Set<string>();
    for (let index = 0; index < nativePath.length; index += 1) {
      const native = nativePath[index]!;
      const label = labels[index]!;
      assertLabel(label);
      if ((label.event === "mulligan" || label.event === "setup") && native.before.stage !== "setup")
        fail("setup/mulligan label cannot certify a playing operation");
      if (preparedIds.has(label.operationId) || operationIds.has(label.operationId)) fail("duplicate operation ID");
      preparedIds.add(label.operationId);
      if (label.stateVersion !== undefined && label.stateVersion !== native.after.stateVersion) fail("state-version label mismatch");
      if (label.eventSeq !== undefined && label.eventSeq !== native.after.eventSeq) fail("event-seq label mismatch");
      const maps = candidateMaps(native.before, native.after);
      const transitions: DuelNativeJournalTransitionV2[] = [];
      const drawSubjects: DuelPhaseSourceClosureDrawSubjectV2[] = [];
      const preExitSources: DuelPhaseSourceClosurePreExitV2[] = [];
      const transitionUIDs = new Set<string>();
      const positions = new Map(maps.beforeZones);
      let unresolved = false;
      for (const [transitionIndex, step] of native.transitions.entries()) {
        const before = positions.get(step.uid);
        if (!before)
          fail("native transition has no physical epoch witness");
        const fromEpoch = before.epoch;
        const toEpoch = expectedEpoch(step.from, step.to, fromEpoch);
        if (zoneKey(before.zone) !== zoneKey(step.from))
          fail("operation label does not match native transition");
        positions.set(step.uid, { zone: copyZone(step.to), epoch: toEpoch });
        const proofId = `${label.operationId}:${label.eventId}:${step.uid}:${native.before.stateVersion}->${native.after.stateVersion}:${transitionIndex}`;
        const transition: DuelNativeJournalTransitionV2 = Object.freeze({
          operationId: label.operationId, eventId: label.eventId, uid: step.uid,
          from: Object.freeze(copyZone(step.from)), to: Object.freeze(copyZone(step.to)),
          fromZoneEpoch: fromEpoch, toZoneEpoch: toEpoch, proofId,
        });
        transitions.push(transition);
        transitionUIDs.add(step.uid);
        if ((step.from.kind === "main-deck" && step.to.kind === "hand") &&
            label.event !== "draw" && label.event !== "draw-subject" && label.event !== "mulligan") unresolved = true;
        if (step.to.kind === "trash" && label.event !== "pre-exit" && label.phase !== "lethal-kill" &&
            label.event !== "lethal-kill" && label.event !== "mulligan") unresolved = true;
        const closureTransition: DuelPhaseSourceClosureTransitionV2 = Object.freeze({
          eventId: label.eventId, uid: step.uid, from: Object.freeze(copyZone(step.from)),
          to: Object.freeze(copyZone(step.to)), fromZoneEpoch: fromEpoch, toZoneEpoch: toEpoch, proofId,
        });
        if (label.event === "draw" || label.event === "draw-subject") {
          if (step.from.kind === "main-deck" && step.to.kind === "hand") {
            drawSubjects.push(Object.freeze({ eventId: label.eventId, uid: step.uid,
              from: Object.freeze(copyZone(step.from)), to: Object.freeze(copyZone(step.to)),
              fromZoneEpoch: fromEpoch, toZoneEpoch: toEpoch, proofId }));
          }
        }
        if (label.event === "pre-exit" || label.phase === "lethal-kill") {
          const source = sourceFromBefore(native.before, step.uid, maps);
          if (!source || source.zoneEpoch !== fromEpoch || zoneKey(source.zone) !== zoneKey(step.from))
            fail("pre-exit requires a complete native before snapshot");
          preExitSources.push(Object.freeze({ eventId: label.eventId, source,
            transition: closureTransition, proofId }));
        }
      }
      for (const uid of transitionUIDs) {
        const final = positions.get(uid), actual = maps.afterZones.get(uid);
        if (!final || !actual || final.epoch !== actual.epoch || zoneKey(final.zone) !== zoneKey(actual.zone))
          fail("native final position/epoch mismatch");
      }
      if ((label.event === "draw" || label.event === "draw-subject") && drawSubjects.length === 0)
        fail("draw label has no native main-deck to hand entry");
      if ((label.event === "draw" || label.event === "draw-subject") && native.transitions.some(step =>
        step.from.kind === "hand" && step.to.kind === "main-deck"))
        fail("mulligan cannot be labeled as Draw");
      if (label.event === "mulligan" && drawSubjects.length > 0) fail("mulligan cannot be labeled as Draw");
      if (label.event === "pre-exit" && preExitSources.length === 0) fail("pre-exit label has no native source");
      if (label.sourceUID !== undefined && !transitionUIDs.has(label.sourceUID) &&
          !native.tokenBirths.some(birth => birth.sourceUID === label.sourceUID || birth.tokenUID === label.sourceUID) &&
          !native.tokenRetirements.some(retired => retired.tokenUID === label.sourceUID))
        fail("source UID is absent from the native commit");
      if (label.controllerPlayerId !== undefined) {
        const source = label.sourceUID && (maps.before.get(label.sourceUID) ?? maps.after.get(label.sourceUID));
        const birth = native.tokenBirths.find(item => item.sourceUID === label.sourceUID || item.controllerPlayerId === label.controllerPlayerId);
        if (source && source.controllerPlayerId !== label.controllerPlayerId && source.ownerPlayerId !== label.controllerPlayerId &&
            !birth) fail("controller label does not match native source");
      }
      // Recruit death needs its protected pre-exit token event, not an invented physical epoch.
      if (native.tokenRetirements.some(retired => retired.kind === "recruit")) unresolved = true;
      prepared.push(Object.freeze({
        before: native.before, after: native.after, label: Object.freeze({ ...label }),
        transitions: Object.freeze(transitions), preExitSources: Object.freeze(preExitSources),
        drawSubjects: Object.freeze(drawSubjects), tokenBirths: Object.freeze([...native.tokenBirths]),
        tokenRetirements: Object.freeze([...native.tokenRetirements]),
        unresolved,
      }));
    }
    for (const commit of prepared) {
      commits.push(commit);
      unifiedJournal.recordOperation({
        operationId: commit.label.operationId, taskId: commit.label.taskId ?? commit.label.eventId,
        phase: commit.label.phase ?? commit.label.event, stateVersion: commit.after.stateVersion,
        eventSeq: commit.after.eventSeq, roomVersion: 0,
        sourceClosureEvidence: [JSON.parse(JSON.stringify(commit.label))], costCensus: null,
        paymentPlan: null, paymentReceipt: null, effectIRDigest: null, primitiveReceipts: [],
        tokenBirths: JSON.parse(JSON.stringify(commit.tokenBirths)), tokenRetirements: JSON.parse(JSON.stringify(commit.tokenRetirements)),
        zoneTransitions: JSON.parse(JSON.stringify(commit.transitions)), pendingReason: commit.unresolved ? "pending" : null,
        state: { stateVersion: commit.after.stateVersion, eventSeq: commit.after.eventSeq, roomVersion: 0,
          stateDigest: digestJournalValue(commit.after), privateStateDigest: digestJournalValue(commit.after) },
      });
    }
    for (const id of preparedIds) operationIds.add(id);
    observed.value = path.descendant;
    revision += prepared.length;
    candidateSetRevision += prepared.length;
  };

  const bindContext = (context: DuelPhaseSourceClosureContextV2, operationId?: string): void => {
    validateContext(context);
    const commit = operationId === undefined ? commits.at(-1) : findCommit(operationId);
    if (!commit || commit.after !== observed.value || commit.after.stateVersion !== context.clock.stateVersion ||
        commit.after.eventSeq !== context.clock.eventSeq)
      fail("context is not bound to the native operation");
    const key = contextKey(context);
    if (contexts.has(key)) return;
    contexts.set(key, Object.freeze({ context: Object.freeze({ ...context, clock: Object.freeze({ ...context.clock }) }), operationId: commit.label.operationId }));
    if (context.event === "draw" || context.event === "draw-subject" || context.event === "pre-exit" ||
        context.event === "zone-transition" || context.phase === "lethal-kill") handledEvents.add(commit.label.operationId);
    revision += 1;
  };

  const registerSourceWork = (work: DuelNativeSourceWorkV2): void => {
    if (!work || !nonBlank(work.operationId) || !nonBlank(work.sourceUID) || !safeCount(work.zoneEpoch) ||
        !nonBlank(work.programReference)) fail("invalid source work");
    validateContext(work.context);
    const commit = findCommit(work.operationId);
    if (!commit || commit.after !== observed.value) fail("source work operation is not current");
    const source = allCandidates(observed.value).find(item => item.uid === work.sourceUID && item.zoneEpoch === work.zoneEpoch);
    if (!source || source.controllerPlayerId !== work.controllerPlayerId) fail("source work is not a current Core source");
    if (programReference && source.cardId !== null && programReference(source.cardId) !== work.programReference)
      fail("source work program reference is not registry-owned");
    const key = `${contextKey(work.context)}:${work.sourceUID}:${work.zoneEpoch}`;
    if (sourceWorks.has(key)) fail("duplicate source work");
    if (work.status === "resolved") {
      const bound = source.cardId !== null && programs ? programs.sourceProgramPhaseScope(source.cardId, work.context.phase) : null;
      if (!bound || !bound.sourceProgramComplete || bound.directBoundaryStatus !== "known-no-handler" ||
          bound.sourceApplicabilityStatus !== "known-no-handler" || bound.handlers.length || bound.modifiers.length)
        fail("source completion requires qualified program or actual executor receipt");
    }
    sourceWorks.set(key, Object.freeze({ ...work,
      context: Object.freeze({ ...work.context, clock: Object.freeze({ ...work.context.clock }) }),
      status: work.status ?? "pending" }));
    revision += 1;
  };

  const registerRuntimeEffect = (effect: DuelNativeRuntimeEffectV2): void => {
    if (!effect || !["activeEffects", "chain", "effectQueue", "feprOutstanding"].includes(effect.ledger) ||
        !nonBlank(effect.operationId) || !effect.entry || !nonBlank(effect.entry.effectId) ||
        !nonBlank(effect.entry.eventId) || !nonBlank(effect.entry.sourceUID) || !nonBlank(effect.entry.programReference))
      fail("invalid runtime effect");
    validateContext(effect.context);
    const commit = findCommit(effect.operationId);
    if (!commit) fail("runtime effect operation is not owned");
    if (effect.ledger === "chain" && (effect.entry.eventId !== commit.label.eventId ||
        !commit.transitions.some(step => step.uid === effect.entry.sourceUID &&
          step.to.kind === "chain" && step.toZoneEpoch === effect.entry.sourceZoneEpoch)))
      fail("Chain runtime work is not bound to its native entry");
    if (commit.after !== observed.value) {
      if (effect.ledger !== "chain") fail("runtime effect ancestor is not its Chain entry");
      const index = commits.indexOf(commit);
      if (index < 0 || commits.slice(index + 1).some(later => later.transitions.some(step =>
        step.uid === effect.entry.sourceUID))) fail("runtime effect source changed since Chain entry");
      const entrySource = allCandidates(commit.after).find(item => item.uid === effect.entry.sourceUID);
      if (!entrySource || entrySource.zoneEpoch !== effect.entry.sourceZoneEpoch ||
          entrySource.cardId !== effect.entry.cardId ||
          entrySource.controllerPlayerId !== effect.entry.controllerPlayerId ||
          entrySource.zone.kind !== "chain" || commits.slice(index + 1).some(later => {
            const before = allCandidates(later.before).find(item => item.uid === effect.entry.sourceUID);
            const after = allCandidates(later.after).find(item => item.uid === effect.entry.sourceUID);
            return !before || !after || before.cardId !== after.cardId ||
              before.controllerPlayerId !== after.controllerPlayerId ||
              before.zoneEpoch !== after.zoneEpoch || zoneKey(before.zone) !== zoneKey(after.zone);
          })) fail("runtime effect source binding changed after Chain entry");
    }
    const sources = allCandidates(observed.value);
    const source = sources.find(item => item.uid === effect.entry.sourceUID && item.zoneEpoch === effect.entry.sourceZoneEpoch);
    if (!source || source.cardId !== effect.entry.cardId || source.controllerPlayerId !== effect.entry.controllerPlayerId ||
        zoneKey(source.zone) !== zoneKey(effect.entry.zone)) fail("runtime effect source is not current Core source");
    if (effect.ledger === "chain" && (source.zone.kind !== "chain" ||
        !effect.resolutionBinding)) fail("Chain work needs an owned Chain source and binding");
    if (programReference && source.cardId !== null && programReference(source.cardId) !== effect.entry.programReference)
      fail("runtime effect program reference is not registry-owned");
    if (source.cardId === null) {
      const birth = inspectDuelNativeTokenHistoryV2(observed.value).births.find(item => item.tokenUID === source.uid);
      if (!birth || tokenReference(birth).programReference !== effect.entry.programReference)
        fail("runtime token program reference is not birth-owned");
    }
    const key = JSON.stringify([effect.ledger, effect.entry.effectId]);
    if (runtime.has(key)) fail("duplicate runtime effect");
    const resolved = effect.resolution;
    const binding = effect.resolutionBinding;
    if (binding && (!binding.authority || !nonBlank(binding.chainId) || !nonBlank(binding.executorId)))
      fail("invalid runtime resolution binding");
    let status: RuntimeLedgerStatusV2 = "pending";
    if (resolved?.committedProof) {
      const receipt = inspectDuelChainCommittedProofV2(resolved.committedProof);
      if (!binding || receipt.resolutionAuthority !== binding.authority ||
          receipt.chainId !== binding.chainId || receipt.executorId !== binding.executorId ||
          receipt.produced.length || receipt.itemId !== effect.entry.effectId || !nonBlank(resolved.proofId) ||
          resolved.eventId !== effect.entry.eventId || commit.label.eventId !== resolved.eventId)
        fail("runtime resolution proof does not match the owned effect");
      status = "resolved";
    }
    runtime.set(key, Object.freeze({ ledger: effect.ledger,
      context: Object.freeze({ ...effect.context, clock: Object.freeze({ ...effect.context.clock }) }),
      entry: Object.freeze({ ...effect.entry, zone: Object.freeze(copyZone(effect.entry.zone)) }),
      operationId: effect.operationId, status, proofId: resolved?.proofId ?? `pending:${effect.entry.effectId}`,
      ...(binding ? { resolutionBinding: Object.freeze({ ...binding }) } : {}) }));
    revision += 1;
    candidateSetRevision += 1;
  };

  const retireRuntimeEffect = (retirement: DuelNativeRuntimeRetirementV2): void => {
    if (!retirement || !["activeEffects", "chain", "effectQueue", "feprOutstanding"].includes(retirement.ledger) ||
        !nonBlank(retirement.operationId) || !nonBlank(retirement.effectId)) fail("invalid runtime retirement");
    validateContext(retirement.context);
    const commit = findCommit(retirement.operationId);
    if (!commit) fail("runtime retirement operation is not owned");
    const owned = [...runtime.entries()].find(([, value]) => value.ledger === retirement.ledger &&
      value.entry.effectId === retirement.effectId);
    if (!owned) fail("runtime retirement has no owned live effect");
    if (commit.after !== observed.value) {
      const index = commits.indexOf(commit);
      if (retirement.ledger !== "chain" || index < 0 ||
          commits.slice(index + 1).some(later => later.transitions.some(step =>
            step.uid === owned[1].entry.sourceUID))) fail("runtime retirement is not the current native source exit");
      const exited = allCandidates(observed.value).find(item => item.uid === owned[1].entry.sourceUID);
      const beforeExit = allCandidates(commit.before).find(item => item.uid === owned[1].entry.sourceUID);
      if (!exited || exited.zone.kind !== "trash" || exited.cardId !== owned[1].entry.cardId ||
          !beforeExit || beforeExit.zone.kind !== "chain" ||
          beforeExit.controllerPlayerId !== owned[1].entry.controllerPlayerId ||
          exited.ownerPlayerId !== beforeExit.ownerPlayerId)
        fail("runtime retirement source changed after exit");
    }
    if (!retirement.committedProof) fail("runtime retirement requires a committed executor proof");
    const receipt = inspectDuelChainCommittedProofV2(retirement.committedProof);
    const binding = owned[1].resolutionBinding;
    if (!binding || receipt.resolutionAuthority !== binding.authority ||
        receipt.chainId !== binding.chainId || receipt.executorId !== binding.executorId ||
        receipt.itemId !== retirement.effectId || receipt.produced.length)
      fail("runtime retirement must cover this effect and its produced work");
    if (retirement.ledger === "chain" && !commit.transitions.some(step =>
      step.uid === owned[1].entry.sourceUID && step.from.kind === "chain" &&
      step.fromZoneEpoch === owned[1].entry.sourceZoneEpoch && step.to.kind === "trash"))
      fail("Chain retirement requires the current native source exit");
    if (!runtime.delete(owned[0])) fail("runtime retirement has no owned live effect");
    revision += 1;
    candidateSetRevision += 1;
  };

  const tokenBirth = (uid: string): DuelTokenBirthJournalEntryV2 | null => {
    if (!nonBlank(uid) || !assertCurrentCallback()) return null;
    try {
      const history = inspectDuelNativeTokenHistoryV2(observed.value as DuelMatchStateV2);
      const found = history.births.find(entry => entry.tokenUID === uid);
      return found ?? null;
    } catch { return null; }
  };

  const tokenRetirement = (uid: string): DuelTokenRetirementJournalEntryV2 | null => {
    if (!nonBlank(uid) || !assertCurrentCallback()) return null;
    try {
      const history = inspectDuelNativeTokenHistoryV2(observed.value as DuelMatchStateV2);
      return history.retirements.find(entry => entry.tokenUID === uid) ?? null;
    } catch { return null; }
  };

  const readCostCensus = (): DuelNativeCostCensusV2 | null => {
    try {
      const current = assertCurrentCallback();
      if (!current || current.stage !== "playing" || !programReference) return null;
      const births = inspectDuelNativeTokenHistoryV2(current).births;
      const source = (candidate: DuelPhaseSourceClosureCandidateV2,
        status: DuelNativeCostSourceV2["status"], bindingRevision: number,
        ledgerName?: RuntimeLedgerNameV2, effectId?: string): DuelNativeCostSourceV2 => {
        const birth = candidate.cardId === null ? births.find(item => item.tokenUID === candidate.uid) : undefined;
        return Object.freeze({ uid: candidate.uid, sourceEpoch: candidate.zoneEpoch,
          cardId: candidate.cardId, ownerPlayerId: candidate.ownerPlayerId,
          controllerPlayerId: candidate.controllerPlayerId,
          programReference: candidate.cardId ? programReference(candidate.cardId) ?? null :
            birth ? tokenReference(birth).programReference : null,
          carrier: candidate.carrier, zone: Object.freeze(copyZone(candidate.zone)),
          bindingRevision, status, ...(ledgerName ? { ledger: ledgerName } : {}),
          ...(effectId ? { effectId } : {}) });
      };
      const live = allCandidates(current).map(item => source(item, "live", candidateSetRevision));
      const preExit = commits.flatMap((commit, index) => commit.preExitSources.map(item =>
        source(item.source, "resolved", index + 1)));
      const runtimeSources = [...runtime.values()].map(item => Object.freeze({
        uid: `effect:${item.entry.effectId}`, sourceEpoch: item.entry.sourceZoneEpoch,
        cardId: item.entry.cardId, ownerPlayerId: live.find(candidate =>
          candidate.uid === item.entry.sourceUID)?.ownerPlayerId ?? null,
        controllerPlayerId: item.entry.controllerPlayerId,
        programReference: item.entry.programReference, carrier: "runtime-effect" as const,
        zone: Object.freeze(copyZone(item.entry.zone)), bindingRevision: revision,
        status: item.status, ledger: item.ledger, effectId: item.entry.effectId,
        sourceUID: item.entry.sourceUID,
      }));
      const workSources = [...sourceWorks.values()].map(item => {
        const bound = live.find(candidate => candidate.uid === item.sourceUID);
        if (!bound) fail("source work has no current cost census carrier");
        return Object.freeze({
        uid: item.sourceUID, sourceEpoch: item.zoneEpoch,
        cardId: bound.cardId,
        ownerPlayerId: bound.ownerPlayerId,
        controllerPlayerId: item.controllerPlayerId, programReference: item.programReference,
        carrier: "source-work" as const, zone: Object.freeze(copyZone(bound.zone)),
        bindingRevision: revision, status: item.status,
      }); });
      if (assertCurrentCallback() !== current) return null;
      return Object.freeze({ matchId: current.matchId, stateVersion: current.stateVersion,
        eventSeq: current.eventSeq, journalRevision: revision, candidateSetRevision,
        sources: Object.freeze([...live, ...preExit, ...runtimeSources, ...workSources]),
        unresolvedNativeHistory: commits.some(item => item.unresolved || item.label.event === "unknown"),
        phaseClosed: false });
    } catch { return null; }
  };

  const read = (context: DuelPhaseSourceClosureContextV2): DuelProtectedGlobalSourceSnapshotV2 | null => {
    try {
      validateContext(context);
      if (!programs) return null;
      const binding = contexts.get(contextKey(context));
      if (!binding || !contextCoreEqual(binding.context, context)) return null;
      const commit = findCommit(binding.operationId);
      if (!commit || commit.after !== observed.value) return null;
      if (commits.some(item => (item.label.event === "draw" || item.label.event === "draw-subject" ||
        item.label.event === "pre-exit" || item.label.event === "zone-transition" || item.label.phase === "lethal-kill") &&
          !handledEvents.has(item.label.operationId))) return null;
      if (commits.some(item => item.label.event === "unknown" || item.unresolved)) return null;
      /* A trusted operator may contain several native commits under one task. */
      const related = commits.filter(item => item === commit ||
        (commit.label.taskId !== undefined && item.label.taskId === commit.label.taskId));
      if (related.some(item => item.label.event === "unknown" || item.unresolved)) return null;
      const drawSubjects = related.flatMap(item => item.drawSubjects);
      const preExitEntries = related.flatMap(item => item.preExitSources);
      const observedTransitions = related.flatMap(item => item.transitions);
      if (context.event === "draw-subject" && drawSubjects.length === 0) return null;
      if (context.event === "pre-exit" && preExitEntries.length === 0) return null;
      if (context.event === "zone-transition" && observedTransitions.length === 0) return null;
      const current = allCandidates(observed.value);
      if (current.length === 0) return null;
      if ([...sourceWorks.values()].some(work => work.status !== "resolved")) return null;
      const births = inspectDuelNativeTokenHistoryV2(observed.value as DuelMatchStateV2).births;
      const tokenRefs = births.filter(birth => current.some(candidate => candidate.uid === birth.tokenUID) ||
        preExitEntries.some(source => source.source.uid === birth.tokenUID)).map(tokenReference);
      const preExitSources = context.event === "pre-exit" || context.phase === "lethal-kill"
        ? preExitEntries : [];
      if (programReference) {
        for (const source of [...current, ...preExitEntries.map(item => item.source)]) {
          if (source.cardId !== null && !nonBlank(programReference(source.cardId))) return null;
        }
      }
      const transitions: DuelPhaseSourceClosureTransitionV2[] = observedTransitions.map(item => Object.freeze({
        eventId: item.eventId, uid: item.uid, from: Object.freeze(copyZone(item.from)), to: Object.freeze(copyZone(item.to)),
        fromZoneEpoch: item.fromZoneEpoch, toZoneEpoch: item.toZoneEpoch, proofId: item.proofId,
      }));
      /* Runtime effects are owned state, not per-read DTOs. Carry the newest
       * live record for each ledger/effect into later exact contexts until an
       * owner retirement is observed. */
      const latestRuntime = new Map<string, RuntimeRecordV2>();
      for (const item of runtime.values()) {
        if (item.context.matchId !== context.matchId || item.context.dataVersion !== context.dataVersion ||
            item.context.catalogDigest !== context.catalogDigest || item.context.clock.stateVersion > context.clock.stateVersion)
          continue;
        const effectKey = `${item.ledger}:${item.entry.effectId}`;
        const prior = latestRuntime.get(effectKey);
        if (!prior || prior.context.clock.stateVersion <= item.context.clock.stateVersion) latestRuntime.set(effectKey, item);
      }
      const relevantRuntime = [...latestRuntime.values()];
      if (relevantRuntime.some(item => item.status !== "resolved")) return null;
      const runtimeEntries = relevantRuntime.map(item => item.entry);
      const candidates = [...current, ...preExitSources.map(item => item.source), ...runtimeEntries.map(entry => ({
        uid: `effect:${entry.effectId}`, kind: "effect" as const, cardId: entry.cardId,
        zoneEpoch: entry.sourceZoneEpoch, controllerPlayerId: entry.controllerPlayerId,
        zone: copyZone(entry.zone), ownerPlayerId: null, locationId: "locationId" in entry.zone ? entry.zone.locationId : null,
        attachedToUID: null, visibility: "internal" as const, carrier: "runtime-effect" as const,
        sourceUID: entry.sourceUID, effectId: entry.effectId, runtimeKind: entry.kind,
      }))];
      const keys = candidates.map(candidateKey);
      if (new Set(keys).size !== keys.length) return null;
      const input: DuelPhaseSourceClosureJournalInputV2 = Object.freeze({
        matchId: context.matchId, dataVersion: context.dataVersion, catalogDigest: context.catalogDigest,
        turn: context.turn, taskId: context.taskId, phase: context.phase, event: context.event,
        clock: Object.freeze({ ...context.clock }),
        tokenReferences: Object.freeze(tokenRefs), preExitSources: Object.freeze(preExitSources),
        drawSubjects: Object.freeze(drawSubjects.map(item => Object.freeze({ ...item }))),
        transitions: Object.freeze(transitions),
        activeEffects: ledger("activeEffects", context, revision, relevantRuntime),
        chain: ledger("chain", context, revision, relevantRuntime),
        effectQueue: ledger("effectQueue", context, revision, relevantRuntime),
        feprOutstanding: ledger("feprOutstanding", context, revision, relevantRuntime),
      });
      const coverage = factCoverage(revision, keys, input);
      return Object.freeze({ scope: "exact", status: "resolved", input, candidateKeys: Object.freeze(keys),
        journalRevision: revision, candidateSetRevision, proofId: `native-journal:${contextKey(context)}:${revision}`, coverage });
    } catch { return null; }
  };

  const journal: DuelNativeOperationJournalV2 = {
    read, readCostCensus, tokenBirth, tokenRetirement, currentHead: () => observed.value, observedHead: () => observed.value,
    observe, observeNativePath: observe, observeCommitPath: observe,
    bindContext, registerSourceWork, registerSource: registerSourceWork,
    registerRuntimeEffect, registerEffect: registerRuntimeEffect, retireRuntimeEffect,
    listCommits: () => Object.freeze([...commits]),
    revision: () => revision,
    journal: () => unifiedJournal.snapshot(),
    fork: ownerHead => createJournal({ genesis, programs, currentHead: ownerHead ?? currentHead,
      ...(programs ? {} : { programReference }) }, { head: observed.value, commits,
      operationIds, contexts, sourceWorks, runtime, handledEvents, revision, candidateSetRevision,
      nominalAuthority, unifiedJournal: unifiedJournal.snapshot() }),
  };
  const published = Object.freeze(journal);
  NOMINAL_JOURNALS.set(published, Object.freeze({ authority: nominalAuthority, genesis }));
  GENUINE_JOURNALS.add(published);
  return published;
}

export const createDuelOperationJournalV2 = createDuelNativeOperationJournalV2;
export const createNativeOperationJournalV2 = createDuelNativeOperationJournalV2;

