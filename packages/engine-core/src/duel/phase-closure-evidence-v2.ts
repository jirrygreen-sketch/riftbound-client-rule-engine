// Private, process-local Core/registry/journal seam. A capability constructor is
// dependency injection for *protected callbacks*, NOT an authenticator for a
// callback written from network JSON. Only the internal Core owner may register
// resolvers backed by its admitted match, verified catalog and event journals.
import type {
  DuelPhaseSourceClosureCandidateV2,
  DuelPhaseSourceClosureContextV2,
  DuelPhaseSourceClosureProgramResultV2,
} from './phase-source-closure-v2.js';

/** Structural consumer of the real card-dsl registry's source-program answer. */
export interface DuelPhaseClosureSourceLocalV2 {
  readonly scope: 'source-program' | 'unknown';
  readonly directBoundaryStatus: 'known-no-handler' | 'handlers-or-modifiers' | 'unknown';
  readonly sourceApplicabilityStatus: 'known-no-handler' | 'handlers-or-modifiers' | 'unknown';
  readonly globalClosureStatus: 'unverified';
  readonly event: string;
  readonly mode: 'atomic-boundary' | 'runtime-subevents';
  readonly programId: string | null;
  readonly reference: {
    readonly kind: 'duel-official-program-reference';
    readonly schemaVersion: 1;
    readonly programId: string;
    readonly cardId: string;
    readonly dataVersion: string;
    readonly sourceCatalogDigest: string;
  } | null;
  readonly handlers: readonly string[];
  readonly modifiers: readonly string[];
  readonly runtimeSubevents: readonly {
    readonly event: string;
    readonly handlers: readonly string[];
    readonly modifiers: readonly string[];
  }[];
  readonly eventRecognized: boolean;
  readonly sourceProgramComplete: boolean;
  readonly requiredGlobalRuntimeClosure: readonly string[];
  readonly reason?: string;
  readonly sourceCardId: string | null;
  readonly sourceDataVersion: string | null;
  readonly sourceCatalogDigest: string | null;
}

export type DuelPhaseClosureReferenceKindV2 = 'printing' | 'gold-cr-intrinsic' | 'recruit-birth';
export interface DuelPhaseClosureCoreRequestV2 {
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly source: DuelPhaseSourceClosureCandidateV2;
  readonly expectedProgramReference: string;
  readonly referenceKind: DuelPhaseClosureReferenceKindV2;
}
/** Locator only. The issuer must look up ALL the other fields in protected Core,
 * not take a context, candidate, catalog reference or decision from this input. */
export interface DuelPhaseClosureRequestLocatorV2 {
  readonly matchId: string;
  readonly taskId: string;
  readonly uid: string;
}
export interface DuelPhaseClosureRegistryResolutionV2 {
  readonly request: DuelPhaseClosureCoreRequestV2;
  readonly encodedProgramReference: string;
  readonly sourceLocal: DuelPhaseClosureSourceLocalV2;
}
export interface DuelPhaseClosureTokenResolutionV2 {
  readonly request: DuelPhaseClosureCoreRequestV2;
  readonly uid: string;
  readonly kind: 'gold' | 'recruit';
  readonly birthEventId: string;
  readonly sourceEffectId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: 'current' | 'pre-exit';
  readonly sourceProofId: string;
  readonly controllerPlayerId: string;
  readonly journalRevision: number;
  readonly programReference: string;
  readonly decision: 'active' | 'inactive' | 'handler';
}
export type DuelPhaseClosureRequirementV2 =
  | 'all-source-candidate-closure' | 'hidden-zone-event-subjects'
  | 'continuous-effect-registry' | 'cleanup-queue-and-replacements'
  | 'runtime-subevent-journal' | 'recursive-conquer-event-journal'
  | 'draw-subject-journal' | 'pre-exit-event-journal'
  | 'kill-trigger-effect-cases' | 'zone-transition-journal';
export interface DuelPhaseClosureJournalResolutionV2 {
  readonly request: DuelPhaseClosureCoreRequestV2;
  readonly proofId: string;
  readonly journalRevision: number;
  readonly candidateSetRevision: number;
  readonly coverage: readonly {
    readonly requirement: DuelPhaseClosureRequirementV2;
    readonly journalRevision: number;
    readonly proofId: string;
  }[];
}

/** No factory accepts a boolean attestation, source answer or token decision.
 * Resolvers MUST read the protected Core state/registry/token births/journals on
 * each invocation and bind the response to the request they were given. */
export interface DuelPhaseClosureProtectedResolversV2 {
  readonly resolveCore: (locator: DuelPhaseClosureRequestLocatorV2) => DuelPhaseClosureCoreRequestV2 | null;
  readonly resolveRegistry: (request: DuelPhaseClosureCoreRequestV2) => DuelPhaseClosureRegistryResolutionV2 | null;
  readonly resolveToken: (request: DuelPhaseClosureCoreRequestV2) => DuelPhaseClosureTokenResolutionV2 | null;
  readonly resolveJournal: (
    request: DuelPhaseClosureCoreRequestV2,
    requirements: readonly DuelPhaseClosureRequirementV2[],
  ) => DuelPhaseClosureJournalResolutionV2 | null;
}
declare const authorityBrand: unique symbol;
declare const requestBrand: unique symbol;
export interface DuelPhaseClosureAuthorityV2 {
  readonly [authorityBrand]: true;
}
export interface DuelPhaseClosureRequestV2 {
  readonly [requestBrand]: true;
}
export interface DuelPhaseClosureEvidenceAssemblyV2 {
  readonly authority: DuelPhaseClosureAuthorityV2;
  readonly request: DuelPhaseClosureRequestV2;
}

interface AuthorityEntry {
  readonly resolvers: DuelPhaseClosureProtectedResolversV2;
  readonly proofBindings: Map<string, string>;
}
interface RequestEntry {
  readonly authority: DuelPhaseClosureAuthorityV2;
  readonly locator: DuelPhaseClosureRequestLocatorV2;
  readonly snapshot: DuelPhaseClosureCoreRequestV2;
}
const authorities = new WeakMap<object, AuthorityEntry>();
const requests = new WeakMap<object, RequestEntry>();
const PHASES: readonly string[] = [
  'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
  'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
];
const SUBEVENTS: readonly string[] = [
  'draw-subject', 'pre-exit', 'zone-transition', 'continuous', 'chain',
  'effect-queue', 'fepr-outstanding',
];
const BASE: readonly DuelPhaseClosureRequirementV2[] = [
  'all-source-candidate-closure', 'hidden-zone-event-subjects',
  'continuous-effect-registry', 'cleanup-queue-and-replacements',
  'runtime-subevent-journal', 'recursive-conquer-event-journal',
];
const SOURCE_KEYS: readonly string[] = [
  'scope', 'directBoundaryStatus', 'sourceApplicabilityStatus',
  'globalClosureStatus', 'event', 'mode', 'programId', 'reference',
  'handlers', 'modifiers', 'runtimeSubevents', 'eventRecognized',
  'sourceProgramComplete', 'requiredGlobalRuntimeClosure',
  'sourceCardId', 'sourceDataVersion', 'sourceCatalogDigest',
];
const REFERENCE_KEYS: readonly string[] = [
  'kind', 'schemaVersion', 'programId', 'cardId', 'dataVersion', 'sourceCatalogDigest',
];
const CONTEXT_KEYS: readonly string[] = [
  'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'phase', 'event', 'clock',
];
const CANDIDATE_KEYS: readonly string[] = [
  'uid', 'kind', 'cardId', 'zoneEpoch', 'controllerPlayerId', 'zone',
  'ownerPlayerId', 'locationId', 'attachedToUID', 'visibility', 'carrier',
];
const REQUEST_KEYS: readonly string[] = [
  'context', 'source', 'expectedProgramReference', 'referenceKind',
];
const TOKEN_KEYS: readonly string[] = [
  'request', 'uid', 'kind', 'birthEventId', 'sourceEffectId', 'sourceUID',
  'sourceZoneEpoch', 'sourceMode', 'sourceProofId', 'controllerPlayerId',
  'journalRevision', 'programReference', 'decision',
];
const GOLD_REFERENCE = JSON.stringify({
  intrinsicId: 'riftbound-duel-official-v1:intrinsic-token:gold-gear',
  kind: 'duel-intrinsic-token-ability-reference',
  ruleset: 'riftbound-duel-official-v1', schemaVersion: 1,
});

function unknown(reason: string): DuelPhaseSourceClosureProgramResultV2 {
  return { status: 'unknown', reason };
}
function ownData(value: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
}
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length >= keys.length && actual.length <= keys.length + optional.length &&
    keys.every(key => Object.hasOwn(value, key)) &&
    actual.every(key => typeof key === 'string' && (keys.includes(key) || optional.includes(key)) && ownData(value, key));
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function strings(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    if (!ownData(value, String(i)) || !text(value[i])) return false;
  }
  return true;
}
function zone(value: unknown): boolean {
  if (!record(value, ['kind', 'locationId']) && !record(value, ['kind', 'zonePlayerId'])) return false;
  if ('locationId' in value) {
    return (value.kind === 'board-base' || value.kind === 'board-battlefield') && text(value.locationId);
  }
  return (value.kind === 'legend-zone' || value.kind === 'champion-zone' ||
    value.kind === 'hand' || value.kind === 'main-deck' || value.kind === 'trash' ||
    value.kind === 'rune-deck' || value.kind === 'chain') && text(value.zonePlayerId);
}
function sameZone(first: unknown, second: unknown): boolean {
  if (!zone(first) || !zone(second)) return false;
  if (!record(first, ['kind', 'locationId']) && !record(first, ['kind', 'zonePlayerId'])) return false;
  if (!record(second, ['kind', 'locationId']) && !record(second, ['kind', 'zonePlayerId'])) return false;
  if (first.kind !== second.kind) return false;
  return 'locationId' in first
    ? 'locationId' in second && first.locationId === second.locationId
    : 'zonePlayerId' in second && first.zonePlayerId === second.zonePlayerId;
}
function validContext(value: unknown): value is DuelPhaseSourceClosureContextV2 {
  if (!record(value, CONTEXT_KEYS) || !record(value.clock, ['stateVersion', 'eventSeq'])) return false;
  return text(value.matchId) && text(value.dataVersion) && text(value.catalogDigest) &&
    count(value.turn) && text(value.taskId) && PHASES.includes(String(value.phase)) &&
    (value.event === value.phase || SUBEVENTS.includes(String(value.event))) &&
    (value.event !== 'draw-subject' || value.phase === 'draw') &&
    (value.event !== 'pre-exit' || value.phase === 'lethal-kill') &&
    (value.event !== 'fepr-outstanding' || value.phase === 'fepr') &&
    count(value.clock.stateVersion) && count(value.clock.eventSeq);
}
function sameContext(left: unknown, right: unknown): boolean {
  return validContext(left) && validContext(right) && left.matchId === right.matchId &&
    left.dataVersion === right.dataVersion && left.catalogDigest === right.catalogDigest &&
    left.turn === right.turn && left.taskId === right.taskId &&
    left.phase === right.phase && left.event === right.event &&
    left.clock.stateVersion === right.clock.stateVersion && left.clock.eventSeq === right.clock.eventSeq;
}
function validCandidate(value: unknown): value is DuelPhaseSourceClosureCandidateV2 {
  if (!record(value, CANDIDATE_KEYS, ['sourceUID', 'effectId', 'runtimeKind'])) return false;
  return text(value.uid) &&
    ['card', 'champion', 'legend', 'battlefield', 'unit', 'gear', 'rune', 'gold', 'effect'].includes(String(value.kind)) &&
    nullableText(value.cardId) && (value.zoneEpoch === null || count(value.zoneEpoch)) &&
    nullableText(value.controllerPlayerId) && zone(value.zone) &&
    nullableText(value.ownerPlayerId) && nullableText(value.locationId) &&
    nullableText(value.attachedToUID) && value.visibility === 'internal' &&
    (value.carrier === 'object' || value.carrier === 'pre-exit' || value.carrier === 'runtime-effect') &&
    (!Object.hasOwn(value, 'sourceUID') || text(value.sourceUID)) &&
    (!Object.hasOwn(value, 'effectId') || text(value.effectId)) &&
    (!Object.hasOwn(value, 'runtimeKind') ||
      ['continuous-effect', 'replacement-effect', 'triggered-effect', 'chain-effect', 'queued-effect', 'fepr-outstanding'].includes(String(value.runtimeKind))) &&
    (value.carrier === 'runtime-effect'
      ? value.kind === 'effect' && text(value.sourceUID) && text(value.effectId) && text(value.runtimeKind)
      : value.kind !== 'effect' && !Object.hasOwn(value, 'sourceUID') &&
        !Object.hasOwn(value, 'effectId') && !Object.hasOwn(value, 'runtimeKind'));
}
function sameCandidate(left: unknown, right: unknown): boolean {
  if (!validCandidate(left) || !validCandidate(right)) return false;
  return left.uid === right.uid && left.kind === right.kind && left.cardId === right.cardId &&
    left.zoneEpoch === right.zoneEpoch && left.controllerPlayerId === right.controllerPlayerId &&
    sameZone(left.zone, right.zone) && left.ownerPlayerId === right.ownerPlayerId &&
    left.locationId === right.locationId && left.attachedToUID === right.attachedToUID &&
    left.visibility === right.visibility && left.carrier === right.carrier &&
    left.sourceUID === right.sourceUID && left.effectId === right.effectId &&
    left.runtimeKind === right.runtimeKind;
}
function validRequest(value: unknown): value is DuelPhaseClosureCoreRequestV2 {
  return record(value, REQUEST_KEYS) && validContext(value.context) && validCandidate(value.source) &&
    text(value.expectedProgramReference) &&
    ['printing', 'gold-cr-intrinsic', 'recruit-birth'].includes(String(value.referenceKind)) &&
    (value.referenceKind !== 'printing' || value.source.cardId !== null);
}
function sameRequest(left: unknown, right: unknown): boolean {
  return validRequest(left) && validRequest(right) && sameContext(left.context, right.context) &&
    sameCandidate(left.source, right.source) &&
    left.expectedProgramReference === right.expectedProgramReference &&
    left.referenceKind === right.referenceKind;
}
function frozenRequest(value: DuelPhaseClosureCoreRequestV2): DuelPhaseClosureCoreRequestV2 {
  const c = value.context, s = value.source, z = s.zone;
  const copiedZone = 'locationId' in z
    ? { kind: z.kind, locationId: z.locationId }
    : { kind: z.kind, zonePlayerId: z.zonePlayerId };
  const base = {
    uid: s.uid, kind: s.kind, cardId: s.cardId, zoneEpoch: s.zoneEpoch,
    controllerPlayerId: s.controllerPlayerId, zone: Object.freeze(copiedZone),
    ownerPlayerId: s.ownerPlayerId, locationId: s.locationId,
    attachedToUID: s.attachedToUID, visibility: s.visibility, carrier: s.carrier,
  };
  const copiedSource: DuelPhaseSourceClosureCandidateV2 = s.carrier === 'runtime-effect'
    ? Object.freeze({
      uid: base.uid, kind: base.kind, cardId: base.cardId, zoneEpoch: base.zoneEpoch,
      controllerPlayerId: base.controllerPlayerId, zone: base.zone,
      ownerPlayerId: base.ownerPlayerId, locationId: base.locationId,
      attachedToUID: base.attachedToUID, visibility: base.visibility, carrier: s.carrier,
      sourceUID: s.sourceUID, effectId: s.effectId, runtimeKind: s.runtimeKind,
    })
    : Object.freeze({
      uid: base.uid, kind: base.kind, cardId: base.cardId, zoneEpoch: base.zoneEpoch,
      controllerPlayerId: base.controllerPlayerId, zone: base.zone,
      ownerPlayerId: base.ownerPlayerId, locationId: base.locationId,
      attachedToUID: base.attachedToUID, visibility: base.visibility, carrier: s.carrier,
    });
  return Object.freeze({
    context: Object.freeze({
      matchId: c.matchId, dataVersion: c.dataVersion, catalogDigest: c.catalogDigest,
      turn: c.turn, taskId: c.taskId, phase: c.phase, event: c.event,
      clock: Object.freeze({ stateVersion: c.clock.stateVersion, eventSeq: c.clock.eventSeq }),
    }),
    source: copiedSource,
    expectedProgramReference: value.expectedProgramReference, referenceKind: value.referenceKind,
  });
}
function canonicalReference(encoded: unknown, source: Record<string, unknown>, request: DuelPhaseClosureCoreRequestV2): boolean {
  if (!text(encoded) || !record(source.reference, REFERENCE_KEYS)) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { return false; }
  if (!record(parsed, REFERENCE_KEYS)) return false;
  const ref = source.reference;
  if (parsed.kind !== 'duel-official-program-reference' || parsed.schemaVersion !== 1 ||
      !text(parsed.cardId) || parsed.programId !== `riftbound-duel-official-v1:${parsed.cardId}` ||
      !text(parsed.dataVersion) || !text(parsed.sourceCatalogDigest) ||
      parsed.kind !== ref.kind || parsed.schemaVersion !== ref.schemaVersion ||
      parsed.programId !== ref.programId || parsed.cardId !== ref.cardId ||
      parsed.dataVersion !== ref.dataVersion || parsed.sourceCatalogDigest !== ref.sourceCatalogDigest ||
      parsed.cardId !== request.source.cardId || parsed.dataVersion !== request.context.dataVersion ||
      parsed.sourceCatalogDigest !== request.context.catalogDigest || source.programId !== parsed.programId ||
      source.sourceCardId !== parsed.cardId || source.sourceDataVersion !== parsed.dataVersion ||
      source.sourceCatalogDigest !== parsed.sourceCatalogDigest) return false;
  return encoded === JSON.stringify({
    cardId: parsed.cardId, dataVersion: parsed.dataVersion, kind: parsed.kind,
    programId: parsed.programId, schemaVersion: parsed.schemaVersion,
    sourceCatalogDigest: parsed.sourceCatalogDigest,
  });
}
function subevents(value: unknown): boolean {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    if (!ownData(value, String(i))) return false;
    const item: unknown = value[i];
    if (!record(item, ['event', 'handlers', 'modifiers']) || !text(item.event) ||
        !strings(item.handlers) || !strings(item.modifiers)) return false;
  }
  return true;
}
function requiredFor(phase: string, event: string): readonly DuelPhaseClosureRequirementV2[] {
  const extras: DuelPhaseClosureRequirementV2[] = [];
  if (phase === 'draw' || event === 'draw-subject') extras.push('draw-subject-journal');
  if (phase === 'lethal-kill' || event === 'pre-exit')
    extras.push('pre-exit-event-journal', 'kill-trigger-effect-cases');
  if (event === 'zone-transition') extras.push('zone-transition-journal');
  return BASE.concat(extras);
}
function requiredMatches(value: unknown, phase: string): boolean {
  if (!strings(value)) return false;
  const expected = requiredFor(phase, phase);
  const allowed = BASE.concat(['draw-subject-journal', 'pre-exit-event-journal',
    'kill-trigger-effect-cases', 'zone-transition-journal']);
  // Whole source programs may demand additional runtime evidence (e.g. Draw
  // subjects for a Spell). Extra recognized obligations strengthen closure.
  return expected.every(item => value.includes(item)) && value.every(item => allowed.includes(item as DuelPhaseClosureRequirementV2)) &&
    new Set(value).size === value.length;
}
function sourceLocalValid(value: unknown, request: DuelPhaseClosureCoreRequestV2, encoded: string): value is DuelPhaseClosureSourceLocalV2 {
  if (!record(value, SOURCE_KEYS, ['reason'])) return false;
  if (value.scope !== 'source-program' || value.globalClosureStatus !== 'unverified' ||
      value.event !== request.context.phase || value.eventRecognized !== true ||
      value.sourceProgramComplete !== true || Object.hasOwn(value, 'reason') ||
      (value.mode !== 'atomic-boundary' && value.mode !== 'runtime-subevents') ||
      !strings(value.handlers) || !strings(value.modifiers) || !subevents(value.runtimeSubevents) ||
      !text(value.event) || !requiredMatches(value.requiredGlobalRuntimeClosure, value.event)) return false;
  if (value.directBoundaryStatus !== 'known-no-handler' && value.directBoundaryStatus !== 'handlers-or-modifiers') return false;
  const hasDirect = value.handlers.length > 0 || value.modifiers.length > 0;
  if (hasDirect !== (value.directBoundaryStatus === 'handlers-or-modifiers')) return false;
  const applicable = hasDirect || (value.mode === 'runtime-subevents' &&
    Array.isArray(value.runtimeSubevents) && value.runtimeSubevents.length > 0);
  return value.sourceApplicabilityStatus === (applicable ? 'handlers-or-modifiers' : 'known-no-handler') &&
    canonicalReference(encoded, value, request);
}
function recruitReference(request: DuelPhaseClosureCoreRequestV2, token: Record<string, unknown>): string {
  return JSON.stringify({
    birthEventId: token.birthEventId, catalogDigest: request.context.catalogDigest,
    dataVersion: request.context.dataVersion, kind: 'recruit-birth-reference',
    matchId: request.context.matchId, schemaVersion: 1,
    sourceEffectId: token.sourceEffectId, sourceMode: token.sourceMode,
    sourceProofId: token.sourceProofId, sourceUID: token.sourceUID,
    sourceZoneEpoch: token.sourceZoneEpoch, tokenUID: token.uid,
  });
}
function tokenValid(value: unknown, request: DuelPhaseClosureCoreRequestV2): value is DuelPhaseClosureTokenResolutionV2 {
  if (!record(value, TOKEN_KEYS) || !sameRequest(value.request, request)) return false;
  const gold = request.referenceKind === 'gold-cr-intrinsic';
  if (request.source.cardId !== null || request.source.carrier !== 'object' ||
      (gold ? request.source.kind !== 'gold' || value.kind !== 'gold'
        : request.source.kind !== 'unit' || value.kind !== 'recruit')) return false;
  if (value.uid !== request.source.uid || value.controllerPlayerId !== request.source.controllerPlayerId ||
      !text(value.birthEventId) || !text(value.sourceEffectId) || !text(value.sourceUID) ||
      !count(value.sourceZoneEpoch) || !text(value.sourceProofId) || !count(value.journalRevision) ||
      (value.sourceMode !== 'current' && value.sourceMode !== 'pre-exit') ||
      (value.sourceMode === 'pre-exit' &&
        request.context.event !== 'pre-exit' && request.context.event !== 'zone-transition') ||
      (value.decision !== 'active' && value.decision !== 'inactive' && value.decision !== 'handler') ||
      !text(value.programReference) || value.programReference !== request.expectedProgramReference) return false;
  return gold ? value.programReference === GOLD_REFERENCE
    : value.programReference === recruitReference(request, value);
}
function journalValid(value: unknown, request: DuelPhaseClosureCoreRequestV2,
  required: readonly DuelPhaseClosureRequirementV2[]): value is DuelPhaseClosureJournalResolutionV2 {
  if (!record(value, ['request', 'proofId', 'journalRevision', 'candidateSetRevision', 'coverage']) ||
      !sameRequest(value.request, request) || !text(value.proofId) || !count(value.journalRevision) ||
      !count(value.candidateSetRevision)) return false;
  const coverage = value.coverage;
  if (!Array.isArray(coverage) || Object.getPrototypeOf(coverage) !== Array.prototype ||
      Reflect.ownKeys(coverage).length !== coverage.length + 1 || coverage.length > required.length) return false;
  const allowed: readonly string[] = required;
  const seen = new Set<string>();
  for (let i = 0; i < coverage.length; i++) {
    if (!ownData(coverage, String(i))) return false;
    const item: unknown = coverage[i];
    if (!record(item, ['requirement', 'journalRevision', 'proofId']) ||
        typeof item.requirement !== 'string' || !allowed.includes(item.requirement) ||
        seen.has(item.requirement) || item.journalRevision !== value.journalRevision ||
        !text(item.proofId)) return false;
    seen.add(item.requirement);
  }
  return true;
}
function missingRequirement(value: DuelPhaseClosureJournalResolutionV2,
  required: readonly DuelPhaseClosureRequirementV2[]): DuelPhaseClosureRequirementV2 | null {
  for (const name of required) {
    if (!value.coverage.some(item => item.requirement === name)) return name;
  }
  return null;
}

/** Register only protected Core/registry/journal resolvers; the returned object
 * contains no authority data and cannot survive clone, spread or JSON. */
export function createDuelPhaseClosureAuthorityV2(resolvers: DuelPhaseClosureProtectedResolversV2): DuelPhaseClosureAuthorityV2 {
  if (!record(resolvers, ['resolveCore', 'resolveRegistry', 'resolveToken', 'resolveJournal']) ||
      typeof resolvers.resolveCore !== 'function' || typeof resolvers.resolveRegistry !== 'function' ||
      typeof resolvers.resolveToken !== 'function' || typeof resolvers.resolveJournal !== 'function')
    throw new TypeError('protected Core/registry/token/journal resolvers required');
  const resolveCore = resolvers.resolveCore, resolveRegistry = resolvers.resolveRegistry;
  const resolveToken = resolvers.resolveToken, resolveJournal = resolvers.resolveJournal;
  const handle: DuelPhaseClosureAuthorityV2 = Object.freeze(Object.create(null));
  authorities.set(handle, {
    resolvers: { resolveCore, resolveRegistry, resolveToken, resolveJournal },
    proofBindings: new Map(),
  });
  return handle;
}

/** Issue a request from a protected Core lookup, never from a supplied candidate
 * or context. A changed Core snapshot makes this handle stale at assembly. */
export function issueDuelPhaseClosureRequestV2(
  authority: DuelPhaseClosureAuthorityV2, locator: DuelPhaseClosureRequestLocatorV2,
): DuelPhaseClosureRequestV2 | null {
  try {
    const entry = authorities.get(authority);
    if (!entry || !record(locator, ['matchId', 'taskId', 'uid']) ||
        !text(locator.matchId) || !text(locator.taskId) || !text(locator.uid)) return null;
    const protectedLocator = Object.freeze({ matchId: locator.matchId, taskId: locator.taskId, uid: locator.uid });
    const resolved: unknown = entry.resolvers.resolveCore(protectedLocator);
    if (!validRequest(resolved) || resolved.context.matchId !== protectedLocator.matchId ||
        resolved.context.taskId !== protectedLocator.taskId || resolved.source.uid !== protectedLocator.uid)
      return null;
    const handle: DuelPhaseClosureRequestV2 = Object.freeze(Object.create(null));
    requests.set(handle, { authority, locator: protectedLocator, snapshot: frozenRequest(resolved) });
    return handle;
  } catch { return null; }
}

/** Complete evidence exists only after fresh Core, registry/token and journal
 * queries. No caller-provided candidate, booleans, local answer or proof ID is
 * read. The output is a detached value, never a provider object. */
export function assembleDuelPhaseClosureEvidenceV2(args: DuelPhaseClosureEvidenceAssemblyV2): DuelPhaseSourceClosureProgramResultV2 {
  try {
    if (!record(args, ['authority', 'request'])) return unknown('invalid-assembly-input');
    const authority = authorities.get(args.authority);
    const issued = requests.get(args.request);
    if (!authority || !issued || issued.authority !== args.authority) return unknown('unbound-core-request');
    const refreshed: unknown = authority.resolvers.resolveCore(issued.locator);
    if (!sameRequest(refreshed, issued.snapshot)) return unknown('stale-or-foreign-core-request');
    const request = issued.snapshot;
    const source = request.source, c = request.context;
    // This producer has no independent runtime-effect program resolver. Refuse
    // its candidate rather than treating a printing lookup as that proof.
    if (source.carrier === 'runtime-effect' || source.kind === 'effect')
      return unknown('unsupported-runtime-effect-program');
    if (source.carrier === 'pre-exit' && c.event !== 'pre-exit' && c.event !== 'zone-transition')
      return unknown('unbound-pre-exit-candidate');
    let decision: 'active' | 'inactive' | 'handler';
    let sourceRequirements: readonly DuelPhaseClosureRequirementV2[] = [];
    let tokenRevision: number | null = null;
    if (request.referenceKind === 'printing') {
      const registry: unknown = authority.resolvers.resolveRegistry(request);
      if (!record(registry, ['request', 'encodedProgramReference', 'sourceLocal']) ||
          !sameRequest(registry.request, request) ||
          registry.encodedProgramReference !== request.expectedProgramReference ||
          !sourceLocalValid(registry.sourceLocal, request, request.expectedProgramReference))
        return unknown('unbound-source-local-program');
      const localDecision = registry.sourceLocal.directBoundaryStatus;
      sourceRequirements = registry.sourceLocal.requiredGlobalRuntimeClosure as readonly DuelPhaseClosureRequirementV2[];
      decision = localDecision === 'handlers-or-modifiers' ? 'handler' : 'inactive';
      // This verified modifier belongs to a Unit on the Board (CR 1.4 359.2.a / 365.1).
      // Its whole-program declaration remains known while the physical card is
      // in a private zone; it does not turn that card into an active source.
      if (registry.sourceLocal.handlers.length === 0 && registry.sourceLocal.modifiers.length === 1 &&
          registry.sourceLocal.modifiers[0] === 'continuous.token-unit-might') {
        const board = source.zone.kind === 'board-base' || source.zone.kind === 'board-battlefield';
        if (board && source.kind === 'unit') decision = 'active';
        else if (!board && source.carrier === 'object' &&
          ['hand', 'main-deck', 'trash', 'champion-zone', 'chain'].includes(source.zone.kind)) decision = 'inactive';
      }
    } else {
      const token: unknown = authority.resolvers.resolveToken(request);
      if (!tokenValid(token, request)) return unknown('unbound-token-intrinsic');
      decision = token.decision;
      tokenRevision = token.journalRevision;
    }
    const required = [...new Set([...requiredFor(c.phase, c.event), ...sourceRequirements])];
    const journal: unknown = authority.resolvers.resolveJournal(request, Object.freeze(required.slice()));
    if (!journalValid(journal, request, required)) return unknown('missing-or-foreign-global-attestation');
    const absent = missingRequirement(journal, required);
    if (absent !== null) return unknown(`missing-global-closure:${absent}`);
    if (tokenRevision !== null && journal.journalRevision !== tokenRevision)
      return unknown('stale-token-journal');
    const binding = JSON.stringify([
      c.matchId, c.dataVersion, c.catalogDigest, c.turn, c.taskId, c.phase, c.event,
      c.clock.stateVersion, c.clock.eventSeq,
      source.uid, source.kind, source.cardId, source.zoneEpoch, source.controllerPlayerId,
      source.zone.kind, 'locationId' in source.zone ? source.zone.locationId : source.zone.zonePlayerId,
      source.ownerPlayerId, source.locationId, source.attachedToUID,
      source.visibility, source.carrier, source.sourceUID ?? null, source.effectId ?? null,
      source.runtimeKind ?? null, request.referenceKind, request.expectedProgramReference,
      journal.journalRevision, journal.candidateSetRevision,
      journal.coverage.map(item => [item.requirement, item.journalRevision, item.proofId]).sort(),
    ]);
    const old = authority.proofBindings.get(journal.proofId);
    if (old !== undefined && old !== binding) return unknown('replayed-or-colliding-global-proof');
    const proofId = journal.proofId;
    authority.proofBindings.set(proofId, binding);
    return {
      status: 'complete', matchId: c.matchId, dataVersion: c.dataVersion,
      catalogDigest: c.catalogDigest, turn: c.turn, taskId: c.taskId,
      phase: c.phase, event: c.event,
      clock: { stateVersion: c.clock.stateVersion, eventSeq: c.clock.eventSeq },
      uid: source.uid, kind: source.kind, cardId: source.cardId,
      zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
      zone: 'locationId' in source.zone
        ? { kind: source.zone.kind, locationId: source.zone.locationId }
        : { kind: source.zone.kind, zonePlayerId: source.zone.zonePlayerId },
      programReference: request.expectedProgramReference, referenceKind: request.referenceKind,
      proofId, eventSupported: true, decision,
      coverage: {
        wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
        static: true, replacements: true, continuous: true, triggers: true,
      },
    };
  } catch {
    return unknown('invalid-assembly-input');
  }
}
