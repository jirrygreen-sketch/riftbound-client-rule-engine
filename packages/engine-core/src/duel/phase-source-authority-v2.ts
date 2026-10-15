// INTERNAL phase source gate. The caller of the factory MUST be a trusted, catalog-bound
// whole-program registry, not a network request or a client-provided card-text heuristic.
// Production registry/IR execution is not wired here: unsupported and unknown stay pending.
import { enumerateDuelObjectsV2, inspectDuelNativeTokenHistoryV2,
  type DuelCanonicalPlayingStateV2 } from './core-v2.js';
import type { DuelObjectView } from './permanent-state.js';

export type DuelPhaseEventV2 = 'awaken' | 'begin' | 'hold' | 'channel' | 'draw' | 'main' |
  'ending' | 'expiration' | 'fepr' | 'required-cleanup' | 'lethal-kill' | 'burnout';
export interface DuelPhaseSourceV2 {
  readonly uid: string;
  readonly kind: DuelObjectView['kind'];
  readonly cardId: string | null;
  readonly zoneEpoch: number | null;
  readonly controllerPlayerId: string | null;
  readonly zone: DuelObjectView['zone'];
}
export interface DuelPhaseSourceRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly turn: number;
  readonly taskId: string;
  readonly event: DuelPhaseEventV2;
  readonly source: DuelPhaseSourceV2;
  /** Trusted event-subject identity used for subject-scoped boundaries such as Hold. */
  readonly subjectUID?: string;
}
/** Full-program and event evidence MUST be independently verified by the trusted service.
 * `known-no-handler` is legal only for a fully known whole program AND an explicitly
 * supported event with all static, replacement, continuous and triggered scopes inspected.
 * A recognized IR enum event without constructor does not itself prove absence of effects. */
export type DuelPhaseProgramEvidenceV2 =
  | { readonly status: 'unknown' }
  | { readonly status: 'complete'; readonly matchId: string; readonly dataVersion: string;
      readonly catalogDigest: string; readonly turn: number; readonly taskId: string;
      readonly uid: string; readonly zoneEpoch: number | null; readonly controllerPlayerId: string | null;
      readonly cardId: string | null; readonly programReference: string;
      readonly event: DuelPhaseEventV2; readonly eventSupported: true;
      readonly scope: 'known-no-handler' | 'handlers-or-modifiers';
      readonly replacementsCovered: true; readonly staticCovered: true; readonly continuousCovered: true;
      readonly triggersCovered: true };
export type DuelPhaseSourceServiceV2 = (request: DuelPhaseSourceRequestV2) => DuelPhaseProgramEvidenceV2;
/** Explicitly opt-in source capability for a genuine Core-created token.  This is
 * deliberately separate from the printing index: a token has no physical card
 * printing and the callback must authenticate its Core birth/current carrier. */
export type DuelNativeTokenSourceServiceV2 = DuelPhaseSourceServiceV2;
export interface DuelPhaseRegistryV2 { readonly _duelPhaseRegistryV2: unique symbol }
/** An independent, protected catalog index: a callback must not pick its own printing reference
 * by interpolating the source cardId. In production the owner must authenticate this index and
 * its full-program contents against the catalog; this module does not supply that authority. */
export interface DuelPhaseProgramIndexV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly printings: readonly { readonly cardId: string; readonly programReference: string }[];
}
interface RegistryEntry { readonly service: DuelPhaseSourceServiceV2;
  readonly nativeTokenService?: DuelNativeTokenSourceServiceV2;
  readonly matchId: string; readonly dataVersion: string; readonly catalogDigest: string;
  readonly references: ReadonlyMap<string, string> }
const registries = new WeakMap<object, RegistryEntry>();
export function createDuelPhaseSourceRegistryV2(index: DuelPhaseProgramIndexV2,
  trustedService: DuelPhaseSourceServiceV2): DuelPhaseRegistryV2 {
  return createRegistry(index, trustedService);
}

/**
 * Named opt-in factory for nominal Core token source evidence.  The original
 * factory intentionally has no token capability and remains strict by default.
 */
export function createDuelPhaseSourceRegistryWithNativeTokenSourceV2(
  index: DuelPhaseProgramIndexV2,
  trustedService: DuelPhaseSourceServiceV2,
  nativeTokenService: DuelNativeTokenSourceServiceV2,
): DuelPhaseRegistryV2 {
  if (typeof nativeTokenService !== 'function') throw new TypeError('native token source service required');
  return createRegistry(index, trustedService, nativeTokenService);
}
/** Compatibility spelling kept explicit so callers cannot accidentally opt in through
 * the legacy factory. */
export const createDuelNativeTokenPhaseSourceRegistryV2 =
  createDuelPhaseSourceRegistryWithNativeTokenSourceV2;

function createRegistry(index: DuelPhaseProgramIndexV2,
  trustedService: DuelPhaseSourceServiceV2,
  nativeTokenService?: DuelNativeTokenSourceServiceV2): DuelPhaseRegistryV2 {
  if (typeof trustedService !== 'function' || !index || typeof index !== 'object' ||
      ![index.matchId, index.dataVersion, index.catalogDigest].every(value =>
        typeof value === 'string' && value.trim()) || !Array.isArray(index.printings))
    throw new TypeError('catalog-bound whole-program service required');
  const references = new Map<string, string>();
  for (const entry of index.printings) {
    if (!entry || typeof entry.cardId !== 'string' || !entry.cardId.trim() ||
        typeof entry.programReference !== 'string' || !entry.programReference.trim() ||
        references.has(entry.cardId)) throw new TypeError('unique printing program required');
    references.set(entry.cardId, entry.programReference);
  }
  const handle = Object.freeze(Object.create(null)) as DuelPhaseRegistryV2;
  registries.set(handle, { service: trustedService, nativeTokenService,
    matchId: index.matchId,
    dataVersion: index.dataVersion, catalogDigest: index.catalogDigest, references });
  return handle;
}
export interface DuelPhaseSourceInspectionV2 {
  readonly status: 'ready' | 'pending';
  readonly sources: readonly DuelPhaseSourceV2[];
  readonly handlers: readonly DuelPhaseSourceV2[];
  readonly reason?: string;
}
/** Compare the complete source identity used by a trusted native handler receipt. */
export function sameDuelPhaseSourceV2(a: DuelPhaseSourceV2, b: DuelPhaseSourceV2): boolean {
  return a.uid === b.uid && a.kind === b.kind && a.cardId === b.cardId &&
    a.zoneEpoch === b.zoneEpoch && a.controllerPlayerId === b.controllerPlayerId &&
    JSON.stringify(a.zone) === JSON.stringify(b.zone);
}
function sourceOf(view: DuelObjectView): DuelPhaseSourceV2 {
  return { uid: view.uid, kind: view.kind, cardId: view.cardId, zoneEpoch: view.zoneEpoch,
    controllerPlayerId: view.controllerPlayerId, zone: view.zone };
}
function current(match: DuelCanonicalPlayingStateV2): readonly DuelPhaseSourceV2[] {
  return enumerateDuelObjectsV2(match).filter(view =>
    (view.kind === 'unit' || view.kind === 'rune' || view.kind === 'gold' || view.kind === 'gear' ||
     view.kind === 'legend' || view.kind === 'battlefield') &&
    (view.kind === 'legend' ? view.zone.kind === 'legend-zone' :
      view.kind === 'battlefield' ? view.zone.kind === 'board-battlefield' :
        view.zone.kind === 'board-base' || view.zone.kind === 'board-battlefield'))
    .map(sourceOf);
}
function exactRecruitTags(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && Reflect.ownKeys(value).length === 2 &&
    value[0] === 'Recruit';
}
function genuineNativeToken(match: DuelCanonicalPlayingStateV2, source: DuelPhaseSourceV2): boolean {
  if (source.kind !== 'unit' || source.cardId !== null || source.zoneEpoch !== null ||
      (source.zone.kind !== 'board-base' && source.zone.kind !== 'board-battlefield') ||
      source.controllerPlayerId === null || Object.hasOwn(match.physicalCardsByUID, source.uid)) return false;
  const unit = match.board.units.find(item => item.objectId === source.uid);
  const trait = unit ? match.unitMeta[unit.objectId]?.trait : undefined;
  if (!unit || unit.controllerPlayerId !== source.controllerPlayerId ||
      unit.locationId !== source.zone.locationId || !trait || trait.kind !== 'token' ||
      trait.name !== 'Recruit' || trait.baseMight !== 1 ||
      !exactRecruitTags(trait.tags) || Reflect.ownKeys(trait).length !== 4) return false;
  try {
    const birth = inspectDuelNativeTokenHistoryV2(match).births.find(item =>
      item.kind === 'recruit' && item.tokenUID === source.uid);
    return !!birth && birth.controllerPlayerId === source.controllerPlayerId &&
      birth.effectControllerPlayerId === source.controllerPlayerId && birth.name === 'Recruit' &&
      birth.baseMight === 1 && exactRecruitTags(birth.tags) &&
      birth.sourceMode === 'current' && typeof birth.sourceProofId === 'string' &&
      birth.sourceProofId.trim().length > 0 && typeof birth.eventId === 'string' && birth.eventId.trim().length > 0;
  } catch { return false; }
}
function nativeTokenReference(match: DuelCanonicalPlayingStateV2, source: DuelPhaseSourceV2): string | null {
  if (!genuineNativeToken(match, source)) return null;
  try {
    const birth = inspectDuelNativeTokenHistoryV2(match).births.find(item =>
      item.kind === 'recruit' && item.tokenUID === source.uid);
    return birth ? JSON.stringify({ birthEventId: birth.eventId, catalogDigest: match.catalogDigest,
      dataVersion: match.dataVersion, kind: 'recruit-birth-reference', matchId: match.matchId,
      schemaVersion: 1, sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
      sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
      sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID }) : null;
  } catch { return null; }
}
/** Enumerate the COMPLETE live source set afresh on EACH boundary; never ask a provider to
 * supply a subset of UIDs or accept a stand-alone no-effect boolean. Callback throws fail shut. */
export function inspectDuelPhaseSourcesV2(match: DuelCanonicalPlayingStateV2, event: DuelPhaseEventV2,
  turn: number, taskId: string, registry: DuelPhaseRegistryV2, subjectUID?: string): DuelPhaseSourceInspectionV2 {
  const sources = current(match);
  const fail = (reason: string): DuelPhaseSourceInspectionV2 =>
    ({ status: 'pending', sources, handlers: [], reason });
  const entry = registry && typeof registry === 'object' ? registries.get(registry) : undefined;
  if (!entry || entry.matchId !== match.matchId || entry.dataVersion !== match.dataVersion ||
      entry.catalogDigest !== match.catalogDigest ||
      !Number.isSafeInteger(turn) || turn !== match.frame.turnNumber ||
      typeof taskId !== 'string' || !taskId || !taskId.includes(`turn-${turn}:`) ||
      (subjectUID !== undefined && (typeof subjectUID !== 'string' || !subjectUID.trim())) ||
      !['awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending', 'expiration', 'fepr',
        'required-cleanup', 'lethal-kill', 'burnout'].includes(event)) return fail('invalid-boundary');
  if (new Set(sources.map(s => s.uid)).size !== sources.length) return fail('duplicate-source');
  const handlers: DuelPhaseSourceV2[] = [];
  for (const source of sources) {
    if (source.cardId === null && !genuineNativeToken(match, source)) return fail('invalid-native-token-source');
    const expectedReference = source.cardId === null
      ? nativeTokenReference(match, source) : entry.references.get(source.cardId);
    if (expectedReference === undefined || expectedReference === null) return fail(
      source.cardId === null ? 'invalid-native-token-source' : 'missing-printing-program');
    let raw: DuelPhaseProgramEvidenceV2;
    try {
      const request: DuelPhaseSourceRequestV2 = { match, matchId: match.matchId,
        dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
        turn, taskId, event, source: Object.freeze({ ...source, zone: Object.freeze({ ...source.zone }) }),
        ...(subjectUID !== undefined ? { subjectUID } : {}) };
      Object.freeze(request);
      raw = source.cardId === null
        ? (entry.nativeTokenService ? entry.nativeTokenService(request) : { status: 'unknown' })
        : entry.service(request);
    } catch { return fail('source-service-error'); }
    if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype ||
        (raw.status !== 'complete' && raw.status !== 'unknown')) return fail('missing-program-evidence');
    if (raw.status !== 'complete') return fail('unknown-whole-program');
    const keys = ['status', 'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'uid',
      'zoneEpoch', 'controllerPlayerId', 'cardId', 'programReference', 'event', 'eventSupported',
      'scope', 'replacementsCovered', 'staticCovered', 'continuousCovered', 'triggersCovered'];
    if (Reflect.ownKeys(raw).length !== keys.length ||
        !keys.every(key => Object.hasOwn(raw, key) && 'value' in Object.getOwnPropertyDescriptor(raw, key)!) ||
        raw.matchId !== match.matchId || raw.dataVersion !== match.dataVersion ||
        raw.catalogDigest !== match.catalogDigest || raw.turn !== turn || raw.taskId !== taskId ||
        raw.uid !== source.uid || raw.zoneEpoch !== source.zoneEpoch ||
        raw.controllerPlayerId !== source.controllerPlayerId || raw.cardId !== source.cardId ||
        raw.event !== event || raw.eventSupported !== true || raw.replacementsCovered !== true ||
        raw.staticCovered !== true || raw.continuousCovered !== true || raw.triggersCovered !== true ||
        (expectedReference !== undefined && raw.programReference !== expectedReference) ||
        !['known-no-handler', 'handlers-or-modifiers'].includes(raw.scope)) return fail('foreign-or-incomplete-program');
    if (raw.scope === 'handlers-or-modifiers') handlers.push(source);
  }
  // The source service is intentionally not an effect executor. A handler needs an additional
  // phase-specific trusted resolution; the caller cannot silently treat it as no-effect.
  return { status: 'ready', sources, handlers };
}
