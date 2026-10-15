/** Server composition for V2 source checks. The journal reader must be owned by
 * the authoritative event/effect journal, never by a room DTO or archive row. */
import {
  assertAdmittedDuelMatchV2,
  bindDuelPrintedCost,
  createDuelPhaseSourceClosureJournalV2,
  createDuelPhaseSourceRegistryV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseClosureCoreRequestV2,
  type DuelPhaseClosureJournalResolutionV2,
  type DuelPhaseClosureRequirementV2,
  type DuelPhaseClosureTokenResolutionV2,
  type DuelPhaseEventV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseRegistryV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureInspectionV2,
  type DuelPhaseSourceClosureJournalInputV2,
  type DuelPhaseSourceRequestV2,
  type DuelTokenBirthJournalEntryV2,
  type DuelUnitEntryFactsV2,
  type DuelUnitEntryRequestV2,
  type DuelUnitCostBindingV2,
  type DuelSpellCostBindingV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime, PublicCatalogCard } from "../card-catalog.js";
import { getCardProgramRegistryForRuntime, type CardProgramAuthority } from "./card-program-authority.js";
import { createDuelPhaseSourceServerBridgeV2 } from "./phase-source-bridge-v2.js";
import type { DuelNativeCostCensusV2 } from "./operation-journal-v2.js";

export interface DuelProtectedGlobalSourceSnapshotV2 {
  readonly scope: "exact";
  readonly status: "resolved";
  readonly input: DuelPhaseSourceClosureJournalInputV2;
  /** Complete census from the independently protected global journal. */
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

export interface DuelProductionSourceServicesOptionsV2 {
  readonly catalog: CardCatalogRuntime;
  readonly matchId: string;
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  readonly programs: CardProgramAuthority;
  /** Reads all live, hidden, pre-exit, runtime, chain, queue and FEPR records. */
  readonly globalJournal: {
    readonly read: (context: DuelPhaseSourceClosureContextV2) => DuelProtectedGlobalSourceSnapshotV2 | null;
    readonly readCostCensus?: () => DuelNativeCostCensusV2 | null;
    readonly tokenBirth: (uid: string) => DuelTokenBirthJournalEntryV2 | null;
  };
  readonly effectExecutor?: {
    /** Resolves the entire play/entry boundary, including replacement and queued tasks. */
    readonly verifyUnitEntry: (
      request: Readonly<DuelUnitEntryRequestV2>,
      context: DuelPhaseSourceClosureContextV2,
      candidateKeys: readonly string[],
    ) => Readonly<{
      readonly status: "resolved";
      readonly scope: "exact";
      readonly matchId: string;
      readonly stateVersion: number;
      readonly uid: string;
      readonly candidateKeys: readonly string[];
      readonly effects: "none" | "present" | "unknown";
    }> | null;
    readonly resolveTokenDecision: (
      request: DuelPhaseClosureCoreRequestV2,
      birth: DuelTokenBirthJournalEntryV2,
    ) => Readonly<{
      readonly status: "resolved";
      readonly scope: "exact";
      readonly matchId: string;
      readonly stateVersion: number;
      readonly uid: string;
      readonly sourceProofId: string;
      readonly decision: "active" | "inactive" | "handler";
    }> | null;
  };
  /** Independently verifies the cost resolver transaction and proof IDs. */
  readonly verifyCostBinding?: (request: DuelUnitCostBindingV2) => boolean;
  readonly verifySpellCostBinding?: (request: DuelSpellCostBindingV2,
    census: DuelNativeCostCensusV2) => boolean;
}

export interface DuelDerivedMightCheckpointV2 {
  readonly status: "complete" | "blocked";
  readonly uid: string;
  readonly baseMight?: number;
  readonly currentMight?: number;
  readonly reason?: string;
}

export interface DuelProductionSourceServicesV2 {
  readonly phaseRegistry: DuelPhaseRegistryV2;
  inspect(context: DuelPhaseSourceClosureContextV2): DuelPhaseSourceClosureInspectionV2;
  entry(request: Readonly<DuelUnitEntryRequestV2>): DuelUnitEntryFactsV2;
  costBinding(request: Readonly<DuelUnitCostBindingV2>): DuelUnitCostBindingV2 & {
    readonly status: "complete" | "unknown";
  };
  spellCostBinding(request: Readonly<DuelSpellCostBindingV2>): DuelSpellCostBindingV2 & {
    readonly status: "complete" | "unknown";
  };
  derivedMight(uid: string, context: DuelPhaseSourceClosureContextV2): DuelDerivedMightCheckpointV2;
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function frozenData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return !!d && "value" in d && frozenData(d.value, seen);
  });
}
function freezeData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d && "value" in d) freezeData(d.value, seen);
  }
  Object.freeze(value);
}
function key(source: DuelPhaseSourceClosureCandidateV2): string {
  return JSON.stringify([source.carrier, source.uid, source.zoneEpoch, source.zone.kind,
    "locationId" in source.zone ? source.zone.locationId : source.zone.zonePlayerId]);
}
function contextFor(head: DuelCanonicalPlayingStateV2, phase: DuelPhaseEventV2, taskId: string):
    DuelPhaseSourceClosureContextV2 {
  return { matchId: head.matchId, dataVersion: head.dataVersion,
    catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase, event: phase,
    clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } };
}
function bound(head: DuelCanonicalPlayingStateV2, context: DuelPhaseSourceClosureContextV2): boolean {
  return head.matchId === context.matchId && head.dataVersion === context.dataVersion &&
    head.catalogDigest === context.catalogDigest && head.frame.turnNumber === context.turn &&
    head.stateVersion === context.clock.stateVersion && head.eventSeq === context.clock.eventSeq &&
    context.taskId.includes(`turn-${context.turn}:`);
}
function pending(reason: string): DuelPhaseSourceClosureInspectionV2 {
  return { status: "pending", candidates: [], sources: [], eventSources: [], activeSources: [],
    handlers: [], runtimeSources: [], reason };
}
function safeCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}
function nonblank(s: unknown): s is string { return typeof s === "string" && s.trim().length > 0; }
const GOLD_REFERENCE = JSON.stringify({
  intrinsicId: "riftbound-duel-official-v1:intrinsic-token:gold-gear",
  kind: "duel-intrinsic-token-ability-reference",
  ruleset: "riftbound-duel-official-v1", schemaVersion: 1,
});

/** No callback in this factory may be backed by untrusted request or replay data. */
export function createDuelProductionSourceServicesV2(
  options: DuelProductionSourceServicesOptionsV2,
): DuelProductionSourceServicesV2 {
  const { catalog, programs, matchId, currentHead, globalJournal } = options;
  if (!nonblank(matchId) || typeof currentHead !== "function" ||
      typeof globalJournal?.read !== "function" || typeof globalJournal.tokenBirth !== "function" ||
      catalog?.publicCatalog?.dataVersion !== programs?.catalogStamp?.dataVersion ||
      catalog.publicCatalog.digest !== programs.catalogStamp.digest) {
    throw new TypeError("loaded catalog, real program authority and protected journal required");
  }
  // The authority identity guard rejects structural clones here.
  const printings = programs.resolvedProgramReferenceEntries();
  const byCard = new Map<string, PublicCatalogCard>();
  for (const card of catalog.publicCatalog.cards) {
    if (byCard.has(card.id)) throw new TypeError("duplicate catalog printing");
    byCard.set(card.id, card);
  }
  const first = currentHead();
  if (!first || first.matchId !== matchId || first.dataVersion !== catalog.publicCatalog.dataVersion ||
      first.catalogDigest !== catalog.publicCatalog.digest) throw new TypeError("admitted current head required");
  assertAdmittedDuelMatchV2(first);

  function head(): DuelCanonicalPlayingStateV2 | null {
    try {
      const value = currentHead();
      if (!value || value.stage !== "playing" || value.matchId !== matchId ||
          value.dataVersion !== catalog.publicCatalog.dataVersion ||
          value.catalogDigest !== catalog.publicCatalog.digest) return null;
      assertAdmittedDuelMatchV2(value);
      return value;
    } catch { return null; }
  }
  const validatedSnapshots = new WeakMap<object, { head: DuelCanonicalPlayingStateV2; context: string }>();
  const readyInspections = new WeakMap<object, Map<string, DuelPhaseSourceClosureInspectionV2>>();
  function snapshot(h: DuelCanonicalPlayingStateV2, c: DuelPhaseSourceClosureContextV2):
      DuelProtectedGlobalSourceSnapshotV2 | null {
    try {
      if (!bound(h, c)) return null;
      const value = globalJournal.read(c);
      const previously = value && validatedSnapshots.get(value);
      if (previously?.head === h && previously.context === JSON.stringify(c) && head() === h) return value;
      if (!value || value.scope !== "exact" || value.status !== "resolved" ||
          !safeCount(value.journalRevision) || !safeCount(value.candidateSetRevision) ||
          !nonblank(value.proofId) || !same(value.input && {
            matchId: value.input.matchId, dataVersion: value.input.dataVersion,
            catalogDigest: value.input.catalogDigest, turn: value.input.turn,
            taskId: value.input.taskId, phase: value.input.phase, event: value.input.event,
            clock: value.input.clock,
          }, c)) return null;
      const raw = value.input;
      const core = enumerateDuelPhaseSourceClosureCandidatesV2(h);
      const special = raw.preExitSources.map(item => item.source);
      const effects = [raw.activeEffects, raw.chain, raw.effectQueue, raw.feprOutstanding]
        .flatMap(ledger => ledger.entries.map(entry => JSON.stringify([
          "runtime-effect", `effect:${entry.effectId}`, entry.sourceZoneEpoch, entry.zone.kind,
          "locationId" in entry.zone ? entry.zone.locationId : entry.zone.zonePlayerId])));
      const actual = [...core.map(key), ...special.map(key), ...effects];
      if (!Array.isArray(value.candidateKeys) || actual.length !== value.candidateKeys.length ||
          new Set(actual).size !== actual.length ||
          !same([...actual].sort(), [...value.candidateKeys].sort())) return null;
      if (!Array.isArray(value.coverage) || value.coverage.some(item =>
        !nonblank(item.proofId) || item.journalRevision !== value.journalRevision)) return null;
      // A reader changing the head while resolving cannot certify this snapshot.
      if (head() !== h) return null;
      if (frozenData(value)) validatedSnapshots.set(value, { head: h, context: JSON.stringify(c) });
      return value;
    } catch { return null; }
  }
  function inspect(c: DuelPhaseSourceClosureContextV2): DuelPhaseSourceClosureInspectionV2 {
    const h = head();
    if (!h || !bound(h, c)) return pending("stale-or-foreign-head");
    const global = snapshot(h, c);
    if (!global) return pending("missing-exact-global-journal");
    const cached = readyInspections.get(global)?.get(JSON.stringify(c));
    if (cached && head() === h) return cached;
    const candidates = [...enumerateDuelPhaseSourceClosureCandidatesV2(h),
      ...global.input.preExitSources.map(item => item.source)];
    const byUID = new Map(candidates.map(item => [item.uid, item]));
    const bridge = createDuelPhaseSourceServerBridgeV2(programs, h, {
      resolveCore(locator): DuelPhaseClosureCoreRequestV2 | null {
        if (locator.matchId !== h.matchId || locator.taskId !== c.taskId || head() !== h ||
            !snapshot(h, c)) return null;
        const fresh = [...enumerateDuelPhaseSourceClosureCandidatesV2(h),
          ...global.input.preExitSources.map(item => item.source)];
        const source = fresh.find(item => item.uid === locator.uid);
        if (!source || !same(source, byUID.get(locator.uid))) return null;
        if (source.cardId !== null) {
          const reference = programs.resolvedProgramReference(source.cardId);
          return reference ? { context: c, source,
            expectedProgramReference: reference.encodedReference, referenceKind: "printing" } : null;
        }
        const birth = globalJournal.tokenBirth(source.uid);
        if (!birth || birth.tokenUID !== source.uid || birth.controllerPlayerId !== source.controllerPlayerId ||
            birth.matchId !== h.matchId || birth.dataVersion !== h.dataVersion ||
            birth.catalogDigest !== h.catalogDigest || birth.createdAtStateVersion > h.stateVersion ||
            !nonblank(birth.sourceProofId) || !nonblank(birth.eventId)) return null;
        const referenceKind = birth.kind === "gold" ? "gold-cr-intrinsic" : "recruit-birth";
        const expectedProgramReference = birth.kind === "gold" ? GOLD_REFERENCE : JSON.stringify({
          birthEventId: birth.eventId, catalogDigest: h.catalogDigest, dataVersion: h.dataVersion,
          kind: "recruit-birth-reference", matchId: h.matchId, schemaVersion: 1,
          sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
          sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
          sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID,
        });
        return { context: c, source, expectedProgramReference, referenceKind };
      },
      resolveToken(request): DuelPhaseClosureTokenResolutionV2 | null {
        const birth = globalJournal.tokenBirth(request.source.uid);
        if (!birth || head() !== h || !snapshot(h, c) ||
            birth.tokenUID !== request.source.uid || birth.controllerPlayerId !== request.source.controllerPlayerId ||
            birth.createdAtStateVersion > h.stateVersion) return null;
        const decision = options.effectExecutor?.resolveTokenDecision(request, birth);
        if (!decision || decision.status !== "resolved" || decision.scope !== "exact" ||
            decision.matchId !== h.matchId || decision.stateVersion !== h.stateVersion ||
            decision.uid !== birth.tokenUID || decision.sourceProofId !== birth.sourceProofId ||
            !["active", "inactive", "handler"].includes(decision.decision) || head() !== h) return null;
        return { request, uid: birth.tokenUID, kind: birth.kind,
          birthEventId: birth.eventId, sourceEffectId: birth.sourceEffectId,
          sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
          sourceMode: birth.sourceMode, sourceProofId: birth.sourceProofId,
          controllerPlayerId: birth.controllerPlayerId, journalRevision: global.journalRevision,
          programReference: request.expectedProgramReference, decision: decision.decision };
      },
      resolveJournal(request, requirements): DuelPhaseClosureJournalResolutionV2 | null {
        const fresh = snapshot(h, c);
        if (!fresh || fresh.journalRevision !== global.journalRevision ||
            fresh.candidateSetRevision !== global.candidateSetRevision ||
            !same(fresh.candidateKeys, global.candidateKeys) ||
            requirements.some(required => !fresh.coverage.some(item => item.requirement === required))) return null;
        return { request, proofId: `${fresh.proofId}:${key(request.source)}`,
          journalRevision: fresh.journalRevision, candidateSetRevision: fresh.candidateSetRevision,
          coverage: fresh.coverage.filter(item => requirements.includes(item.requirement)) };
      },
    });
    try {
      const journal = createDuelPhaseSourceClosureJournalV2(global.input);
      const result = bridge.inspect(c, journal);
      if (head() !== h) return pending("head-changed-during-inspection");
      if (result.status === "ready" && frozenData(global)) {
        freezeData(result);
        let cache = readyInspections.get(global);
        if (!cache) { cache = new Map(); readyInspections.set(global, cache); }
        cache.set(JSON.stringify(c), result);
      }
      return result;
    } catch { return pending("invalid-global-journal"); }
  }

  const phaseRegistry = createDuelPhaseSourceRegistryV2({ matchId,
    dataVersion: first.dataVersion, catalogDigest: first.catalogDigest,
    printings: printings.map(item => ({ cardId: item.cardId,
      programReference: item.encodedReference })) },
  (request: DuelPhaseSourceRequestV2): DuelPhaseProgramEvidenceV2 => {
    const h = head();
    if (!h || h !== request.match || request.matchId !== matchId ||
        request.turn !== h.frame.turnNumber) return { status: "unknown" };
    const c = contextFor(h, request.event, request.taskId);
    const result = inspect(c);
    // A declared Hold handler fires only for its actual holding controller. A
    // Battlefield controlled by nobody or another player is not a Hold event.
    const applicableHandlers = result.handlers.filter(source => {
      if (request.event !== "hold" || source.kind !== "battlefield" || !source.cardId ||
          source.controllerPlayerId === h.frame.turnPlayerId) return true;
      const program = getCardProgramRegistryForRuntime(programs).getProgram(source.cardId);
      return program?.semantics.kind !== "trigger" || program.semantics.event !== "hold";
    });
    if (result.status !== "ready" || applicableHandlers.length > 0 ||
        result.activeSources.length > 0 ||
        result.candidates.some(item => item.uid === request.source.uid &&
          (item.cardId !== request.source.cardId || item.zoneEpoch !== request.source.zoneEpoch ||
            item.controllerPlayerId !== request.source.controllerPlayerId || !same(item.zone, request.source.zone))))
      return { status: "unknown" };
    const source = result.candidates.find(item => item.uid === request.source.uid);
    const reference = source?.cardId ? programs.resolvedProgramReference(source.cardId) : undefined;
    if (!source || !reference) return { status: "unknown" };
    return { status: "complete", matchId, dataVersion: h.dataVersion,
      catalogDigest: h.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: source.uid, zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
      cardId: source.cardId, programReference: reference.encodedReference,
      event: request.event, eventSupported: true, scope: "known-no-handler",
      replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true };
  });

  function entry(request: Readonly<DuelUnitEntryRequestV2>): DuelUnitEntryFactsV2 {
    const h = head();
    const valid = h === request.match && request.matchId === matchId &&
      request.stateVersion === h?.stateVersion && request.eventSeq === h?.eventSeq;
    const c = h ? contextFor(h, "main", `duel-v2:${matchId}:turn-${h.frame.turnNumber}:unit-entry:${request.uid}`) : null;
    const result = valid && c ? inspect(c) : pending("stale-unit-entry");
    const source = result.candidates.find(item => item.uid === request.uid);
    let entryProof: ReturnType<NonNullable<DuelProductionSourceServicesOptionsV2["effectExecutor"]>["verifyUnitEntry"]> = null;
    try {
      if (valid && c && result.status === "ready") {
        entryProof = options.effectExecutor?.verifyUnitEntry(request, c,
          result.candidates.map(key)) ?? null;
      }
    } catch { entryProof = null; }
    const allClear = result.status === "ready" && result.handlers.length === 0 &&
      result.activeSources.length === 0 && source?.cardId === request.cardId &&
      source.zoneEpoch === request.sourceEpoch && source.ownerPlayerId === request.actor &&
      source.zone.kind === "hand" &&
      byCard.get(request.cardId)?.cardType === "Unit" &&
      h?.board.bases.some(base => base.locationId === request.baseLocationId &&
        base.ownerPlayerId === request.actor) === true &&
      result.candidates.every(item => item.cardId !== null && item.zoneEpoch !== null) &&
      programs.resolvedProgramReference(request.cardId)?.programId === request.programId &&
      entryProof?.status === "resolved" && entryProof.scope === "exact" &&
      entryProof.matchId === matchId && entryProof.stateVersion === h?.stateVersion &&
      entryProof.uid === request.uid && entryProof.effects === "none" &&
      same(entryProof.candidateKeys, result.candidates.map(key)) && head() === h;
    const status = allClear ? "clear" : "unknown";
    return { matchId: request.matchId, stateVersion: request.stateVersion,
      eventSeq: request.eventSeq, actor: request.actor, uid: request.uid,
      cardId: request.cardId, sourceEpoch: request.sourceEpoch,
      baseLocationId: request.baseLocationId, programId: request.programId,
      sourceCensus: allClear ? "complete" : "unknown",
      sources: result.candidates.filter(item => item.zoneEpoch !== null).map(item => ({
        uid: item.uid, zoneEpoch: item.zoneEpoch!,
        programId: item.cardId ? programs.resolvedProgramReference(item.cardId)?.programId ?? "unknown" : "unknown",
        disposition: allClear ? "known-no-effect" as const : "unknown" as const })),
      scopes: { play: status, replacement: status, static: status, trigger: status,
        pendingTasks: status, chain: status } };
  }
  function costBinding(request: Readonly<DuelUnitCostBindingV2>) {
    const h = head();
    const card = byCard.get(request.cardId);
    let complete = false;
    try {
      const base = card && bindDuelPrintedCost(card);
      const source = h && enumerateDuelPhaseSourceClosureCandidatesV2(h)
        .find(item => item.uid === request.uid);
      complete = !!(h && source && card?.cardType === "Unit" && base?.kind === "numeric" &&
        request.matchId === matchId && request.stateVersion === h.stateVersion &&
        source.cardId === request.cardId && source.zoneEpoch === request.sourceEpoch &&
        source.zone.kind === "hand" && source.ownerPlayerId === request.actor &&
        h.board.bases.some(base => base.locationId === request.baseLocationId &&
          base.ownerPlayerId === request.actor) &&
        nonblank(request.baseProofId) && nonblank(request.coverageProofId) &&
        nonblank(request.transactionId) && options.verifyCostBinding?.(request) && head() === h);
    } catch { complete = false; }
    return { ...request, status: complete ? "complete" as const : "unknown" as const };
  }
  function spellCostBinding(request: Readonly<DuelSpellCostBindingV2>) {
    let complete = false;
    try {
      const h = head();
      const census = options.globalJournal.readCostCensus?.();
      const tuple: unknown = JSON.parse(request.transactionId);
      const source = census?.sources.find(item => item.carrier === "object" && item.uid === request.uid);
      const card = byCard.get(request.cardId);
      const base = card && bindDuelPrintedCost(card);
      const reference = programs.resolvedProgramReference(request.cardId);
      const program = reference && getCardProgramRegistryForRuntime(programs).getProgram(request.cardId);
      complete = !!(h && census && Array.isArray(tuple) && tuple.length === 6 &&
        same(tuple, [matchId, h.stateVersion, request.actor, tuple[3], request.uid, request.sourceEpoch]) &&
        nonblank(tuple[3]) && request.matchId === matchId && request.stateVersion === h.stateVersion &&
        census.matchId === matchId && census.stateVersion === h.stateVersion &&
        census.eventSeq === h.eventSeq && !census.unresolvedNativeHistory &&
        source && source.cardId === request.cardId && source.sourceEpoch === request.sourceEpoch &&
        source.ownerPlayerId === request.actor &&
        source.zone.kind === "hand" && source.zone.zonePlayerId === request.actor &&
        source.programReference === reference?.encodedReference &&
        program?.semantics.kind === "spell-resolution" &&
        card?.cardType === "Spell" && base?.kind === "numeric" &&
        nonblank(request.baseProofId) && nonblank(request.coverageProofId) &&
        options.verifySpellCostBinding?.(request, census) && head() === h);
    } catch { complete = false; }
    return { ...request, status: complete ? "complete" as const : "unknown" as const };
  }
  function derivedMight(uid: string, c: DuelPhaseSourceClosureContextV2): DuelDerivedMightCheckpointV2 {
    const blocked = (reason: string): DuelDerivedMightCheckpointV2 => ({ status: "blocked", uid, reason });
    const h = head();
    if (!h || !bound(h, c) || c.event !== "continuous") return blocked("stale-continuous-boundary");
    const global = snapshot(h, c);
    if (!global || !global.coverage.some(item => item.requirement === "continuous-effect-registry"))
      return blocked("unresolved-continuous-coverage");
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(h).find(item => item.uid === uid);
    if (!source || source.kind !== "unit" || source.cardId === null) return blocked("unknown-unit-source");
    const card = byCard.get(source.cardId);
    if (!card || card.cardType !== "Unit" || !safeCount(card.might)) return blocked("unknown-printed-might");
    const baseMight = card.might;
    // Printed base Might is distinct from derived Might. Every hidden and
    // runtime source must close before asserting that it is unchanged.
    const inspected = inspect(c);
    if (inspected.status !== "ready" || inspected.handlers.length > 0 ||
        inspected.activeSources.length > 0 || head() !== h)
      return { status: "blocked", uid, baseMight, reason: "unresolved-derived-might" };
    return { status: "complete", uid, baseMight, currentMight: baseMight };
  }
  return Object.freeze({ phaseRegistry, inspect, entry, costBinding, spellCostBinding, derivedMight });
}
