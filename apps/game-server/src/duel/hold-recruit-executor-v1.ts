/**
 * Narrow server capability for the one reviewed Hold -> Recruit program.
 *
 * This factory is deliberately not a general CardPlay executor. The Core token birth is
 * real, but a Recruit cannot be published as a settled Play until the owning runtime supplies
 * an exact entry/replacement/cost/trigger proof. Without that proof this adapter stays pending.
 */
import {
  attestDuelTokenSourceV2,
  createDuelPhaseSourceRegistryWithNativeTokenSourceV2,
  createDuelRecruitUnitV2,
  enumerateDuelObjectsV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelNativeTokenHistoryV2,
  type DuelPhaseClosureCoreRequestV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceRequestV2,
  type DuelTokenBirthJournalEntryV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseRegistryV2,
  type DuelPhaseSourceV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import type {
  DuelOfficialProgram,
  DuelOfficialProgramRegistry,
} from "@riftbound/card-dsl/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";
import {
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
} from "./card-program-authority.js";
import type { DuelNativeOperationJournalV2 } from "./operation-journal-v2.js";
import { inspectDuelNativeOperationJournalBindingV2 } from "./operation-journal-v2.js";
import type { DuelProductionSourceServicesV2 } from "./production-source-services-v2.js";

export interface HoldRecruitEntryProofRequestV1 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly source: DuelPhaseSourceV2;
  readonly taskId: string;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly locationId: string;
}

/** Proof from the owner of the complete Play/entry boundary. A boolean is insufficient. */
export interface HoldRecruitEntryProofV1 {
  readonly status: "resolved";
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly sourceUID: string;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly scope: "exact";
  readonly costs: "none";
  readonly replacements: "none" | "resolved";
  readonly triggers: "none" | "resolved";
}

export interface HoldRecruitExecutorOptionsV1 {
  readonly catalog: CardCatalogRuntime;
  readonly genuineCardProgramAuthority: CardProgramAuthority;
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  readonly currentJournal: () => DuelNativeOperationJournalV2;
  readonly sourceServices: DuelProductionSourceServicesV2;
  readonly uidFactory: () => string;
  /** Omit to keep Recruit Play pending with an explicit audit reason. */
  readonly resolveRecruitEntry?: (
    request: HoldRecruitEntryProofRequestV1,
  ) => HoldRecruitEntryProofV1 | null;
}

export interface HoldRecruitAuditEntryV1 {
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly controllerPlayerId: string;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly taskId: string;
  readonly stateVersion: number;
  readonly status: "settled" | "pending";
  readonly reason?: string;
}

interface PendingRecruitStageV1 {
  readonly before: DuelCanonicalPlayingStateV2;
  readonly next: DuelCanonicalPlayingStateV2;
  readonly source: DuelPhaseSourceV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly taskId: string;
  readonly journalRevision: number;
  readonly candidateSetRevision: number;
}

export interface HoldRecruitExecutorV1 {
  readonly phaseRegistry: DuelPhaseRegistryV2;
  readonly resolveNativeHandlers: NonNullable<DuelTurnServicesV2["resolveNativeHandlers"]>;
  /** Adapter for ProductionSourceServices' independently protected token decision seam. */
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
  readonly audit: {
    readonly snapshot: () => readonly HoldRecruitAuditEntryV1[];
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function exactRecruitTags(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && Reflect.ownKeys(value).length === 2 &&
    value[0] === "Recruit";
}
function sameSource(a: DuelPhaseSourceV2, b: DuelPhaseSourceV2): boolean {
  return a.uid === b.uid && a.kind === b.kind && a.cardId === b.cardId &&
    a.zoneEpoch === b.zoneEpoch && a.controllerPlayerId === b.controllerPlayerId &&
    same(a.zone, b.zone);
}
function exactHoldRecruit(programs: DuelOfficialProgramRegistry, cardId: string): boolean {
  const program: DuelOfficialProgram | undefined = programs.getProgram(cardId);
  if (!program || program.source.cardType !== "Battlefield" ||
      program.source.normalizedAbilityText !==
        "When you hold here, play a 1 :rb_might: Recruit unit token in your base." ||
      program.semantics.kind !== "trigger" || program.semantics.event !== "hold" ||
      program.semantics.sourceScope !== "battlefield-controller" || program.semantics.optional !== false ||
      program.semantics.costs.length !== 0 || program.semantics.effects.length !== 1) return false;
  const effect = program.semantics.effects[0];
  return effect.kind === "play-recruit-token" && effect.controller === "effect-controller" &&
    effect.owner === "effect-controller" && effect.destination === "base" &&
    effect.resolution === "deferred-token-play" && effect.token.cardType === "Unit" &&
    effect.token.domainless === true && effect.token.might === 1 &&
    effect.token.energy === null && effect.token.power === null &&
    effect.token.physicalPrintingCardId === null && same(effect.token.domains, []) &&
    same(effect.token.tags, ["Recruit"]);
}
function recruitReference(head: DuelCanonicalPlayingStateV2,
  birth: DuelTokenBirthJournalEntryV2): string {
  return JSON.stringify({ birthEventId: birth.eventId, catalogDigest: head.catalogDigest,
    dataVersion: head.dataVersion, kind: "recruit-birth-reference", matchId: head.matchId,
    schemaVersion: 1, sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
    sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
    sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID });
}
function contextFor(match: DuelCanonicalPlayingStateV2,
  event: Parameters<NonNullable<DuelTurnServicesV2["resolveNativeHandlers"]>>[0]["step"],
  taskId: string) {
  return {
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber, taskId, phase: event as never, event: event as never,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq },
  } as unknown as DuelPhaseSourceClosureContextV2;
}

export function createDuelHoldRecruitExecutorV1(
  options: HoldRecruitExecutorOptionsV1,
): HoldRecruitExecutorV1 {
  const { catalog, genuineCardProgramAuthority: authority, currentHead, currentJournal,
    sourceServices, uidFactory, resolveRecruitEntry } = options;
  if (!catalog?.publicCatalog || !authority || typeof currentHead !== "function" ||
      typeof currentJournal !== "function" || !sourceServices || typeof uidFactory !== "function" ||
      catalog.publicCatalog.dataVersion !== authority.catalogStamp.dataVersion ||
      catalog.publicCatalog.digest !== authority.catalogStamp.digest ||
      typeof sourceServices.inspect !== "function") {
    throw new TypeError("genuine catalog, program authority, source services and journal are required");
  }
  const first = currentHead();
  if (!first || first.stage !== "playing" || first.dataVersion !== authority.catalogStamp.dataVersion ||
      first.catalogDigest !== authority.catalogStamp.digest) throw new TypeError("admitted current head is required");
  const journal = currentJournal();
  const initialBinding = inspectDuelNativeOperationJournalBindingV2(journal);
  if (!journal || !initialBinding || initialBinding.authority === undefined ||
      initialBinding.head !== first || initialBinding.observed !== first)
    throw new TypeError("journal must own the current head");
  const journalAuthority = initialBinding.authority;
  const programs = getCardProgramRegistryForRuntime(authority);
  const root = first;
  const auditEntries: HoldRecruitAuditEntryV1[] = [];
  const usedEffects = new Set<string>();
  const usedTokens = new Set<string>();
  const pendingStages = new Map<string, PendingRecruitStageV1>();

  function current(): DuelCanonicalPlayingStateV2 | null {
    const value = currentHead();
    return value?.stage === "playing" && value.matchId === root.matchId &&
      value.dataVersion === root.dataVersion && value.catalogDigest === root.catalogDigest ? value : null;
  }
  function binding(head: DuelCanonicalPlayingStateV2) {
    const candidate = currentJournal();
    const value = inspectDuelNativeOperationJournalBindingV2(candidate);
    return value && value.authority === journalAuthority && value.head === head &&
      value.observed === head && value.journal === candidate ? value : null;
  }
  /** Publish helper consumption only after the owner has observed the exact Core descendant. */
  function finalizePublishedStages(): void {
    const head = current();
    if (!head) return;
    const owned = binding(head);
    if (!owned) return;
    for (const [sourceEffectId, stage] of pendingStages) {
      if (stage.next !== head || owned.revision <= stage.journalRevision) continue;
      let birth: DuelTokenBirthJournalEntryV2 | null = null;
      try { birth = owned.journal.tokenBirth(stage.tokenUID); } catch { birth = null; }
      if (!birth || birth.kind !== "recruit" || birth.sourceUID !== stage.source.uid ||
          birth.sourceEffectId !== sourceEffectId || birth.eventId !== stage.eventId ||
          birth.controllerPlayerId !== stage.source.controllerPlayerId) continue;
      usedEffects.add(sourceEffectId);
      usedTokens.add(stage.tokenUID);
      auditEntries.push(Object.freeze({ sourceUID: stage.source.uid,
        sourceZoneEpoch: stage.source.zoneEpoch!, controllerPlayerId: stage.source.controllerPlayerId!,
        tokenUID: stage.tokenUID, sourceEffectId, eventId: stage.eventId, taskId: stage.taskId,
        stateVersion: head.stateVersion, status: "settled" as const }));
      pendingStages.delete(sourceEffectId);
    }
  }
  function isHandler(match: DuelCanonicalPlayingStateV2, source: DuelPhaseSourceV2,
    taskId: string): boolean {
    if (source.kind !== "battlefield" || source.cardId === null ||
        source.controllerPlayerId !== match.frame.turnPlayerId || !exactHoldRecruit(programs, source.cardId)) return false;
    try {
      if (!binding(match)) return false;
      const inspection = sourceServices.inspect(contextFor(match, "hold", taskId));
      if (!binding(match)) return false;
      return inspection.status === "ready" && inspection.handlers.some(candidate =>
        candidate.uid === source.uid && candidate.cardId === source.cardId &&
        candidate.zoneEpoch === source.zoneEpoch && candidate.controllerPlayerId === source.controllerPlayerId &&
        same(candidate.zone, source.zone));
    } catch { return false; }
  }
  function nativeRecruitEvidence(request: DuelPhaseSourceRequestV2) {
    const head = current();
    const source = request.source;
    if (!head || request.match !== head || source.kind !== "unit" || source.cardId !== null ||
        source.controllerPlayerId === null ||
        (source.zone.kind !== "board-base" && source.zone.kind !== "board-battlefield") ||
        source.zoneEpoch !== null) return { status: "unknown" as const };
    if (!binding(head)) return { status: "unknown" as const };
    const sourceLocationId = source.zone.locationId;
    const unit = head.board.units.find(item => item.objectId === source.uid);
    const meta = unit ? head.unitMeta[unit.objectId] : undefined;
    const trait = meta?.trait;
    if (!unit || unit.controllerPlayerId !== source.controllerPlayerId ||
        unit.locationId !== sourceLocationId || !meta ||
        !trait || trait.kind !== "token" || trait.name !== "Recruit" || trait.baseMight !== 1 ||
        !exactRecruitTags(trait.tags) || Reflect.ownKeys(trait).length !== 4) {
      return { status: "unknown" as const };
    }
    let history;
    try { history = inspectDuelNativeTokenHistoryV2(head); } catch { return { status: "unknown" as const }; }
    const birth = history.births.find(item => item.kind === "recruit" && item.tokenUID === source.uid);
    if (!birth || birth.controllerPlayerId !== source.controllerPlayerId ||
        birth.effectControllerPlayerId !== source.controllerPlayerId ||
        birth.sourceMode !== "current" || birth.name !== "Recruit" || birth.baseMight !== 1 ||
        !exactRecruitTags(birth.tags) || !text(birth.sourceProofId) ||
        !text(birth.eventId) || head.physicalCardsByUID[source.uid] !== undefined ||
        !enumerateDuelObjectsV2(head).some(item => item.uid === source.uid &&
          item.kind === "unit" && item.cardId === null && item.controllerPlayerId === source.controllerPlayerId &&
          (item.zone.kind === "board-base" || item.zone.kind === "board-battlefield") &&
          "locationId" in item.zone && item.zone.locationId === sourceLocationId)) {
      return { status: "unknown" as const };
    }
    try {
      const inspected = sourceServices.inspect(contextFor(head, request.event as never, request.taskId));
      if (!binding(head)) return { status: "unknown" as const };
      if (inspected.status !== "ready" || !inspected.candidates.some(candidate =>
          candidate.uid === source.uid && candidate.kind === "unit" && candidate.cardId === null &&
          candidate.controllerPlayerId === source.controllerPlayerId && candidate.zoneEpoch === null &&
          same(candidate.zone, source.zone))) return { status: "unknown" as const };
    } catch { return { status: "unknown" as const }; }
    return { status: "complete" as const, matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: source.uid, zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
      cardId: null, programReference: recruitReference(head, birth), event: request.event,
      eventSupported: true as const, scope: "known-no-handler" as const,
      replacementsCovered: true as const, staticCovered: true as const,
      continuousCovered: true as const, triggersCovered: true as const };
  }
  const phaseRegistry = createDuelPhaseSourceRegistryWithNativeTokenSourceV2({
    matchId: root.matchId, dataVersion: root.dataVersion, catalogDigest: root.catalogDigest,
    printings: authority.resolvedProgramReferenceEntries().map(entry => ({
      cardId: entry.cardId, programReference: entry.encodedReference,
    })),
  }, request => {
    const head = current();
    if (!head || request.match !== head || request.turn !== head.frame.turnNumber || !binding(head)) return { status: "unknown" };
      const context = contextFor(head, request.event as never, request.taskId);
    if (request.source.cardId === null) return nativeRecruitEvidence(request);
    let inspection;
    try { inspection = sourceServices.inspect(context); } catch { return { status: "unknown" }; }
    if (!binding(head)) return { status: "unknown" };
    const source = request.source;
    if (inspection.status !== "ready" || !inspection.candidates.some(candidate =>
        candidate.uid === source.uid && candidate.cardId === source.cardId &&
        candidate.zoneEpoch === source.zoneEpoch && candidate.controllerPlayerId === source.controllerPlayerId &&
        same(candidate.zone, source.zone))) return { status: "unknown" };
    const reference = source.cardId === null ? undefined : authority.resolvedProgramReference(source.cardId);
    if (!reference) return { status: "unknown" };
    if (request.event === "hold" && isHandler(head, source, request.taskId)) {
      return { status: "complete", matchId: head.matchId, dataVersion: head.dataVersion,
        catalogDigest: head.catalogDigest, turn: request.turn, taskId: request.taskId,
        uid: source.uid, zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
        cardId: source.cardId, programReference: reference.encodedReference, event: request.event,
        eventSupported: true, scope: "handlers-or-modifiers", replacementsCovered: true,
        staticCovered: true, continuousCovered: true, triggersCovered: true };
    }
    if (inspection.handlers.length > 0 || inspection.activeSources.length > 0 ||
        inspection.runtimeSources.length > 0) return { status: "unknown" };
    return { status: "complete", matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: source.uid, zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
      cardId: source.cardId, programReference: reference.encodedReference, event: request.event,
      eventSupported: true, scope: "known-no-handler", replacementsCovered: true,
      staticCovered: true, continuousCovered: true, triggersCovered: true };
  }, request => nativeRecruitEvidence(request));

  const resolveNativeHandlers: NonNullable<DuelTurnServicesV2["resolveNativeHandlers"]> = context => {
    const head = current();
    if (!head || head !== context.match || context.step !== "hold" ||
        context.turn !== head.frame.turnNumber || context.holdIndex === undefined ||
        context.holdIndex < 0 || context.holdIndex >= head.board.battlefields.length ||
        head.frame.turnPlayerId !== context.match.frame.turnPlayerId ||
        context.sources.length === 0)
      return { status: "pending" };
    const subject = head.board.battlefields[context.holdIndex]!;
    const subjectZoneEpoch = head.physicalCardsByUID[subject.instanceId]?.zoneEpoch;
    const source = context.sources.find(candidate => candidate.kind === "battlefield" &&
      candidate.uid === subject.instanceId && candidate.cardId === subject.cardId &&
      candidate.zone.kind === "board-battlefield" && candidate.zone.locationId === subject.locationId &&
      candidate.zoneEpoch === subjectZoneEpoch && candidate.controllerPlayerId === subject.controllerPlayerId);
    if (!source) return { status: "pending" };
    if (source.kind !== "battlefield" || source.uid !== subject.instanceId ||
        source.cardId !== subject.cardId || source.zone.kind !== "board-battlefield" ||
        source.zone.locationId !== subject.locationId ||
        source.zoneEpoch !== subjectZoneEpoch ||
        source.controllerPlayerId !== subject.controllerPlayerId ||
        !sameSource(source, { uid: subject.instanceId, kind: "battlefield", cardId: subject.cardId,
          zoneEpoch: subjectZoneEpoch ?? null, controllerPlayerId: subject.controllerPlayerId,
          zone: { kind: "board-battlefield", locationId: subject.locationId } }))
      return { status: "pending" };
    const ownedJournal = binding(head);
    if (!ownedJournal)
      return { status: "pending" };
    finalizePublishedStages();
    const journalRevision = ownedJournal.revision;
    const candidateSetRevision = ownedJournal.candidateSetRevision;
    let next = head;
    if (!isHandler(next, source, context.taskId)) return { status: "pending" };
    const base = next.board.bases.find(item => item.ownerPlayerId === source.controllerPlayerId);
    if (!base || source.zoneEpoch === null) return { status: "pending" };
    const sourceEffectId = `hold-recruit-v1:${context.taskId}:${source.uid}:${source.zoneEpoch}`;
    const eventId = `${sourceEffectId}:event`;
    if (usedEffects.has(sourceEffectId)) return { status: "pending" };
    const staged = pendingStages.get(sourceEffectId);
    if (staged) {
      if (staged.before !== head || !sameSource(staged.source, source)) return { status: "pending" };
      if (staged.journalRevision === journalRevision && staged.candidateSetRevision === candidateSetRevision)
        return { status: "applied", match: staged.next, handledSources: [source] } as
          ReturnType<NonNullable<DuelTurnServicesV2["resolveNativeHandlers"]>>;
      // An unpublished branch is retryable only while its entry/source census is
      // unchanged. Rebuild its proof if protected work changed at the same head.
      pendingStages.delete(sourceEffectId);
    }
    let tokenUID: string;
    try { tokenUID = uidFactory(); } catch { return { status: "pending" }; }
    if (!text(tokenUID) || usedTokens.has(tokenUID) || enumerateDuelObjectsV2(next).some(item => item.uid === tokenUID))
      return { status: "pending" };
    const proofRequest = { match: next, source, taskId: context.taskId, tokenUID,
      sourceEffectId, eventId, locationId: base.locationId };
    let entryProof: HoldRecruitEntryProofV1 | null = null;
    try { entryProof = resolveRecruitEntry?.(Object.freeze(proofRequest)) ?? null; } catch { entryProof = null; }
    const pendingAudit = Object.freeze({ sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch,
      controllerPlayerId: source.controllerPlayerId!, tokenUID, sourceEffectId, eventId,
      taskId: context.taskId, stateVersion: next.stateVersion, status: "pending" as const,
      reason: "complete-recruit-entry-proof-required" });
    if (!entryProof || entryProof.status !== "resolved" || entryProof.scope !== "exact" ||
        entryProof.costs !== "none" || !["none", "resolved"].includes(entryProof.replacements) ||
        !["none", "resolved"].includes(entryProof.triggers) || entryProof.matchId !== next.matchId ||
        entryProof.stateVersion !== next.stateVersion || entryProof.eventSeq !== next.eventSeq ||
        entryProof.sourceUID !== source.uid || entryProof.tokenUID !== tokenUID ||
        entryProof.sourceEffectId !== sourceEffectId || entryProof.eventId !== eventId ||
        entryProof.controllerPlayerId !== source.controllerPlayerId || entryProof.locationId !== base.locationId) {
      auditEntries.push(pendingAudit);
      return { status: "pending" };
    }
    const request = { kind: "recruit" as const, tokenUID, sourceEffectId, eventId,
      sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch, sourceMode: "current" as const,
      effectControllerPlayerId: source.controllerPlayerId!, controllerPlayerId: source.controllerPlayerId!,
      locationId: base.locationId, readied: false, name: "Recruit" as const, baseMight: 1,
      tags: ["Recruit"] as const };
    try {
      const attested = attestDuelTokenSourceV2(next, request, ({ match: checked, request: asked }) => ({
        ...asked, matchId: checked.matchId, dataVersion: checked.dataVersion,
        catalogDigest: checked.catalogDigest,
        sourceProofId: `hold-recruit-v1:${authority.catalogStamp.digest}:${source.uid}:${source.zoneEpoch}`,
      }));
      next = createDuelRecruitUnitV2(next, request, attested.authority);
    } catch { return { status: "pending" }; }
    try {
      const path = inspectDuelNativeCommitPathV2(head, next);
      const afterBinding = binding(head);
      if (!path.length || path.length !== 1 || path.some(commit => commit.tokenBirths.length !== 1 ||
          commit.tokenBirths.some(birth => birth.kind !== "recruit" || birth.tokenUID !== tokenUID)) ||
          path.some(commit => {
            if (commit.before.stage !== "playing" || commit.after.stage !== "playing") return true;
            return commit.before.frame.priorityPlayerId !== head.frame.priorityPlayerId ||
              commit.after.frame.priorityPlayerId !== head.frame.priorityPlayerId ||
              commit.before.frame.focusPlayerId !== head.frame.focusPlayerId ||
              commit.after.frame.focusPlayerId !== head.frame.focusPlayerId;
          }) ||
          !afterBinding || afterBinding.revision !== journalRevision ||
          afterBinding.candidateSetRevision !== candidateSetRevision)
        return { status: "pending" };
    } catch { return { status: "pending" }; }
    pendingStages.set(sourceEffectId, Object.freeze({ before: head, next, source,
      tokenUID, sourceEffectId, eventId, taskId: context.taskId, journalRevision,
      candidateSetRevision }));
    return { status: "applied", match: next, handledSources: [source] } as
      ReturnType<NonNullable<DuelTurnServicesV2["resolveNativeHandlers"]>>;
  };

  const resolveTokenDecision = (request: DuelPhaseClosureCoreRequestV2,
    birth: DuelTokenBirthJournalEntryV2) => {
    finalizePublishedStages();
    const head = current();
    const ownedJournal = head ? binding(head) : null;
    const source = request?.source;
    if (!head || !ownedJournal || birth.kind !== "recruit" ||
        !auditEntries.some(entry => entry.status === "settled" && entry.tokenUID === birth.tokenUID) ||
        ownedJournal.journal.tokenBirth(birth.tokenUID) !== birth ||
        request.context.matchId !== head.matchId || request.context.dataVersion !== head.dataVersion ||
        request.context.catalogDigest !== head.catalogDigest || request.context.turn !== head.frame.turnNumber ||
        request.context.clock.stateVersion !== head.stateVersion || request.context.clock.eventSeq !== head.eventSeq ||
        request.referenceKind !== "recruit-birth" || source.uid !== birth.tokenUID || source.kind !== "unit" ||
        source.cardId !== null || source.zoneEpoch !== null || source.carrier !== "object" ||
        source.controllerPlayerId !== birth.controllerPlayerId ||
        (source.zone.kind !== "board-base" && source.zone.kind !== "board-battlefield") ||
        !text(request.expectedProgramReference) || request.expectedProgramReference !== recruitReference(head, birth) ||
        birth.sourceProofId !== `hold-recruit-v1:${authority.catalogStamp.digest}:${birth.sourceUID}:${birth.sourceZoneEpoch}` ||
        !enumerateDuelObjectsV2(head).some(item => item.uid === source.uid && item.kind === "unit" &&
          item.cardId === null && item.controllerPlayerId === source.controllerPlayerId &&
          same(item.zone, source.zone)) || head.physicalCardsByUID[source.uid] !== undefined) return null;
    const unit = head.board.units.find(item => item.objectId === source.uid);
    const trait = unit ? head.unitMeta[unit.objectId]?.trait : undefined;
    if (!unit || !trait || trait.kind !== "token" || trait.name !== "Recruit" || trait.baseMight !== 1 ||
        !exactRecruitTags(trait.tags) || Reflect.ownKeys(trait).length !== 4) return null;
    const endBinding = binding(head);
    if (!endBinding || endBinding.revision !== ownedJournal.revision ||
        endBinding.candidateSetRevision !== ownedJournal.candidateSetRevision) return null;
    return { status: "resolved" as const, scope: "exact" as const, matchId: head.matchId,
      stateVersion: head.stateVersion, uid: birth.tokenUID, sourceProofId: birth.sourceProofId,
      decision: "inactive" as const };
  };
  return Object.freeze({ phaseRegistry, resolveNativeHandlers, resolveTokenDecision,
    audit: Object.freeze({ snapshot: () => Object.freeze(auditEntries.map(entry => ({ ...entry }))) }) });
}

