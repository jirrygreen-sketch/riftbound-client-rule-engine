/**
 * Minimal source-qualified continuous Might evaluator.
 *
 * This module intentionally evaluates one narrow, fully sourced rule slice:
 * the bound source.might of a printed Unit, Soul Shepherd's token modifier,
 * and the narrow self-Assault/Shield passives (CR 807/814). Every other active, runtime,
 * or unknown program blocks the answer.
 */
import {
  assertAdmittedDuelMatchV2,
  enumerateDuelObjectsV2,
  inspectDuelNativeTokenHistoryV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import {
  inspectDuelPhaseSourceClosureV2,
  type DuelPhaseSourceClosureCandidateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelPhaseSourceClosureInspectionV2,
  type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureRegistryV2,
} from './phase-source-closure-v2.js';
import type { DuelPhysicalZone } from './permanent-state.js';
import {
  encodeDuelProgramReferenceRaw,
  queryDuelSourceProgramPhaseScope,
  type DuelOfficialProgram,
  type DuelOfficialProgramRegistry,
} from '@riftbound/card-dsl/duel';

export const DUEL_SOUL_SHEPHERD_CARD_ID_V2 = 'unl-077-219' as const;

export interface DuelDerivedMightSourceEvidenceV2 {
  readonly uid: string;
  readonly cardId: string;
  readonly zoneEpoch: number;
  readonly controllerPlayerId: string;
  readonly programId: string;
  readonly programReference: string;
  readonly amount: number;
  readonly stateVersion: number;
  readonly eventSeq: number;
}

export interface DuelDerivedMightTokenEvidenceV2 {
  readonly uid: string;
  readonly sourceProofId: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: 'current' | 'pre-exit';
  readonly controllerPlayerId: string;
  readonly createdAtStateVersion: number;
  readonly baseMight: 1;
}

export interface DuelDerivedMightCompleteV2 {
  readonly status: 'complete';
  readonly uid: string;
  readonly baseMight: number;
  readonly currentMight: number;
  readonly targetZoneEpoch: number | null;
  readonly targetControllerPlayerId: string;
  readonly appliedSources: readonly DuelDerivedMightSourceEvidenceV2[];
  readonly appliedSourceUIDs: readonly string[];
  readonly tokenEvidence?: DuelDerivedMightTokenEvidenceV2;
  readonly head: {
    readonly matchId: string;
    readonly stateVersion: number;
    readonly eventSeq: number;
    readonly turn: number;
  };
}

export interface DuelDerivedMightBlockedV2 {
  readonly status: 'blocked';
  readonly uid: string;
  readonly baseMight?: number;
  readonly reason: string;
}

export type DuelDerivedMightResultV2 = DuelDerivedMightCompleteV2 | DuelDerivedMightBlockedV2;

export interface DuelDerivedMightRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly uid: string;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly closureRegistry: DuelPhaseSourceClosureRegistryV2;
  readonly journal: DuelPhaseSourceClosureJournalV2;
  /** The registry is the exact facade created from the verified official catalog. */
  readonly officialPrograms: DuelOfficialProgramRegistry;
}

export interface DuelDerivedMightEvaluatorV2 {
  readonly evaluate: (uid: string) => DuelDerivedMightResultV2;
  readonly currentMight: (uid: string) => number;
}

function blocked(uid: string, reason: string, baseMight?: number): DuelDerivedMightBlockedV2 {
  return baseMight === undefined ? { status: 'blocked', uid, reason } :
    { status: 'blocked', uid, baseMight, reason };
}

function safeAdd(a: number, b: number): number | null {
  const value = a + b;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isBoardZone(candidate: DuelPhaseSourceClosureCandidateV2): boolean {
  return candidate.zone.kind === 'board-base' || candidate.zone.kind === 'board-battlefield';
}

function sameZone(a: DuelPhaseSourceClosureCandidateV2, b: DuelPhaseSourceClosureCandidateV2): boolean {
  return a.zone.kind === b.zone.kind && ('locationId' in a.zone
    ? 'locationId' in b.zone && a.zone.locationId === b.zone.locationId
    : 'zonePlayerId' in b.zone && a.zone.zonePlayerId === b.zone.zonePlayerId);
}

function sameZoneValue(a: DuelPhysicalZone, b: DuelPhysicalZone): boolean {
  if (a.kind !== b.kind) return false;
  if ('locationId' in a) return 'locationId' in b && a.locationId === b.locationId;
  return 'zonePlayerId' in b && a.zonePlayerId === b.zonePlayerId;
}

/** CR 459/807: only a Unit on an active Combat battlefield controlled by the
 * canonical contesting player has the Attacker designation. A staged
 * Showdown is deliberately not enough. */
function isCanonicalCombatAttacker(
  match: DuelCanonicalPlayingStateV2,
  candidate: DuelPhaseSourceClosureCandidateV2,
): boolean {
  if (candidate.kind !== 'unit' || candidate.controllerPlayerId === null ||
      candidate.zone.kind !== 'board-battlefield') return false;
  const locationId = candidate.zone.locationId;
  const field = match.board.battlefields.find(value => value.locationId === locationId);
  return field !== undefined && field.showdown === 'active' && field.combat === 'active' &&
    field.contestingPlayerId !== null && field.contestingPlayerId === candidate.controllerPlayerId;
}

/** CR 459/814: a Defender is a Unit that has the Defender designation during
 * active Combat.  Core's admitted board does not persist designation bits, so
 * the designation is derived only from the active Combat field's contesting
 * player and the Unit's live controller.  A staged Showdown, field controller,
 * or attacker/contesting Unit is not a Defender. */
function isCanonicalCombatDefender(
  match: DuelCanonicalPlayingStateV2,
  candidate: DuelPhaseSourceClosureCandidateV2,
): boolean {
  if (candidate.kind !== 'unit' || candidate.controllerPlayerId === null ||
      candidate.zone.kind !== 'board-battlefield') return false;
  const locationId = candidate.zone.locationId;
  const field = match.board.battlefields.find(value => value.locationId === locationId);
  return field !== undefined && field.showdown === 'active' && field.combat === 'active' &&
    field.contestingPlayerId !== null && field.contestingPlayerId !== candidate.controllerPlayerId;
}

function plainProgram(registry: DuelOfficialProgramRegistry, cardId: string,
  match: DuelCanonicalPlayingStateV2, phase: string): DuelOfficialProgram | null {
  try {
    const binding = registry.get(cardId);
    const program = registry.getProgram(cardId);
    const reference = registry.reference(cardId);
    if (!binding || binding.status !== 'resolved' || !program || !reference ||
        program.cardId !== cardId || program.source.cardId !== cardId ||
        program.source.dataVersion !== match.dataVersion ||
        program.source.sourceCatalogDigest !== match.catalogDigest ||
        reference.cardId !== cardId || reference.programId !== program.programId ||
        reference.dataVersion !== program.source.dataVersion ||
        reference.sourceCatalogDigest !== program.source.sourceCatalogDigest) return null;
    const phaseScope = queryDuelSourceProgramPhaseScope(registry, cardId, phase, reference);
    if (!phaseScope || phaseScope.scope !== 'source-program' || phaseScope.sourceProgramComplete !== true ||
        phaseScope.programId !== program.programId || phaseScope.sourceCardId !== cardId ||
        phaseScope.sourceDataVersion !== program.source.dataVersion ||
        phaseScope.sourceCatalogDigest !== program.source.sourceCatalogDigest ||
        !phaseScope.reference || encodeDuelProgramReferenceRaw(phaseScope.reference) !== encodeDuelProgramReferenceRaw(reference)) return null;
    return program;
  } catch {
    return null;
  }
}

function sourceReference(registry: DuelOfficialProgramRegistry, program: DuelOfficialProgram): string | null {
  try {
    const reference = registry.reference(program.cardId);
    if (!reference || reference.programId !== program.programId) return null;
    // This is a stable source identity for the closure registry's expected
    // printing reference. Avoid accepting a caller-provided textual reference.
    return encodeDuelProgramReferenceRaw(reference);
  } catch {
    return null;
  }
}

function sourceCandidate(inspected: DuelPhaseSourceClosureInspectionV2, uid: string):
  DuelPhaseSourceClosureCandidateV2 | undefined {
  return inspected.candidates.find(candidate => candidate.uid === uid && candidate.carrier === 'object');
}

function verifyTokenBase(match: DuelCanonicalPlayingStateV2,
  candidate: DuelPhaseSourceClosureCandidateV2): DuelDerivedMightTokenEvidenceV2 | null {
  if (candidate.kind !== 'unit' || candidate.cardId !== null || !isBoardZone(candidate) ||
      candidate.zoneEpoch !== null || candidate.controllerPlayerId === null) return null;
  try {
    const history = inspectDuelNativeTokenHistoryV2(match);
    const birth = history.births.find(entry => entry.tokenUID === candidate.uid && entry.kind === 'recruit');
    const trait = match.unitMeta[candidate.uid]?.trait;
    if (!birth || birth.controllerPlayerId !== candidate.controllerPlayerId ||
        birth.effectControllerPlayerId !== candidate.controllerPlayerId ||
        birth.matchId !== match.matchId || birth.dataVersion !== match.dataVersion ||
        birth.catalogDigest !== match.catalogDigest || birth.createdAtStateVersion > match.stateVersion ||
        !trait || trait.kind !== 'token' || trait.name !== 'Recruit' || trait.baseMight !== 1 ||
        trait.tags.length !== 1 || trait.tags[0] !== 'Recruit') return null;
    return {
      uid: candidate.uid, sourceProofId: birth.sourceProofId,
      sourceEffectId: birth.sourceEffectId, eventId: birth.eventId,
      sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
      sourceMode: birth.sourceMode, controllerPlayerId: birth.controllerPlayerId,
      createdAtStateVersion: birth.createdAtStateVersion, baseMight: 1,
    };
  } catch {
    return null;
  }
}

function sourceEvidence(candidate: DuelPhaseSourceClosureCandidateV2,
  program: DuelOfficialProgram, reference: string, match: DuelCanonicalPlayingStateV2): DuelDerivedMightSourceEvidenceV2 | null {
  if (candidate.carrier !== 'object' || candidate.cardId !== program.cardId || candidate.zoneEpoch === null ||
      candidate.controllerPlayerId === null || !isBoardZone(candidate)) return null;
  const semantics = program.semantics as unknown as {
    readonly kind: string;
    readonly event?: string;
    readonly sourceScope?: string;
    readonly modifier?: { readonly kind?: string; readonly amount?: number;
      readonly controller?: string; readonly scope?: string };
  };
  let amount: number;
  if (semantics.kind === 'continuous') {
    if (candidate.cardId !== DUEL_SOUL_SHEPHERD_CARD_ID_V2 || semantics.sourceScope !== 'source-unit-on-board' ||
        semantics.modifier?.kind !== 'token-unit-might' || semantics.modifier.amount !== 1 ||
        semantics.modifier.controller !== 'ability-controller' || semantics.modifier.scope !== 'board') return null;
    amount = 1;
  } else if (semantics.kind === 'passive' && semantics.event === 'attacker' &&
      semantics.sourceScope === 'source-unit-on-board' && semantics.modifier?.kind === 'self-assault' &&
      typeof semantics.modifier.amount === 'number' && Number.isSafeInteger(semantics.modifier.amount) &&
      semantics.modifier.amount >= 0) {
    amount = semantics.modifier.amount;
  } else if (semantics.kind === 'passive' && semantics.event === 'defender' &&
      semantics.sourceScope === 'source-unit-on-board' && semantics.modifier?.kind === 'self-shield' &&
      typeof semantics.modifier.amount === 'number' && Number.isSafeInteger(semantics.modifier.amount) &&
      semantics.modifier.amount >= 0) {
    amount = semantics.modifier.amount;
  } else return null;
  return { uid: candidate.uid, cardId: candidate.cardId, zoneEpoch: candidate.zoneEpoch,
    controllerPlayerId: candidate.controllerPlayerId, programId: program.programId,
    programReference: reference, amount, stateVersion: match.stateVersion, eventSeq: match.eventSeq };
}

function evaluate(request: DuelDerivedMightRequestV2): DuelDerivedMightResultV2 {
  if (!request || typeof request !== 'object') return blocked('', 'invalid-request');
  const uid = typeof request.uid === 'string' ? request.uid : '';
  if (!uid) return blocked('', 'invalid-unit-uid');
  let match: DuelCanonicalPlayingStateV2;
  try {
    assertAdmittedDuelMatchV2(request.match);
    if (request.match.stage !== 'playing') return blocked(uid, 'admitted-playing-head-required');
    match = request.match;
  } catch {
    return blocked(uid, 'admitted-playing-head-required');
  }
  const context = request.context;
  if (!context || context.event !== 'continuous' ||
      context.matchId !== match.matchId || context.dataVersion !== match.dataVersion ||
      context.catalogDigest !== match.catalogDigest || context.turn !== match.frame.turnNumber ||
      context.clock.stateVersion !== match.stateVersion || context.clock.eventSeq !== match.eventSeq ||
      !context.taskId.includes(`turn-${context.turn}:`)) return blocked(uid, 'stale-continuous-boundary');

  let objects: readonly ReturnType<typeof enumerateDuelObjectsV2>[number][];
  try { objects = enumerateDuelObjectsV2(match); } catch { return blocked(uid, 'unadmitted-or-invalid-match'); }
  const object = objects.find(item => item.uid === uid);
  if (!object || object.kind !== 'unit' || object.controllerPlayerId === null ||
      !object.zone || (object.zone.kind !== 'board-base' && object.zone.kind !== 'board-battlefield'))
    return blocked(uid, 'unknown-live-board-unit');
  const meta = match.unitMeta[uid];
  if (!meta || meta.ownerPlayerId !== object.ownerPlayerId) return blocked(uid, 'unit-metadata-mismatch');

  let inspected: DuelPhaseSourceClosureInspectionV2;
  try {
    inspected = inspectDuelPhaseSourceClosureV2(match, context,
      { registry: request.closureRegistry, journal: request.journal });
  } catch { return blocked(uid, 'source-closure-error'); }
  if (inspected.status !== 'ready') return blocked(uid, `source-closure-${inspected.reason ?? 'pending'}`);
  const target = sourceCandidate(inspected, uid);
  const targetZoneMatches = target !== undefined && sameZoneValue(target.zone, object.zone);
  if (!target || target.cardId !== object.cardId || target.zoneEpoch !== object.zoneEpoch ||
      target.controllerPlayerId !== object.controllerPlayerId || !targetZoneMatches) return blocked(uid, 'target-source-changed');

  let baseMight: number;
  let tokenEvidence: DuelDerivedMightTokenEvidenceV2 | undefined;
  if (object.cardId !== null) {
    const program = plainProgram(request.officialPrograms, object.cardId, match, context.phase);
    const semantics = program?.semantics as unknown as {
      readonly kind?: string;
      readonly event?: string;
      readonly sourceScope?: string;
      readonly modifier?: { readonly kind?: string };
      readonly playability?: { readonly kind?: string };
    } | undefined;
    const printedUnit = semantics?.kind === 'no-ability' && semantics.playability?.kind === 'printed-unit';
    const assaultUnit = semantics?.kind === 'passive' && semantics.event === 'attacker' &&
      semantics.sourceScope === 'source-unit-on-board' && semantics.modifier?.kind === 'self-assault';
    const shieldUnit = semantics?.kind === 'passive' && semantics.event === 'defender' &&
      semantics.sourceScope === 'source-unit-on-board' && semantics.modifier?.kind === 'self-shield';
    if (!program || program.source.cardId !== object.cardId || program.source.might === null ||
        !Number.isSafeInteger(program.source.might) || program.source.might < 0 ||
        (!printedUnit && !assaultUnit && !shieldUnit))
      return blocked(uid, 'unsupported-or-unknown-physical-unit-program');
    if (meta.trait.kind !== 'card' || meta.trait.cardId !== object.cardId) return blocked(uid, 'physical-unit-trait-mismatch');
    baseMight = program.source.might;
  } else {
    const verified = verifyTokenBase(match, target);
    if (!verified) return blocked(uid, 'unverified-recruit-token-source');
    baseMight = verified.baseMight;
    tokenEvidence = verified;
  }

  const appliedSources: DuelDerivedMightSourceEvidenceV2[] = [];
  const targetIsToken = object.cardId === null && tokenEvidence !== undefined;
  for (const candidate of inspected.candidates) {
    if (candidate.carrier === 'runtime-effect') return blocked(uid, 'active-runtime-source-unresolved', baseMight);
    if (candidate.cardId === null) {
      if (candidate.uid !== uid && inspected.activeSources.some(source => source.uid === candidate.uid))
        return blocked(uid, 'active-null-card-source-unresolved', baseMight);
      continue;
    }
    const program = plainProgram(request.officialPrograms, candidate.cardId, match, context.phase);
    if (!program) return blocked(uid, 'unknown-candidate-program', baseMight);
    const active = inspected.activeSources.some(source => source.carrier === candidate.carrier && source.uid === candidate.uid &&
      source.zoneEpoch === candidate.zoneEpoch && sameZone(source, candidate));
    const handled = inspected.handlers.some(source => source.carrier === candidate.carrier && source.uid === candidate.uid &&
      source.zoneEpoch === candidate.zoneEpoch && sameZone(source, candidate));
    if (handled) return blocked(uid, 'active-trigger-or-handler-unresolved', baseMight);
    if (!active) continue;
    const reference = sourceReference(request.officialPrograms, program);
    if (!reference) return blocked(uid, 'missing-official-program-reference', baseMight);
    const evidence = sourceEvidence(candidate, program, reference, match);
    if (!evidence) return blocked(uid, 'active-source-scope-mismatch', baseMight);
    const semantics = program.semantics as unknown as { readonly kind?: string; readonly event?: string };
    if (semantics.kind === 'continuous') {
      if (targetIsToken && evidence.controllerPlayerId === object.controllerPlayerId) appliedSources.push(evidence);
    } else if (semantics.kind === 'passive' && semantics.event === 'attacker') {
      // Self-Assault never grants another Unit Might. A non-attacker target is
      // a known zero contribution, including pre-combat/staged Showdown.
      if (candidate.uid === uid && isCanonicalCombatAttacker(match, candidate)) appliedSources.push(evidence);
    } else if (semantics.kind === 'passive' && semantics.event === 'defender') {
      // Shield is self-only.  Only the live Defender designation contributes;
      // an attacker, field controller, or staged/non-combat Showdown is zero.
      if (candidate.uid === uid && isCanonicalCombatDefender(match, candidate)) appliedSources.push(evidence);
    } else return blocked(uid, 'active-unsupported-continuous-program', baseMight);
  }
  let current = baseMight;
  for (const source of appliedSources) {
    const next = safeAdd(current, source.amount);
    if (next === null) return blocked(uid, 'might-overflow', baseMight);
    current = next;
  }
  return Object.freeze({ status: 'complete', uid, baseMight, currentMight: current,
    targetZoneEpoch: object.zoneEpoch, targetControllerPlayerId: object.controllerPlayerId,
    appliedSources: Object.freeze(appliedSources), appliedSourceUIDs: Object.freeze(appliedSources.map(source => source.uid)),
    ...(tokenEvidence ? { tokenEvidence: Object.freeze(tokenEvidence) } : {}),
    head: Object.freeze({ matchId: match.matchId, stateVersion: match.stateVersion,
      eventSeq: match.eventSeq, turn: match.frame.turnNumber }) });
}

export function deriveDuelCurrentMightV2(request: DuelDerivedMightRequestV2): DuelDerivedMightResultV2 {
  return evaluate(request);
}

export const deriveDuelUnitCurrentMightV2 = deriveDuelCurrentMightV2;
export const evaluateDuelCurrentMightV2 = deriveDuelCurrentMightV2;

export function createDuelDerivedMightEvaluatorV2(
  request: Omit<DuelDerivedMightRequestV2, 'uid'>,
): DuelDerivedMightEvaluatorV2 {
  const result = Object.freeze({
    evaluate: (uid: string): DuelDerivedMightResultV2 => evaluate({ ...request, uid }),
    currentMight: (uid: string): number => {
      const value = evaluate({ ...request, uid });
      if (value.status !== 'complete') throw new TypeError(`Duel derived Might blocked: ${value.reason}`);
      return value.currentMight;
    },
  });
  return result;
}

