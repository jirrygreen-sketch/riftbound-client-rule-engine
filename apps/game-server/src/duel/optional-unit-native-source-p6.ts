/** Opt-in source gate for the pure Accelerate Unit slice. No profile wires this in. */
import {
  enumerateDuelPhaseSourceClosureCandidatesV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelOptionalPlayReceiptDataV1,
  type DuelOptionalPlayReceiptV1,
  type DuelUnitEntryFactsV2,
  type DuelUnitEntryRequestV2,
  type DuelUnitEntryServiceV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import { createDuelOptionalUnitProgramReader } from "./optional-unit-services-p4.js";
import {
  inspectDuelNativeOperationJournalBindingV2,
  type DuelNativeCostCensusV2,
  type DuelNativeOperationJournalV2,
} from "./operation-journal-v2.js";

export interface OptionalUnitEntrySourceProofP6 {
  readonly candidate: DuelPhaseSourceClosureCandidateV2;
  readonly programId: string;
  readonly disposition: "known-no-effect" | "unknown" | "effect";
}

/** Supplied by a trusted, whole-entry executor. Structural equality alone does not
 * establish that a card has no effect; this is deliberately an external proof. */
export interface OptionalUnitEntryBoundaryProofP6 {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly baseLocationId: string;
  readonly programId: string;
  readonly sources: readonly OptionalUnitEntrySourceProofP6[];
  readonly scopes: DuelUnitEntryFactsV2["scopes"];
}

export interface OptionalUnitNativeSourceOptionsP6 {
  readonly catalog: CardCatalogRuntime;
  readonly programs: CardProgramAuthority;
  readonly currentHead: () => DuelCanonicalPlayingStateV2;
  /** The exact journal object minted by the server factory. */
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  readonly inspectChoice: (receipt: DuelOptionalPlayReceiptV1) => DuelOptionalPlayReceiptDataV1;
  /** Must establish full play/entry, replacement, static, trigger and task closure. */
  readonly verifyEntryBoundary?: (request: Readonly<DuelUnitEntryRequestV2>,
    candidates: readonly DuelPhaseSourceClosureCandidateV2[],
    census: DuelNativeCostCensusV2) => OptionalUnitEntryBoundaryProofP6 | null;
}

export interface OptionalUnitNativeSourceInspectionP6 {
  readonly status: "complete" | "unknown";
  readonly reason?: string;
  readonly candidates: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly census?: DuelNativeCostCensusV2;
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function unknown(reason: string): OptionalUnitNativeSourceInspectionP6 {
  return { status: "unknown", reason, candidates: [] };
}

/**
 * The Fury roster adds two whole programs whose phase-scope API is intentionally
 * unsupported at runtime. Their resolved IR is still sufficient to prove that
 * they cannot affect this plain Unit CardPlay: Vi has only an explicit
 * source-unit activation, and Deflect is restricted to Spell/Ability choices.
 * Keep both shapes exact so a future opcode cannot inherit this exception.
 */
function isWholeProgramKnownNoCardPlayEffect(program: { readonly semantics: unknown }): boolean {
  const semantics = program.semantics;
  return same(semantics, {
    kind: "compound-vi-self", sourceScope: "source-unit-on-board",
    ganking: { kind: "ganking", subject: "self", scope: "standard-move", mode: "permission" },
    activation: { event: "activate", sourceScope: "source-unit-on-board",
      costs: [{ kind: "recycle-from-trash", amount: 1, selector: "one-card",
        zone: "controller-trash", payer: "ability-controller" }],
      effects: [{ kind: "add-might", amount: 1, recipient: "ability-source-unit",
        duration: "this-turn" }] },
  }) || same(semantics, {
    kind: "deflect", sourceScope: "source-unit-on-board", event: "opponent-choice",
    modifier: { kind: "additional-opponent-power-cost", amount: 1,
      powerDomain: "wildcard", payer: "opponent", timing: "additional-play-cost",
      per: "each-choice-of-source", optional: false, automaticPayment: false,
      choice: { source: "spell-or-ability", target: "source-unit-on-board" } },
  });
}

type P6Journal = DuelNativeOperationJournalV2;

interface P6JournalRead {
  readonly journal: P6Journal;
  readonly census: DuelNativeCostCensusV2;
  readonly authority: symbol;
}

/**
 * A cost census is useful only when it is still owned by the journal that
 * observed the current Core state.  In particular, the counters are journal
 * clocks, not stateVersion aliases.  The commit chain check also prevents a
 * detached object from claiming that it is the current operation journal.
 */
function readBoundJournal(options: OptionalUnitNativeSourceOptionsP6,
  head: DuelCanonicalPlayingStateV2,
  expectedAuthority?: symbol): P6JournalRead | null {
  let journal: P6Journal;
  try { journal = options.currentJournal(); } catch { return null; }
  try {
    const binding = inspectDuelNativeOperationJournalBindingV2(journal);
    if (!binding || binding.journal !== journal || binding.head !== head || binding.observed !== head ||
        (expectedAuthority !== undefined && binding.authority !== expectedAuthority)) return null;
    const census = binding.census;
    if (!nonnegative(binding.revision) || !nonnegative(census.candidateSetRevision)) return null;
    if (options.currentJournal() !== journal) return null;
    return { journal, census, authority: binding.authority };
  } catch { return null; }
}
function facts(request: DuelUnitEntryRequestV2): DuelUnitEntryFactsV2 {
  return { matchId: request.matchId, stateVersion: request.stateVersion,
    eventSeq: request.eventSeq, actor: request.actor, uid: request.uid,
    cardId: request.cardId, sourceEpoch: request.sourceEpoch,
    baseLocationId: request.baseLocationId, programId: request.programId,
    sourceCensus: "unknown", sources: [],
    scopes: { play: "unknown", replacement: "unknown", static: "unknown",
      trigger: "unknown", pendingTasks: "unknown", chain: "unknown" } };
}

export function createOptionalUnitNativeSourceP6(options: OptionalUnitNativeSourceOptionsP6) {
  const reader = createDuelOptionalUnitProgramReader(options);
  let trustedAuthority: symbol | undefined;
  // Resolving this identity-guarded registry prevents a cloned authority from
  // supplying program IDs or pretending to know source absence.
  const registry = getCardProgramRegistryForRuntime(options.programs);
  const inspect = (request: Readonly<DuelUnitEntryRequestV2>): OptionalUnitNativeSourceInspectionP6 => {
    try {
      const head = options.currentHead();
      if (head !== request.match || head.stage !== "playing" ||
          head.matchId !== request.matchId || head.stateVersion !== request.stateVersion ||
          head.eventSeq !== request.eventSeq ||
          head.dataVersion !== options.catalog.publicCatalog.dataVersion ||
          head.catalogDigest !== options.catalog.publicCatalog.digest)
        return unknown("stale-or-foreign-head");
      if (head.frame.phase !== "main" || !head.frame.stateOpen ||
          head.frame.priorityPlayerId !== request.actor || head.frame.pendingPayment !== null)
        return unknown("optional-play-phase-or-priority");
      const binding = reader.describe({ match: head, matchId: request.matchId,
        dataVersion: head.dataVersion, catalogDigest: head.catalogDigest,
        actor: request.actor, uid: request.uid, cardId: request.cardId,
        sourceEpoch: request.sourceEpoch });
      if (binding.programFingerprint !== request.programId ||
          !head.board.bases.some(base => base.locationId === request.baseLocationId &&
            base.ownerPlayerId === request.actor)) return unknown("target-binding");
      const bound = readBoundJournal(options, head, trustedAuthority);
      const census = bound?.census;
      if (!census || census.matchId !== head.matchId ||
          census.stateVersion !== head.stateVersion || census.eventSeq !== head.eventSeq ||
          census.phaseClosed !== false || census.unresolvedNativeHistory)
        return unknown("native-census-unavailable");
      const candidates = enumerateDuelPhaseSourceClosureCandidatesV2(head);
      const objects = census.sources.filter(source => source.carrier === "object");
      if (candidates.length === 0 || objects.length !== candidates.length ||
          census.sources.length !== objects.length ||
          new Set(candidates.map(item => item.uid)).size !== candidates.length ||
          new Set(objects.map(item => item.uid)).size !== objects.length)
        return unknown("missing-extra-or-pending-source");
      const byUID = new Map(objects.map(item => [item.uid, item]));
      for (const source of candidates) {
        const bound = byUID.get(source.uid);
        if (!bound || source.carrier !== "object" || source.cardId === null ||
            !nonnegative(source.zoneEpoch) || !nonnegative(bound.bindingRevision) ||
            bound.status !== "live" || bound.sourceEpoch !== source.zoneEpoch ||
            bound.cardId !== source.cardId || bound.ownerPlayerId !== source.ownerPlayerId ||
            bound.controllerPlayerId !== source.controllerPlayerId || !same(bound.zone, source.zone))
          return unknown("candidate-identity-or-epoch");
        const physical = head.physicalCardsByUID[source.uid];
        if (!physical || physical.zoneEpoch !== source.zoneEpoch ||
            physical.cardId !== source.cardId || physical.ownerPlayerId !== source.ownerPlayerId)
          return unknown("physical-source-binding");
        if (source.uid === request.uid) {
          if (source.zone.kind !== "hand" || source.zone.zonePlayerId !== request.actor ||
              source.ownerPlayerId !== request.actor || source.cardId !== request.cardId ||
              source.zoneEpoch !== request.sourceEpoch)
            return unknown("optional-target-binding");
          // The archived/default registry leaves the target's census reference
          // null.  The opt-in pure Accelerate registry binds a genuine target
          // reference, which is a different identity from request.programId
          // (the latter remains the reader's descriptor fingerprint).
          if (bound.programReference !== null) {
            const reference = options.programs.resolvedProgramReference(source.cardId);
            const program = registry.getProgram(source.cardId);
            if (!reference || !program || reference.encodedReference !== bound.programReference ||
                program.programId !== reference.programId ||
                program.source.dataVersion !== head.dataVersion ||
                program.source.sourceCatalogDigest !== head.catalogDigest)
              return unknown("optional-target-program-binding");
          }
        } else {
          const reference = options.programs.resolvedProgramReference(source.cardId);
          const program = registry.getProgram(source.cardId);
          if (!reference || !program || bound.programReference !== reference.encodedReference ||
              program.programId !== reference.programId ||
              program.source.dataVersion !== head.dataVersion ||
              program.source.sourceCatalogDigest !== head.catalogDigest)
            return unknown("unresolved-source-program");
          const scope = options.programs.sourceProgramPhaseScope(source.cardId, "main");
          if (!isWholeProgramKnownNoCardPlayEffect(program) &&
              (scope.scope !== "source-program" || !scope.sourceProgramComplete ||
                scope.programId !== program.programId ||
                scope.sourceCardId !== program.source.cardId ||
                scope.sourceDataVersion !== head.dataVersion ||
                scope.sourceCatalogDigest !== head.catalogDigest))
            return unknown("active-or-unknown-source-program");
        }
      }
      const end = readBoundJournal(options, head, trustedAuthority ?? bound.authority);
      if (!end || !same(end.census, census) || options.currentHead() !== head ||
          end.authority !== bound.authority ||
          options.currentJournal() !== bound.journal)
        return unknown("census-changed-during-read");
      trustedAuthority ??= bound.authority;
      return { status: "complete", candidates, census };
    } catch { return unknown("source-proof-unavailable"); }
  };

  /** P4 cost resolution can consume this same exact candidate census. It still
   * performs its own modifier and non-resource-cost proof. */
  const verifiedCostCensus = (request: Readonly<DuelUnitEntryRequestV2>):
    DuelNativeCostCensusV2 | null => {
    const result = inspect(request);
    return result.status === "complete" ? result.census ?? null : null;
  };

  /** Bind one process-local optional choice to the entry service used by Core. */
  const entryForReceipt = (receipt: DuelOptionalPlayReceiptV1): DuelUnitEntryServiceV2 => request => {
    const fallback = facts(request);
    try {
      const choice = options.inspectChoice(receipt);
      if (choice.matchId !== request.matchId || choice.actor !== request.actor ||
          choice.uid !== request.uid || choice.cardId !== request.cardId ||
          choice.sourceEpoch !== request.sourceEpoch ||
          choice.sourceProgramFingerprint !== request.programId ||
          choice.stateVersion !== request.stateVersion ||
          (choice.decision !== "pay" && choice.decision !== "decline")) return fallback;
      const inspected = inspect(request);
      if (inspected.status !== "complete" || !inspected.census || !options.verifyEntryBoundary)
        return fallback;
      const proof = options.verifyEntryBoundary(request, inspected.candidates, inspected.census);
      if (!proof || !["matchId", "stateVersion", "eventSeq", "actor", "uid", "cardId",
        "sourceEpoch", "baseLocationId", "programId"].every(key =>
          proof[key as keyof typeof proof] === request[key as keyof typeof request]) ||
          !Array.isArray(proof.sources) || proof.sources.length !== inspected.candidates.length ||
          !proof.scopes || !same(Object.keys(proof.scopes).sort(),
            ["play", "replacement", "static", "trigger", "pendingTasks", "chain"].sort()) ||
          Object.values(proof.scopes).some(value => value !== "clear")) return fallback;
      const byUID = new Map(inspected.candidates.map(item => [item.uid, item]));
      const seen = new Set<string>();
      const sources: DuelUnitEntryFactsV2["sources"][number][] = [];
      for (const source of proof.sources) {
        const actual = source?.candidate && byUID.get(source.candidate.uid);
        if (!actual || seen.has(actual.uid) || actual !== source.candidate ||
            source.disposition !== "known-no-effect" || !nonnegative(actual.zoneEpoch) ||
            actual.cardId === null) return fallback;
        const expectedProgramId = actual.uid === request.uid ? request.programId :
          options.programs.resolvedProgramReference(actual.cardId)?.programId;
        if (!expectedProgramId || source.programId !== expectedProgramId) return fallback;
        seen.add(actual.uid);
        sources.push({ uid: actual.uid, zoneEpoch: actual.zoneEpoch,
          programId: source.programId, disposition: "known-no-effect" });
      }
      const end = readBoundJournal(options, request.match, trustedAuthority);
      if (seen.size !== inspected.candidates.length || !seen.has(request.uid) ||
          options.currentHead() !== request.match || !end || !same(end.census, inspected.census)) return fallback;
      return { ...fallback, sourceCensus: "complete", sources, scopes: { ...proof.scopes } };
    } catch { return fallback; }
  };
  return Object.freeze({ inspect, verifiedCostCensus, entryForReceipt });
}
