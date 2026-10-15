// Explicit Core V2 entry. V1 rooms, command sessions, public DTOs and archives retain their
// existing signatures and behavior. This is a trusted INTERNAL executor surface, not a
// client command or an automatically upgraded legacy snapshot.
import { createDuelMatch, resolveDuelMulligan, type DuelMatchMetadata, type DuelMatchSetupState } from './match-state.js';
import { allocateDuelPlayingV2Clock } from './canonical-transaction.js';
import { inspectDuelBaseCombatCompletion, type DuelBaseCombatCompleteAllocation } from './base-combat-allocation.js';
import { restoreDuelSetup, type DuelSetupSeat, type DuelSetupState } from './setup.js';
import {
  assertDuelPermanentState, restoreDuelPermanentState, initializeDuelPermanentState,
  advanceDuelPhysicalZoneTransitions, enumerateDuelObjects, attachDuelGear,
  followDuelAttachedHostMove, detachDuelGearsBeforeHostExit,
  referenceDuelPhysicalCard, assertCurrentDuelPhysicalReference,
  type DuelPermanentCandidate, type DuelPhysicalZone, type DuelPhysicalZoneTransition,
  type DuelPhysicalReference, type DuelObjectView, type TrustedDuelOriginalCard,
  type TrustedDuelPermanentInventory, type DuelGearAuthority,
} from './permanent-state.js';
import {
  channelDuelRunes, createDuelGoldToken as createDuelGoldTokenResource,
  activateDuelGoldPower as activateDuelGoldPowerResource,
  type DuelResourceTiming,
} from './resources.js';
import { placeDuelUnit, removeDuelUnit, relocateDuelUnit, type DuelBoard } from './battlefields.js';
import type { DuelCanonicalPlayingState } from './canonical-session.js';
import type { DuelUnitMeta } from './unit-lifecycle.js';

export interface DuelCreationProvenanceV2 {
  /** Created once from validated seats + trusted catalog, before any mulligan. NOT current zones. */
  readonly originalPhysicalCards: readonly TrustedDuelOriginalCard[];
  readonly submittedBattlefieldUIDs: readonly string[];
  /** Immutable genesis baseline after the initial four-card deal; retired BFs have no zone. */
  readonly initialZonesByUID: Readonly<Record<string, DuelPhysicalZone>>;
  /** Append-only ordered results of actual trusted transfers (not a before/after diff). */
  readonly transitions: readonly DuelPhysicalZoneTransition[];
}
/**
 * Independent creation/history source for archive restore.  This is intentionally a data
 * contract, not a MAC or a claim that arbitrary JSON authenticated itself: an archive caller
 * must obtain it from this factory capability or a separately validated creation journal.
 * It repeats creation metadata so the source is bound to the inventory and the match/catalog.
 */
export interface DuelRestoreAttestationV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly rosterPlayerIds: readonly [string, string];
  readonly originalPhysicalCards: readonly TrustedDuelOriginalCard[];
  readonly submittedBattlefieldUIDs: readonly string[];
  readonly retiredPhysicalUIDs: readonly string[];
  readonly initialZonesByUID: Readonly<Record<string, DuelPhysicalZone>>;
  readonly transitions: readonly DuelPhysicalZoneTransition[];
}
/** Alias used by callers that obtain the protected source context from a validated journal. */
export type DuelProtectedCreationHistoryV2 = DuelRestoreAttestationV2;
export type DuelRestoreSourceContextV2 = DuelRestoreAttestationV2;
export type DuelMatchSetupStateV2 = Omit<DuelMatchSetupState, 'schemaVersion'> & {
  readonly schemaVersion: 2;
  readonly provenance: DuelCreationProvenanceV2;
};
export type DuelCanonicalPlayingStateV2 = Omit<DuelPermanentCandidate, 'schemaVersion'> & {
  readonly schemaVersion: 2;
  readonly provenance: DuelCreationProvenanceV2;
  /** Opt-in V3 only. Pending Recruit identities are canonical Chain objects, never physical cards. */
  readonly tokenChain?: readonly DuelCanonicalRecruitTokenChainEntryV3[];
};
export type DuelMatchStateV2 = DuelMatchSetupStateV2 | DuelCanonicalPlayingStateV2;
export type DuelCatalogCardTypeV2 = TrustedDuelOriginalCard['cardType'];
/** Must resolve against a trusted catalog bound to metadata.dataVersion/catalogDigest. */
export type DuelTrustedCardTypeResolverV2 = (cardId: string) => DuelCatalogCardTypeV2;

/** Canonical identity for a Recruit before its paid entry birth. It intentionally has no
 * cardId and no physical zone epoch: this is a native token carrier, not a printing. */
export interface DuelCanonicalRecruitTokenChainEntryV3 {
  readonly kind: 'recruit';
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: DuelTokenSourceModeV2;
  readonly sourceProofId: string;
  readonly effectControllerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly ownerPlayerId: string;
  readonly locationId: string;
  readonly readied: false;
  readonly name: 'Recruit';
  readonly baseMight: 1;
  readonly tags: readonly ['Recruit'];
  readonly zoneEpoch: null;
  readonly birthStateVersion: number;
}

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new TypeError(`Duel Core V2: ${label}`);
}
function record(raw: unknown, keys: readonly string[], label: string,
  optional: readonly string[] = []): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label} record`);
  check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null, `${label} prototype`);
  const actual = Reflect.ownKeys(raw);
  check(actual.length >= keys.length && actual.length <= keys.length + optional.length &&
    keys.every(k => actual.includes(k)) &&
    actual.every(k => typeof k === 'string' && [...keys, ...optional].includes(k) &&
      'value' in Object.getOwnPropertyDescriptor(raw, k)!),
  `${label} keys/accessors`);
  return raw as Record<string, unknown>;
}
function list(raw: unknown, label: string): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, `${label} array`);
  check(Reflect.ownKeys(raw).length === raw.length + 1 &&
    Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
      .every(d => d !== undefined && 'value' in d), `${label} sparse/extra/accessor`);
  return raw;
}
function id(raw: unknown, label: string): string {
  check(typeof raw === 'string' && raw.trim().length > 0, `${label} ID`);
  return raw;
}
function zone(raw: unknown, ids: readonly string[], board: DuelBoard | null, label: string): DuelPhysicalZone {
  const r = record(raw, 'locationId' in Object(raw) ? ['kind', 'locationId'] : ['kind', 'zonePlayerId'], label);
  if (r.kind === 'board-base' || r.kind === 'board-battlefield') {
    const locationId = id(r.locationId, `${label}.locationId`);
    if (board) check((r.kind === 'board-base' ? board.bases : board.battlefields)
      .some(b => b.locationId === locationId), `${label} unknown board location`);
    return { kind: r.kind, locationId };
  }
  check(r.kind === 'legend-zone' || r.kind === 'champion-zone' || r.kind === 'hand' ||
    r.kind === 'main-deck' || r.kind === 'trash' || r.kind === 'rune-deck' || r.kind === 'chain', `${label} zone kind`);
  const zonePlayerId = id(r.zonePlayerId, `${label}.zonePlayerId`);
  check(ids.includes(zonePlayerId), `${label} unknown player`);
  return { kind: r.kind, zonePlayerId };
}
const z = (kind: 'hand' | 'main-deck' | 'rune-deck' | 'champion-zone' | 'legend-zone' | 'trash' | 'chain',
  zonePlayerId: string): DuelPhysicalZone => ({ kind, zonePlayerId });
const baseZone = (locationId: string): DuelPhysicalZone => ({ kind: 'board-base', locationId });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const zoneKey = (value: DuelPhysicalZone): string => 'locationId' in value
  ? JSON.stringify([value.kind, value.locationId]) : JSON.stringify([value.kind, value.zonePlayerId]);
const nonboard = (value: DuelPhysicalZone): boolean => value.kind !== 'board-base' &&
  value.kind !== 'board-battlefield' && value.kind !== 'legend-zone';
function freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) freeze(descriptor.value, seen);
  }
  Object.freeze(value);
}

// In-memory capability is issued ONLY by constructor/validated restore and carried forward on
// commit. The persisted provenance is auditable data, not proof of its own integrity: S2 must
// supply independently authenticated creation + ordered history on archive restore.
export type DuelTokenKindV2 = 'gold' | 'recruit';
export type DuelTokenSourceModeV2 = 'current' | 'pre-exit';

/**
 * The source tuple is deliberately richer than a current carrier lookup.  A production source
 * attestor must bind the effect, event, source UID/epoch and creating controller to one resolved
 * ability; the core never manufactures this tuple and never treats a client object as proof.
 */
export interface DuelTokenCreationRequestV2 {
  readonly kind: DuelTokenKindV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: DuelTokenSourceModeV2;
  readonly effectControllerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  /** Explicit settled entry result. Gold is commonly false for the official intrinsic. */
  readonly readied: boolean;
  readonly name?: string;
  readonly baseMight?: number;
  readonly tags?: readonly string[];
}
export interface DuelTokenSourceAttestationV2 extends DuelTokenCreationRequestV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly sourceProofId: string;
}
export interface DuelTokenSourceAttestorRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly request: DuelTokenCreationRequestV2;
}
export type DuelTokenSourceAttestorV2 =
  (request: DuelTokenSourceAttestorRequestV2) => DuelTokenSourceAttestationV2;

/**
 * Private, ordered token birth/retirement journal. It is separate from physical-card history.
 * Birth data proves neither later readiness nor energy/power balances, and this structure is
 * NOT complete archive-state authenticity. Restore callers must independently authenticate
 * the whole snapshot or replay a protected state/effect journal before admitting it.
 */
export interface DuelTokenBirthJournalEntryV2 extends DuelTokenSourceAttestationV2 {
  readonly createdAtStateVersion: number;
}
export interface DuelTokenRetirementJournalEntryV2 {
  readonly kind: DuelTokenKindV2;
  readonly tokenUID: string;
  readonly ownerPlayerId: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly reason: 'consume-gold' | 'kill-recruit';
  readonly retiredAtStateVersion: number;
}
export interface DuelTokenLifecycleHistoryV2 {
  readonly births: readonly DuelTokenBirthJournalEntryV2[];
  readonly retirements: readonly DuelTokenRetirementJournalEntryV2[];
}
/** Independently sourced token history; not a proof of the whole snapshot's later state. Missing token input fails closed. */
export type DuelTokenLifecycleRestoreAttestationV2 = DuelTokenLifecycleHistoryV2;

/** One-use in-memory authority. JSON/structuredClone copies intentionally do not carry it. */
export interface DuelTokenCreationAuthorityV2 {
  readonly _duelTokenCreationAuthorityV2: unique symbol;
}

type DuelLiveAuthorityV2 = {
  readonly inventory: TrustedDuelPermanentInventory;
  readonly history: DuelRestoreAttestationV2;
  readonly tokenHistory: DuelTokenLifecycleHistoryV2;
  readonly origin: object;
  readonly parent: DuelMatchStateV2 | null;
};
const live = new WeakMap<object, DuelLiveAuthorityV2>();
// Factory inventories are privately owned. Restore retains a caller's trusted
// inventory, which may be mutable and must still be checked on every read.
const immutableObjectViewOriginsV2 = new WeakSet<object>();
const tokenAuthorities = new WeakMap<object, {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly attestation: DuelTokenSourceAttestationV2;
  used: boolean;
}>();
/** A Chain-born Recruit is process-local until Finalize. It is not a physical card or a board birth. */
export interface DuelRecruitTokenChainReservationV2 {
  readonly _duelRecruitTokenChainReservationV2: unique symbol;
}
type RecruitChainEntryV2 = {
  readonly head: DuelCanonicalPlayingStateV2;
  readonly request: DuelTokenCreationRequestV2;
  readonly attestation: DuelTokenSourceAttestationV2;
  readonly origin: object;
  busy: boolean;
  used: boolean;
  cancelled: boolean;
  poisoned: boolean;
};
type RecruitChainClaimV2 = {
  readonly request: DuelTokenCreationRequestV2;
  poisoned: boolean;
};
const recruitChainEntries = new WeakMap<object, RecruitChainEntryV2>();
const recruitChainByOrigin = new WeakMap<object, Set<RecruitChainEntryV2>>();
const recruitChainClaims = new WeakMap<object, Set<RecruitChainClaimV2>>();
// V3 native Chain reservations share the origin index with legacy birth guards. The map is
// declared beside V2 so old create/begin APIs cannot regenerate a V3 tuple from a sibling head.
const recruitChainEntriesV3 = new WeakMap<object, RecruitChainEntryV3>();
const recruitChainByOriginV3 = new WeakMap<object, Set<RecruitChainEntryV3>>();
const recruitChainClaimsV3 = new WeakMap<object, Set<RecruitChainClaimV3>>();
const printedUnitChainBirths = new WeakMap<object, Set<string>>();
const printedUnitChainClaims = new WeakMap<object, Map<string, { poisoned: boolean }>>();
// Non-Unit Gear uses a separate native tombstone namespace.  A Gear Chain
// round must never be consumable by the Unit bridge (or by a copied/sibling
// coordinator), even when the physical UID and epoch happen to match.
const printedGearChainBirths = new WeakMap<object, Set<string>>();
const printedGearChainClaims = new WeakMap<object, Map<string, { poisoned: boolean }>>();
const physicalChainRoundKey = (uid: string, sourceEpoch: number): string =>
  JSON.stringify([uid, sourceEpoch]);
function emptyTokenHistory(): DuelTokenLifecycleHistoryV2 {
  return { births: [], retirements: [] };
}
function admitted<T extends DuelMatchStateV2>(state: T, inventory: TrustedDuelPermanentInventory,
  history: DuelRestoreAttestationV2, tokenHistory: DuelTokenLifecycleHistoryV2 = emptyTokenHistory(),
  parent: DuelMatchStateV2 | null = null): T {
  freeze(state);
  freeze(history);
  freeze(tokenHistory);
  const parentAuthority = parent === null ? undefined : live.get(parent);
  check(parent === null || parentAuthority !== undefined, 'native commit requires an admitted parent');
  live.set(state, { inventory, history, tokenHistory,
    origin: parentAuthority?.origin ?? Object.freeze(Object.create(null)), parent });
  return state;
}

/** Private native commit evidence. State identities remain process-local capabilities. */
export interface DuelNativeCommitV2 {
  readonly before: DuelMatchStateV2;
  readonly after: DuelMatchStateV2;
  readonly transitions: readonly DuelPhysicalZoneTransition[];
  readonly tokenBirths: readonly DuelTokenBirthJournalEntryV2[];
  readonly tokenRetirements: readonly DuelTokenRetirementJournalEntryV2[];
}

/** Walk only actual Core commits. Equal metadata, JSON and independently restored roots do not join a branch. */
export function inspectDuelNativeCommitPathV2(ancestor: DuelMatchStateV2,
  descendant: DuelMatchStateV2): readonly DuelNativeCommitV2[] {
  assertAdmittedDuelMatchV2(ancestor);
  assertAdmittedDuelMatchV2(descendant);
  if (ancestor.stage === 'playing') validateCanonicalRecruitTokenChainV3(ancestor);
  if (descendant.stage === 'playing') validateCanonicalRecruitTokenChainV3(descendant);
  check(live.get(ancestor)!.origin === live.get(descendant)!.origin, 'foreign native commit origin');
  const backwards: DuelNativeCommitV2[] = [];
  let cursor = descendant;
  while (cursor !== ancestor) {
    const current = live.get(cursor)!;
    const before = current.parent;
    check(before !== null, 'state is not a native descendant');
    const prior = live.get(before)!;
    if (before.stage === 'playing') validateCanonicalRecruitTokenChainV3(before);
    if (cursor.stage === 'playing') validateCanonicalRecruitTokenChainV3(cursor);
    check(cursor.stateVersion === before.stateVersion + 1 && cursor.eventSeq === before.eventSeq + 1,
      'native commit clock mismatch');
    const priorTrace = before.provenance.transitions;
    const trace = cursor.provenance.transitions;
    check(trace.length >= priorTrace.length && priorTrace.every((item, index) => same(item, trace[index])),
      'native commit trace prefix mismatch');
    check(current.tokenHistory.births.length >= prior.tokenHistory.births.length &&
      current.tokenHistory.retirements.length >= prior.tokenHistory.retirements.length,
      'native token history mismatch');
    backwards.push(Object.freeze({ before, after: cursor,
      transitions: Object.freeze(trace.slice(priorTrace.length)),
      tokenBirths: Object.freeze(current.tokenHistory.births.slice(prior.tokenHistory.births.length)),
      tokenRetirements: Object.freeze(current.tokenHistory.retirements.slice(prior.tokenHistory.retirements.length)) }));
    cursor = before;
  }
  return Object.freeze(backwards.reverse());
}

/** Reads the independently admitted token history, never history claimed by a candidate DTO. */
export function inspectDuelNativeTokenHistoryV2(state: DuelMatchStateV2): DuelTokenLifecycleHistoryV2 {
  assertAdmittedDuelMatchV2(state);
  return live.get(state)!.tokenHistory;
}

/** Read-only native Chain carrier. Legacy V2 states deliberately return an empty view without
 * acquiring a new optional field. The returned entries are canonical state data, not printings. */
export function inspectDuelCanonicalRecruitTokenChainV3(state: DuelCanonicalPlayingStateV2):
  readonly DuelCanonicalRecruitTokenChainEntryV3[] {
  capability(state);
  validateCanonicalRecruitTokenChainV3(state);
  const entries = Object.hasOwn(state, 'tokenChain') ? state.tokenChain : undefined;
  check(entries === undefined || Array.isArray(entries), 'V3 tokenChain array');
  return Object.freeze((entries ?? []).map(entry => Object.freeze({ ...entry,
    tags: Object.freeze([...entry.tags]) })));
}

function validateCanonicalRecruitTokenChainV3(state: DuelCanonicalPlayingStateV2,
  maxBirthStateVersion = state.stateVersion): void {
  if (!Object.hasOwn(state, 'tokenChain')) return;
  check(maxBirthStateVersion === state.stateVersion ||
    maxBirthStateVersion === state.stateVersion + 1, 'V3 tokenChain clock bound');
  const entries = state.tokenChain;
  check(Array.isArray(entries), 'V3 tokenChain array');
  const uids = new Set<string>(), effects = new Set<string>(), events = new Set<string>();
  for (const entry of entries) {
    check(entry !== null && typeof entry === 'object', 'V3 tokenChain entry');
    check(entry.kind === 'recruit' && entry.name === 'Recruit' && entry.baseMight === 1 &&
      entry.readied === false && entry.zoneEpoch === null && Array.isArray(entry.tags) &&
      entry.tags.length === 1 && entry.tags[0] === 'Recruit', 'V3 canonical Recruit identity');
    for (const [label, value] of Object.entries({ tokenUID: entry.tokenUID,
      sourceEffectId: entry.sourceEffectId, eventId: entry.eventId, sourceUID: entry.sourceUID,
      sourceProofId: entry.sourceProofId, effectControllerPlayerId: entry.effectControllerPlayerId,
      controllerPlayerId: entry.controllerPlayerId, ownerPlayerId: entry.ownerPlayerId,
      locationId: entry.locationId })) id(value, `V3 tokenChain.${label}`);
    check(Number.isSafeInteger(entry.sourceZoneEpoch) && entry.sourceZoneEpoch >= 0 &&
      Number.isSafeInteger(entry.birthStateVersion) && entry.birthStateVersion > 0 &&
      entry.birthStateVersion <= maxBirthStateVersion, 'V3 tokenChain clocks');
    check(entry.sourceMode === 'current' || entry.sourceMode === 'pre-exit', 'V3 tokenChain source mode');
    check(entry.effectControllerPlayerId === entry.controllerPlayerId &&
      entry.ownerPlayerId === entry.controllerPlayerId, 'V3 tokenChain owner/controller');
    check(state.roster.some(seat => seat.playerId === entry.controllerPlayerId),
      'V3 tokenChain controller seat');
    check(!uids.has(entry.tokenUID) && !effects.has(entry.sourceEffectId) && !events.has(entry.eventId),
      'duplicate V3 tokenChain identity');
    uids.add(entry.tokenUID); effects.add(entry.sourceEffectId); events.add(entry.eventId);
    check(!Object.hasOwn(state.physicalCardsByUID, entry.tokenUID) &&
      !state.retiredPhysicalUIDs.includes(entry.tokenUID) &&
      !state.board.units.some(unit => unit.objectId === entry.tokenUID),
      'V3 tokenChain UID is already a board/physical token');
    check(!state.tokenChain!.some(other => other !== entry &&
      (other.tokenUID === entry.tokenUID || other.sourceEffectId === entry.sourceEffectId ||
        other.eventId === entry.eventId)), 'V3 tokenChain duplicate identity');
  }
}
/** Read-only admission check for consumers of a V2 authority (e.g. the public projector).
 * A schema label or copied provenance is not a capability. Do not expose the private inventory. */
export function assertAdmittedDuelMatchV2(raw: unknown): asserts raw is DuelMatchStateV2 {
  check(raw !== null && typeof raw === 'object', 'V2 match object required');
  // Check membership before reading any properties of an untrusted candidate.
  check(live.has(raw), 'untrusted V2 state; an archive requires external creation/history attestation');
  const state = raw as DuelMatchStateV2;
  check(state.schemaVersion === 2 && (state.stage === 'setup' || state.stage === 'playing'),
    'V2 schema/stage required');
}
/** Process-local native factory identity for executor reservations. Same-origin
 * siblings share it; a fresh deterministic replay gets its own actual origin.
 * The opaque identity carries no state and cannot be restored from DATA. */
export function inspectDuelNativeOriginV2(state: DuelMatchStateV2): object {
  return capability(state).origin;
}

function capability(state: DuelMatchStateV2): DuelLiveAuthorityV2 {
  const authority = live.get(state);
  check(authority, 'untrusted V2 state; an archive requires external creation/history attestation');
  return authority;
}
function authority(state: DuelMatchStateV2): TrustedDuelPermanentInventory {
  return capability(state).inventory;
}
function safeCount(raw: unknown, label: string): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, `${label} safe integer`);
  return raw;
}
function tokenRequest(raw: unknown, label: string): DuelTokenCreationRequestV2 {
  const r = record(raw, ['kind', 'tokenUID', 'sourceEffectId', 'eventId', 'sourceUID',
    'sourceZoneEpoch', 'sourceMode', 'effectControllerPlayerId', 'controllerPlayerId',
    'locationId', 'readied'], 'token request', ['name', 'baseMight', 'tags']);
  check(r.kind === 'gold' || r.kind === 'recruit', `${label}.kind`);
  const kind = r.kind as DuelTokenKindV2;
  const tokenUID = id(r.tokenUID, `${label}.tokenUID`);
  const sourceEffectId = id(r.sourceEffectId, `${label}.sourceEffectId`);
  const eventId = id(r.eventId, `${label}.eventId`);
  const sourceUID = id(r.sourceUID, `${label}.sourceUID`);
  const sourceZoneEpoch = safeCount(r.sourceZoneEpoch, `${label}.sourceZoneEpoch`);
  check(r.sourceMode === 'current' || r.sourceMode === 'pre-exit', `${label}.sourceMode`);
  const effectControllerPlayerId = id(r.effectControllerPlayerId, `${label}.effectControllerPlayerId`);
  const controllerPlayerId = id(r.controllerPlayerId, `${label}.controllerPlayerId`);
  const locationId = id(r.locationId, `${label}.locationId`);
  check(typeof r.readied === 'boolean', `${label}.readied`);
  const names = Object.hasOwn(r, 'name'), might = Object.hasOwn(r, 'baseMight'), tags = Object.hasOwn(r, 'tags');
  if (kind === 'gold') {
    check(!names && !might && !tags, `${label} Gold cannot carry Unit fields`);
    return { kind, tokenUID, sourceEffectId, eventId, sourceUID, sourceZoneEpoch,
      sourceMode: r.sourceMode, effectControllerPlayerId, controllerPlayerId, locationId,
      readied: r.readied };
  }
  check(names && might && tags, `${label} Recruit requires name/baseMight/tags`);
  // CR 187.1: these are the Recruit's intrinsic traits. An effect's +Might/tag changes
  // belong to derived layers, not to the token's birth/base trait.
  check(r.name === 'Recruit', `${label}.name must be Recruit`);
  check(safeCount(r.baseMight, `${label}.baseMight`) === 1, `${label}.baseMight must be 1`);
  const rawTags = list(r.tags, `${label}.tags`).map((value, i) => id(value, `${label}.tags[${i}]`));
  check(rawTags.length === 1 && rawTags[0] === 'Recruit', `${label}.tags must be Recruit`);
  return { kind, tokenUID, sourceEffectId, eventId, sourceUID, sourceZoneEpoch,
    sourceMode: r.sourceMode, effectControllerPlayerId, controllerPlayerId, locationId,
    readied: r.readied, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
}
function tokenAttestation(raw: unknown, state: DuelCanonicalPlayingStateV2,
  request: DuelTokenCreationRequestV2): DuelTokenSourceAttestationV2 {
  const optional = request.kind === 'recruit' ? ['name', 'baseMight', 'tags'] as const : [] as const;
  const fields = ['matchId', 'dataVersion', 'catalogDigest', 'sourceProofId',
    'kind', 'tokenUID', 'sourceEffectId', 'eventId', 'sourceUID', 'sourceZoneEpoch',
    'sourceMode', 'effectControllerPlayerId', 'controllerPlayerId', 'locationId', 'readied', ...optional];
  const r = record(raw, fields, 'token source attestation');
  const returned: Record<string, unknown> = {
    kind: r.kind, tokenUID: r.tokenUID, sourceEffectId: r.sourceEffectId, eventId: r.eventId,
    sourceUID: r.sourceUID, sourceZoneEpoch: r.sourceZoneEpoch, sourceMode: r.sourceMode,
    effectControllerPlayerId: r.effectControllerPlayerId, controllerPlayerId: r.controllerPlayerId,
    locationId: r.locationId, readied: r.readied,
  };
  for (const key of optional) returned[key] = r[key];
  const parsed = tokenRequest(returned, 'token attestation');
  check(same(parsed, request), 'source attestation differs from requested effect tuple');
  check(id(r.matchId, 'token attestation.matchId') === state.matchId &&
    id(r.dataVersion, 'token attestation.dataVersion') === state.dataVersion &&
    id(r.catalogDigest, 'token attestation.catalogDigest') === state.catalogDigest,
  'token attestation match/catalog binding');
  const sourceProofId = id(r.sourceProofId, 'token attestation.sourceProofId');
  check(state.roster.some(seat => seat.playerId === parsed.effectControllerPlayerId) &&
    state.roster.some(seat => seat.playerId === parsed.controllerPlayerId),
  'token controller is not a match seat');
  check(parsed.effectControllerPlayerId === parsed.controllerPlayerId,
    'token owner must be the creating-effect controller');
  if (parsed.sourceMode === 'current') {
    assertCurrentDuelPhysicalReferenceV2(state,
      { uid: parsed.sourceUID, zoneEpoch: parsed.sourceZoneEpoch });
  } else {
    // The pre-exit branch is intentionally not current-object validation.  The attestor is the
    // independent event-journal boundary and must have supplied this mode and epoch itself.
    check(parsed.sourceZoneEpoch >= 0, 'pre-exit source epoch');
  }
  return { ...parsed, matchId: state.matchId, dataVersion: state.dataVersion,
    catalogDigest: state.catalogDigest, sourceProofId };
}
function attestTokenSource(state: DuelCanonicalPlayingStateV2, request: DuelTokenCreationRequestV2,
  attestor: DuelTokenSourceAttestorV2): { readonly attestation: DuelTokenSourceAttestationV2;
    readonly authority: DuelTokenCreationAuthorityV2 } {
  check(typeof attestor === 'function', 'independent token source attestor required');
  const argument = Object.freeze({ match: state, request: Object.freeze({ ...request,
    ...(request.kind === 'recruit' ? { tags: [...request.tags!] } : {}) }) });
  const attestation = tokenAttestation(attestor(argument), state, request);
  freeze(attestation);
  // The source tuple itself is serializable evidence; this capability is not.  It is consumed
  // only after the enclosing mutation commits, so a failed mutation remains atomic.
  const authority = Object.freeze(Object.create(null)) as DuelTokenCreationAuthorityV2;
  tokenAuthorities.set(authority, { state, attestation, used: false });
  return { attestation, authority };
}
function checkedTokenHistory(raw: unknown, state: DuelCanonicalPlayingStateV2,
  proof: TrustedDuelPermanentInventory): DuelTokenLifecycleHistoryV2 {
  const root = record(raw, ['births', 'retirements'], 'independent token lifecycle attestation');
  const births = list(root.births, 'token birth history').map((value, i) => {
    const unknown = record(value, ['createdAtStateVersion', 'matchId', 'dataVersion',
      'catalogDigest', 'sourceProofId', 'kind', 'tokenUID', 'sourceEffectId', 'eventId',
      'sourceUID', 'sourceZoneEpoch', 'sourceMode', 'effectControllerPlayerId',
      'controllerPlayerId', 'locationId', 'readied'], 'token birth entry', ['name', 'baseMight', 'tags']);
    const requestKeys = ['kind', 'tokenUID', 'sourceEffectId', 'eventId', 'sourceUID',
      'sourceZoneEpoch', 'sourceMode', 'effectControllerPlayerId', 'controllerPlayerId',
      'locationId', 'readied', ...(Object.hasOwn(unknown, 'name') ? ['name'] : []),
      ...(Object.hasOwn(unknown, 'baseMight') ? ['baseMight'] : []),
      ...(Object.hasOwn(unknown, 'tags') ? ['tags'] : [])];
    const request = tokenRequest(Object.fromEntries(requestKeys.map(key => [key, unknown[key]])),
      `token birth history[${i}]`);
    const createdAtStateVersion = safeCount(unknown.createdAtStateVersion,
      `token birth history[${i}].createdAtStateVersion`);
    check(createdAtStateVersion <= state.stateVersion, `token birth history[${i}] is from the future`);
    check(id(unknown.matchId, `token birth history[${i}].matchId`) === state.matchId &&
      id(unknown.dataVersion, `token birth history[${i}].dataVersion`) === state.dataVersion &&
      id(unknown.catalogDigest, `token birth history[${i}].catalogDigest`) === state.catalogDigest,
    `token birth history[${i}] match/catalog binding`);
    return { ...request, matchId: state.matchId, dataVersion: state.dataVersion,
      catalogDigest: state.catalogDigest,
      sourceProofId: id(unknown.sourceProofId, `token birth history[${i}].sourceProofId`),
      createdAtStateVersion };
  }) as DuelTokenBirthJournalEntryV2[];
  const retirements = list(root.retirements, 'token retirement history').map((value, i) => {
    const r = record(value, ['kind', 'tokenUID', 'ownerPlayerId', 'sourceEffectId', 'eventId',
      'reason', 'retiredAtStateVersion'], `token retirement history[${i}]`);
    check(r.kind === 'gold' || r.kind === 'recruit', `token retirement history[${i}].kind`);
    check(r.reason === 'consume-gold' || r.reason === 'kill-recruit',
      `token retirement history[${i}].reason`);
    const reason = r.reason as DuelTokenRetirementJournalEntryV2['reason'];
    check((r.kind === 'gold' && reason === 'consume-gold') ||
      (r.kind === 'recruit' && reason === 'kill-recruit'),
    `token retirement history[${i}] kind/reason`);
    return { kind: r.kind as DuelTokenKindV2, tokenUID: id(r.tokenUID, `token retirement history[${i}].tokenUID`),
      ownerPlayerId: id(r.ownerPlayerId, `token retirement history[${i}].ownerPlayerId`),
      sourceEffectId: id(r.sourceEffectId, `token retirement history[${i}].sourceEffectId`),
      eventId: id(r.eventId, `token retirement history[${i}].eventId`), reason,
      retiredAtStateVersion: safeCount(r.retiredAtStateVersion,
        `token retirement history[${i}].retiredAtStateVersion`) };
  }) as DuelTokenRetirementJournalEntryV2[];
  const history = { births, retirements };
  tokenStateMatchesHistory(state, proof, history);
  return history;
}
function checkedTokenLifecycleAttestation(raw: unknown, state: DuelCanonicalPlayingStateV2,
  proof: TrustedDuelPermanentInventory): DuelTokenLifecycleHistoryV2 {
  if (raw === undefined) {
    const empty = emptyTokenHistory();
    // Preserve the no-token archive compatibility path, but fail closed when a snapshot
    // actually carries a token without its independent lifecycle journal.
    tokenStateMatchesHistory(state, proof, empty);
    return empty;
  }
  return checkedTokenHistory(raw, state, proof);
}
function tokenBirth(history: DuelTokenLifecycleHistoryV2,
  attestation: DuelTokenSourceAttestationV2, stateVersion: number): DuelTokenLifecycleHistoryV2 {
  check(!history.births.some(entry => entry.tokenUID === attestation.tokenUID),
    `token UID already born: ${attestation.tokenUID}`);
  check(!history.births.some(entry => entry.sourceEffectId === attestation.sourceEffectId),
    `source effect already used: ${attestation.sourceEffectId}`);
  check(!history.retirements.some(entry => entry.tokenUID === attestation.tokenUID),
    `retired token UID cannot be reused: ${attestation.tokenUID}`);
  return { births: [...history.births, { ...attestation, createdAtStateVersion: stateVersion }],
    retirements: history.retirements.map(entry => ({ ...entry })) };
}
function tokenRetire(history: DuelTokenLifecycleHistoryV2, tokenUID: string,
  reason: 'consume-gold' | 'kill-recruit', stateVersion: number): DuelTokenLifecycleHistoryV2 {
  const birth = history.births.find(entry => entry.tokenUID === tokenUID);
  check(birth, `token ${tokenUID} has no independent birth history`);
  check(!history.retirements.some(entry => entry.tokenUID === tokenUID),
    `token ${tokenUID} already retired`);
  return { births: history.births.map(entry => ({ ...entry, ...(entry.tags ? { tags: [...entry.tags] } : {}) })),
    retirements: [...history.retirements, { kind: birth.kind, tokenUID,
      ownerPlayerId: birth.effectControllerPlayerId, sourceEffectId: birth.sourceEffectId,
      eventId: birth.eventId, reason, retiredAtStateVersion: stateVersion }] };
}
function tokenInventory(base: TrustedDuelPermanentInventory, kind: DuelTokenKindV2,
  uid: string, owner: string, live: boolean): TrustedDuelPermanentInventory {
  const goldOwners = { ...base.goldOwnersByUID };
  const unitOwners = { ...base.unitTokenOwnersByUID };
  const existing = Object.hasOwn(goldOwners, uid) || Object.hasOwn(unitOwners, uid) ||
    base.retiredPhysicalUIDs.includes(uid);
  if (live) {
    check(!existing, `token UID already exists: ${uid}`);
    check(kind === 'gold' ? !Object.hasOwn(unitOwners, uid) : !Object.hasOwn(goldOwners, uid),
      `token UID category collision: ${uid}`);
    if (kind === 'gold') goldOwners[uid] = owner; else unitOwners[uid] = owner;
  } else {
    check(kind === 'gold' ? Object.hasOwn(goldOwners, uid) : Object.hasOwn(unitOwners, uid),
      `token UID is not live: ${uid}`);
    if (kind === 'gold') delete goldOwners[uid]; else delete unitOwners[uid];
  }
  return { ...base, goldOwnersByUID: goldOwners, unitTokenOwnersByUID: unitOwners };
}
function allCarrierUIDs(state: DuelCanonicalPlayingStateV2): Set<string> {
  const result = new Set<string>();
  for (const object of enumerateDuelObjects(candidate(state), authority(state))) result.add(object.uid);
  for (const uid of state.resources.retiredGoldUids) result.add(uid);
  for (const uid of state.retiredUnitTokenUIDs) result.add(uid);
  return result;
}
function tokenStateMatchesHistory(state: DuelCanonicalPlayingStateV2,
  proof: TrustedDuelPermanentInventory, tokenHistory: DuelTokenLifecycleHistoryV2,
  maxJournalStateVersion = state.stateVersion, checkEntryReadiness = true): void {
  const liveGold = new Set(Object.keys(proof.goldOwnersByUID));
  const liveRecruit = new Set(Object.keys(proof.unitTokenOwnersByUID));
  const retiredGold = new Set(state.resources.retiredGoldUids);
  const retiredRecruit = new Set(state.retiredUnitTokenUIDs);
  const seats = new Set(state.roster.map(seat => seat.playerId));
  const birthUIDs = new Set<string>();
  const birthEffects = new Set<string>();
  let previousBirthVersion = -1;
  for (const birth of tokenHistory.births) {
    check(birth.createdAtStateVersion >= previousBirthVersion &&
      birth.createdAtStateVersion <= maxJournalStateVersion,
    `token birth history order/version ${birth.tokenUID}`);
    previousBirthVersion = birth.createdAtStateVersion;
    check(seats.has(birth.effectControllerPlayerId) && seats.has(birth.controllerPlayerId) &&
      birth.effectControllerPlayerId === birth.controllerPlayerId,
    `token birth owner/controller is not a match seat ${birth.tokenUID}`);
    // Validate live-attached journal entries too; otherwise a forged internal lifecycle context
    // could skip the stricter archive parser on a later generic commit.
    check(birth.kind === 'gold' || (birth.kind === 'recruit' && birth.name === 'Recruit' &&
      birth.baseMight === 1 && same(birth.tags, ['Recruit'])),
    `token intrinsic birth trait ${birth.tokenUID}`);
    check(!birthUIDs.has(birth.tokenUID), `duplicate token birth ${birth.tokenUID}`);
    check(!birthEffects.has(birth.sourceEffectId),
      `duplicate token source effect ${birth.sourceEffectId}`);
    birthUIDs.add(birth.tokenUID);
    birthEffects.add(birth.sourceEffectId);
    check(birth.matchId === state.matchId && birth.dataVersion === state.dataVersion &&
      birth.catalogDigest === state.catalogDigest, 'token birth history identity');
    check(birth.sourceProofId.trim().length > 0 && birth.eventId.trim().length > 0,
      `token birth source binding ${birth.tokenUID}`);
    const isLive = birth.kind === 'gold' ? liveGold.has(birth.tokenUID) : liveRecruit.has(birth.tokenUID);
    const isRetired = birth.kind === 'gold' ? retiredGold.has(birth.tokenUID) : retiredRecruit.has(birth.tokenUID);
    check(isLive !== isRetired, `token birth carrier mismatch ${birth.tokenUID}`);
    const owner = birth.kind === 'gold' ? proof.goldOwnersByUID[birth.tokenUID] :
      proof.unitTokenOwnersByUID[birth.tokenUID];
    // A retired key is deliberately removed from the live owner map. Its immutable original
    // owner remains in the birth/retirement journal and is checked below against that journal.
    if (isLive) {
      check(birth.effectControllerPlayerId === owner,
        `token original owner mismatch ${birth.tokenUID}`);
      if (birth.kind === 'recruit') {
        const trait = state.unitMeta[birth.tokenUID]?.trait;
        // Intrinsic trait stays the actual 1-Might Recruit, regardless of derived Might
        // bonuses, readiness, controller or location changes after the birth commit.
        check(trait?.kind === 'token' && trait.name === birth.name &&
          trait.baseMight === birth.baseMight && same(trait.tags, birth.tags),
        `token intrinsic Recruit trait differs from birth ${birth.tokenUID}`);
      }
      // At a version numerically equal to the birth commit, compare its entry readiness.
      // At later versions readiness can legally change, so birth-only history cannot
      // authenticate the archived readiness at those versions.
      if (checkEntryReadiness && birth.createdAtStateVersion === state.stateVersion) {
        const readied = birth.kind === 'recruit' ? state.unitMeta[birth.tokenUID]?.readied :
          state.resources.bases.flatMap(base => base.goldTokens)
            .find(token => token.uid === birth.tokenUID)?.readied;
        check(readied === birth.readied, `token entry readiness differs from birth ${birth.tokenUID}`);
      }
    }
  }
  let previousRetirementVersion = -1;
  for (const retirement of tokenHistory.retirements) {
    check(seats.has(retirement.ownerPlayerId),
      `token retirement owner is not a match seat ${retirement.tokenUID}`);
    check(retirement.retiredAtStateVersion >= previousRetirementVersion &&
      retirement.retiredAtStateVersion <= maxJournalStateVersion,
    `token retirement history order/version ${retirement.tokenUID}`);
    previousRetirementVersion = retirement.retiredAtStateVersion;
    const birth = tokenHistory.births.find(entry => entry.tokenUID === retirement.tokenUID);
    check(birth && birth.kind === retirement.kind && birth.effectControllerPlayerId === retirement.ownerPlayerId,
      `retirement without matching token birth ${retirement.tokenUID}`);
    check(retirement.kind === 'gold' ? retiredGold.has(retirement.tokenUID) : retiredRecruit.has(retirement.tokenUID),
      `retired token carrier missing ${retirement.tokenUID}`);
  }
  const retiredBirths = new Set(tokenHistory.retirements.map(entry => entry.tokenUID));
  check(tokenHistory.retirements.length === retiredBirths.size, 'duplicate token retirement');
  for (const retirement of tokenHistory.retirements) {
    const birth = tokenHistory.births.find(entry => entry.tokenUID === retirement.tokenUID)!;
    check(retirement.retiredAtStateVersion > birth.createdAtStateVersion &&
      retirement.sourceEffectId === birth.sourceEffectId && retirement.eventId === birth.eventId,
    `retirement history birth/version binding ${retirement.tokenUID}`);
  }
  check(retiredGold.size === tokenHistory.births.filter(entry => entry.kind === 'gold' &&
    retiredBirths.has(entry.tokenUID)).length &&
    retiredRecruit.size === tokenHistory.births.filter(entry => entry.kind === 'recruit' &&
      retiredBirths.has(entry.tokenUID)).length,
  'token proof has orphan retired keys');
  check(liveGold.size === tokenHistory.births.filter(entry => entry.kind === 'gold' &&
    !retiredBirths.has(entry.tokenUID)).length &&
    liveRecruit.size === tokenHistory.births.filter(entry => entry.kind === 'recruit' &&
      !retiredBirths.has(entry.tokenUID)).length,
  'token proof has orphan live keys');
}

/**
 * Read-only currentness proof for callers that inspect a resource action without committing.
 * Restore admission retains a caller-owned private inventory, so lifecycle history alone is
 * insufficient after admission. This checks the token portion of the real playing validator
 * without allocating a successor or invoking any external authority.
 */
export function assertDuelNativeTokenInventoryCurrentV2(state: DuelCanonicalPlayingStateV2): void {
  check(state.stage === 'playing', 'token inventory requires a playing state');
  const liveAuthority = capability(state);
  const proof = liveAuthority.inventory;
  // Keep the read-only route aligned with verifyPlaying's admission and physical proof checks.
  checkedPlaying(state, proof, liveAuthority.history);
  tokenStateMatchesHistory(state, proof, liveAuthority.tokenHistory);
}

function copiedZone(value: DuelPhysicalZone): DuelPhysicalZone { return { ...value }; }
function checkedProvenance(raw: unknown, proof: TrustedDuelPermanentInventory,
  board: DuelBoard | null): DuelCreationProvenanceV2 {
  const p = record(raw, ['originalPhysicalCards', 'submittedBattlefieldUIDs', 'initialZonesByUID', 'transitions'], 'provenance');
  const originals = list(p.originalPhysicalCards, 'provenance originals');
  check(same(originals, proof.originalPhysicalCards), 'creation differs from independently attested originals');
  const submitted = list(p.submittedBattlefieldUIDs, 'submitted BF');
  check(same(submitted, proof.submittedBattlefieldUIDs), 'BF creation differs from independent proof');
  const initial = record(p.initialZonesByUID, Object.keys(p.initialZonesByUID as object), 'initial zone baseline');
  const retired = new Set(proof.retiredPhysicalUIDs);
  const liveOriginals = proof.originalPhysicalCards.filter(card => !retired.has(card.uid));
  check(Object.keys(initial).length === liveOriginals.length &&
    liveOriginals.every(card => Object.hasOwn(initial, card.uid)), 'genesis zone coverage');
  const ids = proof.rosterPlayerIds;
  const initialZonesByUID: Record<string, DuelPhysicalZone> = Object.create(null);
  for (const [uid, value] of Object.entries(initial)) {
    const card = liveOriginals.find(entry => entry.uid === uid);
    check(card, `unknown genesis UID ${uid}`);
    const parsed = zone(value, ids, board, `genesis ${uid}`);
    // At setup, physical ownership and initial seat zone come from the validated inputs.
    check(('zonePlayerId' in parsed && parsed.zonePlayerId === card.ownerPlayerId) ||
      (card.cardType === 'Battlefield' && parsed.kind === 'board-battlefield'),
    `genesis ${uid} does not belong to its creation seat`);
    initialZonesByUID[uid] = parsed;
  }
  const transitions = list(p.transitions, 'ordered provenance transfers').map((value, i) => {
    const step = record(value, ['uid', 'from', 'to'], `transitions[${i}]`);
    const uid = id(step.uid, `transitions[${i}].uid`);
    check(Object.hasOwn(initialZonesByUID, uid), `transitions[${i}] not a live genesis UID`);
    return { uid, from: zone(step.from, ids, board, `transitions[${i}].from`),
      to: zone(step.to, ids, board, `transitions[${i}].to`) };
  });
  return { originalPhysicalCards: proof.originalPhysicalCards.map(c => ({ ...c })),
    submittedBattlefieldUIDs: [...proof.submittedBattlefieldUIDs], initialZonesByUID, transitions };
}
function provenanceOfHistory(history: DuelRestoreAttestationV2): DuelCreationProvenanceV2 {
  return { originalPhysicalCards: history.originalPhysicalCards.map(card => ({ ...card })),
    submittedBattlefieldUIDs: [...history.submittedBattlefieldUIDs],
    initialZonesByUID: Object.fromEntries(Object.entries(history.initialZonesByUID)
      .map(([uid, value]) => [uid, copiedZone(value)])),
    transitions: history.transitions.map(step => ({ uid: step.uid,
      from: copiedZone(step.from), to: copiedZone(step.to) })) };
}
function historyFor(state: DuelMatchStateV2, provenance: DuelCreationProvenanceV2,
  proof: TrustedDuelPermanentInventory): DuelRestoreAttestationV2 {
  return { matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    rosterPlayerIds: [...proof.rosterPlayerIds] as [string, string],
    originalPhysicalCards: provenance.originalPhysicalCards.map(card => ({ ...card })),
    submittedBattlefieldUIDs: [...provenance.submittedBattlefieldUIDs],
    retiredPhysicalUIDs: [...proof.retiredPhysicalUIDs],
    initialZonesByUID: Object.fromEntries(Object.entries(provenance.initialZonesByUID)
      .map(([uid, value]) => [uid, copiedZone(value)])),
    transitions: provenance.transitions.map(step => ({ uid: step.uid,
      from: copiedZone(step.from), to: copiedZone(step.to) })) };
}
function appendHistory(history: DuelRestoreAttestationV2,
  steps: readonly DuelPhysicalZoneTransition[], state: DuelMatchStateV2,
  proof: TrustedDuelPermanentInventory, board: DuelBoard | null): DuelRestoreAttestationV2 {
  const source = provenanceOfHistory(history);
  const next = checkedProvenance({ ...source, transitions: [...source.transitions, ...steps] }, proof, board);
  replay(next, proof);
  return historyFor(state, next, proof);
}
function checkedRestoreAttestation(raw: unknown, state: DuelCanonicalPlayingStateV2,
  proof: TrustedDuelPermanentInventory): DuelRestoreAttestationV2 {
  const source = record(raw, ['matchId', 'dataVersion', 'catalogDigest', 'rosterPlayerIds',
    'originalPhysicalCards', 'submittedBattlefieldUIDs', 'retiredPhysicalUIDs',
    'initialZonesByUID', 'transitions'], 'independent restore attestation');
  check(source.matchId === state.matchId && source.matchId === proof.matchId &&
    source.dataVersion === state.dataVersion && source.dataVersion === proof.dataVersion &&
    source.catalogDigest === state.catalogDigest && source.catalogDigest === proof.catalogDigest,
  'restore attestation match/catalog binding');
  const roster = list(source.rosterPlayerIds, 'restore attestation roster')
    .map((value, i) => id(value, `restore attestation roster[${i}]`));
  check(roster.length === 2, 'restore attestation roster length');
  const rosterPair = roster as [string, string];
  check(same(rosterPair, proof.rosterPlayerIds) && same(rosterPair, state.roster.map(p => p.playerId)),
    'restore attestation roster binding');
  const retired = list(source.retiredPhysicalUIDs, 'restore attestation retired UIDs')
    .map((value, i) => id(value, `restore attestation retired[${i}]`));
  check(same(retired, proof.retiredPhysicalUIDs), 'restore attestation retirement binding');
  const sourceProvenance = checkedProvenance({
    originalPhysicalCards: source.originalPhysicalCards,
    submittedBattlefieldUIDs: source.submittedBattlefieldUIDs,
    initialZonesByUID: source.initialZonesByUID,
    transitions: source.transitions,
  }, proof, state.board);
  // Replay the independent source itself before it is compared to the archive. This ensures
  // its epoch summary is derived from its complete trace, not accepted as a copied counter.
  replay(sourceProvenance, proof);
  return { matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    rosterPlayerIds: rosterPair, originalPhysicalCards: sourceProvenance.originalPhysicalCards,
    submittedBattlefieldUIDs: sourceProvenance.submittedBattlefieldUIDs,
    retiredPhysicalUIDs: [...retired], initialZonesByUID: sourceProvenance.initialZonesByUID,
    transitions: sourceProvenance.transitions };
}
function assertHistoryMatchesProvenance(provenance: DuelCreationProvenanceV2,
  history: DuelRestoreAttestationV2): void {
  check(same(provenance, provenanceOfHistory(history)),
    'state provenance differs from independently protected creation/history');
}
function replay(provenance: DuelCreationProvenanceV2, proof: TrustedDuelPermanentInventory):
  Readonly<Record<string, DuelPhysicalZone>> {
  const positions = Object.fromEntries(Object.entries(provenance.initialZonesByUID)
    .map(([uid, value]) => [uid, copiedZone(value)])) as Record<string, DuelPhysicalZone>;
  const epochs: Record<string, number> = Object.create(null);
  for (const card of provenance.originalPhysicalCards) epochs[card.uid] = 0;
  for (const [i, step] of provenance.transitions.entries()) {
    check(Object.hasOwn(positions, step.uid) && zoneKey(positions[step.uid]!) === zoneKey(step.from),
      `out-of-order creation history step ${i}`);
    check(zoneKey(step.from) !== zoneKey(step.to), `unchanged creation history step ${i}`);
    positions[step.uid] = copiedZone(step.to);
    if (nonboard(step.from) || nonboard(step.to)) {
      epochs[step.uid]!++;
      check(Number.isSafeInteger(epochs[step.uid]), 'zoneEpoch overflow');
    }
  }
  check(Object.keys(proof.expectedZoneEpochByUID).length === provenance.originalPhysicalCards.length &&
    Object.keys(epochs).every(uid => epochs[uid] === proof.expectedZoneEpochByUID[uid]),
  'ordered history/independent epoch mismatch');
  return positions;
}
function setupZones(setup: DuelSetupState): Record<string, DuelPhysicalZone> {
  const positions: Record<string, DuelPhysicalZone> = Object.create(null);
  for (const p of setup.players) {
    positions[p.champion.uid] = z('champion-zone', p.playerId);
    positions[p.legend.uid] = z('legend-zone', p.playerId);
    for (const c of p.hand) positions[c.uid] = z('hand', p.playerId);
    for (const c of p.remainingMainDeck) positions[c.uid] = z('main-deck', p.playerId);
    for (const c of p.shuffledRuneDeck) positions[c.uid] = z('rune-deck', p.playerId);
  }
  for (const field of setup.selection.selected)
    positions[field.instanceId] = { kind: 'board-battlefield',
      locationId: JSON.stringify(['duel-battlefield', field.instanceId]) };
  return positions;
}
function matchesPositions(actual: Readonly<Record<string, DuelPhysicalZone>>,
  expected: Readonly<Record<string, DuelPhysicalZone>>): boolean {
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.keys(actual).every(uid => Object.hasOwn(expected, uid) &&
      zoneKey(actual[uid]!) === zoneKey(expected[uid]!));
}
function inventoryFor(newSteps: readonly DuelPhysicalZoneTransition[],
  base: TrustedDuelPermanentInventory): TrustedDuelPermanentInventory {
  const epochs = Object.assign(Object.create(null) as Record<string, number>, base.expectedZoneEpochByUID);
  for (const step of newSteps) if (nonboard(step.from) || nonboard(step.to)) {
    epochs[step.uid]!++;
    check(Number.isSafeInteger(epochs[step.uid]), 'zoneEpoch overflow');
  }
  return { ...base, expectedZoneEpochByUID: epochs };
}
function initialInventory(provenance: DuelCreationProvenanceV2, state: DuelMatchStateV2,
  retiredPhysicalUIDs: readonly string[]): TrustedDuelPermanentInventory {
  const expectedZoneEpochByUID: Record<string, number> = Object.create(null);
  for (const card of provenance.originalPhysicalCards) expectedZoneEpochByUID[card.uid] = 0;
  return { matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    rosterPlayerIds: state.roster.map(p => p.playerId) as [string, string],
    originalPhysicalCards: provenance.originalPhysicalCards.map(c => ({ ...c })),
    submittedBattlefieldUIDs: [...provenance.submittedBattlefieldUIDs],
    expectedZoneEpochByUID, retiredPhysicalUIDs: [...retiredPhysicalUIDs],
    goldOwnersByUID: {}, unitTokenOwnersByUID: {} };
}
function v1Base(state: DuelCanonicalPlayingStateV2): DuelCanonicalPlayingState {
  // Explicit V2->V1 *validation adapter*, never a V1 migration or a second live match.
  return { stage: 'playing', schemaVersion: 1, rulesetId: state.rulesetId,
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    stateVersion: state.stateVersion, eventSeq: state.eventSeq, roster: state.roster,
    turnOrder: state.turnOrder, players: state.players, board: state.board, resources: state.resources,
    scoring: state.scoring, unitMeta: state.unitMeta, retiredUnitTokenUIDs: state.retiredUnitTokenUIDs,
    frame: state.frame };
}
function candidate(state: DuelCanonicalPlayingStateV2): DuelPermanentCandidate {
  return { ...v1Base(state), physicalCardsByUID: state.physicalCardsByUID,
    legendStates: state.legendStates, gears: state.gears, retiredPhysicalUIDs: state.retiredPhysicalUIDs,
    ...(Object.hasOwn(state, 'chainCards') ? { chainCards: state.chainCards } : {}) };
}
function playingPositions(match: DuelPermanentCandidate, proof: TrustedDuelPermanentInventory):
  Readonly<Record<string, DuelPhysicalZone>> {
  return Object.fromEntries(enumerateDuelObjects(match, proof).filter(c => c.zoneEpoch !== null)
    .map(c => [c.uid, c.zone])) as Record<string, DuelPhysicalZone>;
}
function checkedPlaying(state: DuelCanonicalPlayingStateV2, proof: TrustedDuelPermanentInventory,
  history?: DuelRestoreAttestationV2, maxCanonicalBirthStateVersion = state.stateVersion): void {
  check(state.schemaVersion === 2 && state.stage === 'playing', 'not a V2 playing state');
  record(state, ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
    'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'players', 'board', 'resources', 'scoring',
    'unitMeta', 'retiredUnitTokenUIDs', 'frame', 'physicalCardsByUID', 'legendStates', 'gears',
    'retiredPhysicalUIDs', 'provenance'], 'V2 playing', ['chainCards', 'tokenChain']);
  validateCanonicalRecruitTokenChainV3(state, maxCanonicalBirthStateVersion);
  assertDuelPermanentState(candidate(state), proof); // exact V1 base + V2 carrier checks, no implicit V1 upgrade
  const creation = checkedProvenance(state.provenance, proof, state.board);
  const positions = replay(creation, proof);
  check(matchesPositions(playingPositions(candidate(state), proof), positions), 'playing zones differ from creation history');
  check(same(state.provenance, creation), 'provenance has noncanonical fields');
  if (history) assertHistoryMatchesProvenance(creation, history);
}
/** Structural/physical/token provenance assertion, NOT authentication of later token readiness or
 * energy/power pools. Callers must separately verify the whole archive state or replay its
 * protected ordered state/event journal; never derive proof inputs from the raw candidate. */
export function assertDuelPlayingStateV2(raw: unknown, externalProof: TrustedDuelPermanentInventory,
  restoreAttestation?: DuelRestoreAttestationV2,
  tokenLifecycleAttestation?: DuelTokenLifecycleRestoreAttestationV2): asserts raw is DuelCanonicalPlayingStateV2 {
  check(restoreAttestation !== undefined, 'V2 playing state requires independent restore attestation');
  check(raw !== null && typeof raw === 'object', 'V2 playing object');
  const state = raw as DuelCanonicalPlayingStateV2;
  const attestation = checkedRestoreAttestation(restoreAttestation, state, externalProof);
  checkedPlaying(state, externalProof, attestation);
  const tokenHistory = checkedTokenLifecycleAttestation(tokenLifecycleAttestation, state, externalProof);
  tokenStateMatchesHistory(state, externalProof, tokenHistory);
}
/** Admit ONLY an externally authenticated snapshot plus independently held creation/token
 * journals. The token history checks intrinsic Recruit traits and birth-version readiness,
 * but do not authenticate arbitrary later readiness, payments or rune-pool balances. */
export function restoreDuelPlayingStateV2(snapshot: unknown,
  externalCreationAndHistory: TrustedDuelPermanentInventory,
  restoreAttestation?: DuelRestoreAttestationV2,
  tokenLifecycleAttestation?: DuelTokenLifecycleRestoreAttestationV2): DuelCanonicalPlayingStateV2 {
  check(restoreAttestation !== undefined, 'independent restore attestation required');
  const raw = snapshot as DuelCanonicalPlayingStateV2;
  check(raw !== null && typeof raw === 'object', 'V2 playing object');
  // Native V3 Chain carriers are process-local canonical state. Archive restore cannot silently
  // drop them into a schema-2 snapshot; a protected V3 replay/admission path must carry its own
  // native capability and call the V3 coordinator instead.
  check(!Object.hasOwn(raw, 'tokenChain'), 'V3 tokenChain requires native admission');
  const attestation = checkedRestoreAttestation(restoreAttestation, raw, externalCreationAndHistory);
  const tokenHistory = checkedTokenLifecycleAttestation(tokenLifecycleAttestation, raw,
    externalCreationAndHistory);
  assertDuelPlayingStateV2(raw, externalCreationAndHistory, attestation, tokenHistory);
  const permanent = restoreDuelPermanentState(candidate(raw), externalCreationAndHistory);
  const next = { ...permanent, schemaVersion: 2 as const,
    provenance: checkedProvenance(raw.provenance, externalCreationAndHistory, raw.board) };
  checkedPlaying(next, externalCreationAndHistory, attestation);
  tokenStateMatchesHistory(next, externalCreationAndHistory, tokenHistory);
  return admitted(next, externalCreationAndHistory, attestation, tokenHistory);
}

/** Fresh, authenticated seats + catalog callback. V1 constructor is reused, not duplicated. */
export function createDuelMatchV2(seats: readonly DuelSetupSeat[], metadata: DuelMatchMetadata,
  randomIndex: (exclusiveUpperBound: number) => number,
  trustedCardType: DuelTrustedCardTypeResolverV2): DuelMatchSetupStateV2 {
  check(typeof trustedCardType === 'function', 'trusted catalog type resolver required');
  const created = createDuelMatch(seats, metadata, randomIndex);
  check(created.stage === 'setup', 'constructor did not produce setup');
  const originals: TrustedDuelOriginalCard[] = [];
  const add = (uid: string, cardId: string, ownerPlayerId: string, required?: DuelCatalogCardTypeV2): void => {
    const kind: unknown = trustedCardType(cardId);
    check(kind === 'Unit' || kind === 'Champion' || kind === 'Gear' || kind === 'Rune' ||
      kind === 'Legend' || kind === 'Battlefield' || kind === 'Other', `unverified printing ${cardId}`);
    // A Champion is a Unit printing with a Champion tag. Constructed decks may carry
    // additional Champion printings in the main deck; the chosen slot remains exact.
    check(required ? kind === required : kind === 'Unit' || kind === 'Champion' ||
      kind === 'Gear' || kind === 'Other',
    `catalog printing kind incompatible with submitted slot ${uid}`);
    originals.push({ uid, cardId, ownerPlayerId, origin: 'submitted-deck', cardType: kind });
  };
  for (const seat of seats) {
    add(seat.champion.uid, seat.champion.cardId, seat.playerId, 'Champion');
    add(seat.legend.uid, seat.legend.cardId, seat.playerId, 'Legend');
    for (const card of seat.mainDeck) add(card.uid, card.cardId, seat.playerId);
    for (const rune of seat.runeDeck) add(rune.uid, rune.cardId, seat.playerId, 'Rune');
    for (const field of seat.battlefields) add(field.instanceId, field.cardId, seat.playerId, 'Battlefield');
  }
  check(new Set(originals.map(card => card.uid)).size === originals.length, 'duplicate submitted physical UID');
  const selection = created.setup.selection;
  const retired = selection.removedByPlayer.flatMap(p => p.battlefields.map(f => f.instanceId));
  const provenance: DuelCreationProvenanceV2 = {
    originalPhysicalCards: originals, submittedBattlefieldUIDs: seats.flatMap(p => p.battlefields.map(f => f.instanceId)),
    initialZonesByUID: setupZones(created.setup), transitions: [],
  };
  const v2: DuelMatchSetupStateV2 = { ...created, schemaVersion: 2, provenance };
  const proof = initialInventory(provenance, v2, retired);
  checkedProvenance(provenance, proof, null);
  check(matchesPositions(replay(provenance, proof), setupZones(created.setup)), 'genesis zone mismatch');
  const result = admitted(v2, proof, historyFor(v2, provenance, proof));
  immutableObjectViewOriginsV2.add(capability(result).origin);
  return result;
}
function checkedSetup(state: DuelMatchSetupStateV2, proof: TrustedDuelPermanentInventory,
  history?: DuelRestoreAttestationV2): DuelSetupState {
  record(state, ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
    'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'setup', 'provenance'], 'V2 setup');
  check(state.schemaVersion === 2 && state.stage === 'setup' && state.rulesetId === 'riftbound-duel', 'V2 setup identity');
  const setup = restoreDuelSetup(state.setup);
  check(state.roster.length === 2 && setup.playerIds.every((id, i) =>
    id === state.roster[i]?.playerId && id === proof.rosterPlayerIds[i]) &&
    state.turnOrder.every((id, i) => id === setup.turnOrder[i]), 'setup seats/turn order');
  check(state.stateVersion === state.eventSeq && state.stateVersion >= 0 && state.stateVersion <= 1 &&
    state.setup.stage === 'mulligan', 'setup clocks/stage');
  const provenance = checkedProvenance(state.provenance, proof, null);
  check(matchesPositions(replay(provenance, proof), setupZones(setup)), 'setup zones differ from creation history');
  if (history) assertHistoryMatchesProvenance(provenance, history);
  return setup;
}
/** Actual mulligan kernel decides draws/recycle; journal records each resulting concrete UID. */
export function resolveDuelMulliganV2(state: DuelMatchSetupStateV2, actor: string,
  selectedUIDs: readonly string[], randomIndex?: (exclusiveUpperBound: number) => number): DuelMatchStateV2 {
  const liveAuthority = capability(state), proof = liveAuthority.inventory;
  const original = checkedSetup(state, proof, liveAuthority.history);
  const due = original.turnOrder.find(playerId => original.players.find(p => p.playerId === playerId)!.mulliganStatus === 'pending');
  const before = original.players.find(p => p.playerId === due)!;
  const v1 = { stage: 'setup' as const, schemaVersion: 1 as const, rulesetId: state.rulesetId,
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    stateVersion: state.stateVersion, eventSeq: state.eventSeq, roster: state.roster, turnOrder: state.turnOrder, setup: original };
  const result = resolveDuelMulligan(v1, actor, selectedUIDs, randomIndex);
  const after = result.stage === 'setup' ? result.setup.players.find(p => p.playerId === due)! : result.players.find(p => p.playerId === due)!;
  const oldHand = new Set(before.hand.map(c => c.uid)), newHand = new Set(after.hand.map(c => c.uid));
  const removed = before.hand.filter(c => !newHand.has(c.uid));
  const added = after.hand.filter(c => !oldHand.has(c.uid));
  check(removed.length === added.length && removed.length === selectedUIDs.length &&
    removed.every(c => selectedUIDs.includes(c.uid)) &&
    added.every(c => before.remainingMainDeck.slice(0, removed.length).some(d => d.uid === c.uid)),
  'actual mulligan transfer mismatch');
  const steps: DuelPhysicalZoneTransition[] = [
    ...removed.map(c => ({ uid: c.uid, from: z('hand', actor), to: z('main-deck', actor) })),
    ...added.map(c => ({ uid: c.uid, from: z('main-deck', actor), to: z('hand', actor) })),
  ];
  const provenance = { ...state.provenance, transitions: [...state.provenance.transitions, ...steps] };
  const nextProof = inventoryFor(steps, proof);
  if (result.stage === 'setup') {
    const next: DuelMatchSetupStateV2 = { ...result, schemaVersion: 2, provenance };
    checkedSetup(next, nextProof);
    return admitted(next, nextProof, historyFor(next, provenance, nextProof), undefined, state);
  }
  const initialized = initializeDuelPermanentState(result, nextProof);
  const playing: DuelCanonicalPlayingStateV2 = { ...initialized, schemaVersion: 2, provenance };
  checkedPlaying(playing, nextProof);
  return admitted(playing, nextProof, historyFor(playing, provenance, nextProof), undefined, state);
}

/** Strict single outer clock for a V2 mutation. Trace must be produced by a trusted executor
 * at the moment it actually changes carriers, including invisible intermediate round trips.
 * The journal is not a self-authenticating archive: external restore needs independent proof. */
type DuelTokenMutationContextV2 = {
  readonly inventory: TrustedDuelPermanentInventory;
  readonly tokenHistory: DuelTokenLifecycleHistoryV2;
  readonly creationAuthority?: DuelTokenCreationAuthorityV2;
  /** Only the native V3 Chain begin/cancel/finalize paths may change this carrier. */
  readonly allowCanonicalRecruitChain?: true;
};
function commitDuelPlayingMutationInternalV2(state: DuelCanonicalPlayingStateV2,
  mutate: (draft: DuelCanonicalPlayingStateV2) => {
    readonly match: DuelCanonicalPlayingStateV2;
    readonly transitions: readonly DuelPhysicalZoneTransition[];
  }, lifecycle?: DuelTokenMutationContextV2, recordCombatDeal = false): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state), proof = liveAuthority.inventory;
  const nextProof = lifecycle?.inventory ?? proof;
  const nextTokenHistory = lifecycle?.tokenHistory ?? liveAuthority.tokenHistory;
  checkedPlaying(state, proof, liveAuthority.history);
  tokenStateMatchesHistory(state, proof, liveAuthority.tokenHistory);
  check(!lifecycle || lifecycle.creationAuthority === undefined || !tokenAuthorities.get(lifecycle.creationAuthority)?.used,
    'token creation authority already consumed');
  check(state.stateVersion < Number.MAX_SAFE_INTEGER && state.eventSeq < Number.MAX_SAFE_INTEGER, 'version overflow');
  freeze(state);
  const draft = { ...restoreDuelPermanentState(candidate(state), proof), schemaVersion: 2 as const,
    provenance: checkedProvenance(state.provenance, proof, state.board),
    ...(Object.hasOwn(state, 'tokenChain') ? { tokenChain: state.tokenChain } : {}) };
  const output = mutate(draft);
  const result = record(output, ['match', 'transitions'], 'trusted mutation result');
  const raw = result.match as DuelCanonicalPlayingStateV2;
  const steps = list(result.transitions, 'trusted mutation transitions') as readonly DuelPhysicalZoneTransition[];
  check(raw.schemaVersion === 2 && raw.stage === 'playing', 'mutation must return V2 playing');
  check(same(raw.provenance, state.provenance), 'mutation cannot rewrite creation/history');
  check(raw.matchId === state.matchId && raw.dataVersion === state.dataVersion &&
    raw.catalogDigest === state.catalogDigest && same(raw.roster, state.roster) &&
    same(raw.turnOrder, state.turnOrder), 'mutation changed immutable match identity');
  check(raw.retiredPhysicalUIDs.every((uid, i) => uid === state.retiredPhysicalUIDs[i]),
    'mutation cannot alter physical retirement');
  // Native-only carriers must retain their admitted identity. JSON equality can
  // invoke toJSON and cannot authorize replacement, insertion or deletion.
  const recruitChainDescriptor = Object.getOwnPropertyDescriptor(raw, 'tokenChain');
  check(recruitChainDescriptor === undefined || Object.hasOwn(recruitChainDescriptor, 'value'),
    'canonical Recruit Chain must be a data property');
  const rawRecruitChain = recruitChainDescriptor?.value as
    readonly DuelCanonicalRecruitTokenChainEntryV3[] | undefined;
  if (recruitChainDescriptor !== undefined) {
    check(lifecycle?.allowCanonicalRecruitChain === true ||
      (Object.hasOwn(state, 'tokenChain') && rawRecruitChain === state.tokenChain),
    'ordinary mutation cannot alter canonical Recruit Chain');
  }
  check(raw.eventSeq === state.eventSeq &&
    (raw.stateVersion === state.stateVersion || raw.stateVersion === state.stateVersion + 1),
  'helper clock drift');
  const finalized = advanceDuelPhysicalZoneTransitions(candidate(state), candidate(raw), proof, steps,
    nextProof);
  const history = { ...state.provenance, transitions: [...state.provenance.transitions, ...steps] };
  check(same(finalized.nextInventory.expectedZoneEpochByUID,
    inventoryFor(steps, proof).expectedZoneEpochByUID), 'epoch history mismatch');
  const nextDraft: DuelCanonicalPlayingStateV2 = { ...finalized.state, schemaVersion: 2, provenance: history,
    ...(recruitChainDescriptor !== undefined ? { tokenChain: rawRecruitChain } :
      (Object.hasOwn(state, 'tokenChain') ? { tokenChain: state.tokenChain } : {})) };
  // A newly admitted V3 Chain carrier records the clock that the outer native
  // transaction is about to allocate. Permit that one pending version only for
  // this preflight; the published successor is validated again at its exact clock.
  checkedPlaying(nextDraft, finalized.nextInventory, undefined, state.stateVersion + 1);
  tokenStateMatchesHistory(nextDraft, nextProof, nextTokenHistory, state.stateVersion + 1, false);
  const allocated = allocateDuelPlayingV2Clock(state, nextDraft);
  // An actual zero-damage Deal still consumes a combat window. Its canonical
  // clock must survive serialization even when the observable carriers match.
  const next = allocated === state && recordCombatDeal
    ? { ...nextDraft, stateVersion: state.stateVersion + 1, eventSeq: state.eventSeq + 1 }
    : allocated;
  checkedPlaying(next, finalized.nextInventory);
  if (next === state) return state;
  check(next.stateVersion === state.stateVersion + 1 && next.eventSeq === state.eventSeq + 1,
    'permanent change without outer clock');
  // nextDraft retains the previous clock while the outer allocator advances the version.
  // Compare birth entry readiness on the published creation version, before consuming any
  // one-use source authority. Other post-birth ready/exhaust mutations remain legal.
  tokenStateMatchesHistory(next, nextProof, nextTokenHistory);
  check(same(state.provenance.transitions, draft.provenance.transitions), 'original history mutated');
  if (lifecycle?.creationAuthority) {
    const capability = tokenAuthorities.get(lifecycle.creationAuthority);
    check(capability?.state === state, 'token creation authority belongs to another match/state');
    capability.used = true;
  }
  return admitted(next, finalized.nextInventory,
    appendHistory(capability(state).history, steps, next, finalized.nextInventory, next.board),
    nextTokenHistory, state);
}

/** Public trusted mutation wrapper retained for all existing physical/resource callers. */
export function commitDuelPlayingMutationV2(state: DuelCanonicalPlayingStateV2,
  mutate: (draft: DuelCanonicalPlayingStateV2) => {
    readonly match: DuelCanonicalPlayingStateV2;
    readonly transitions: readonly DuelPhysicalZoneTransition[];
  }): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationInternalV2(state, mutate);
}

/** Physical storage for CR 354 step 1. This does not authorize CardPlay, its costs
 * or execution: those belong to the trusted outer action coordinator. */
export function moveDuelPhysicalCardToChainV2(state: DuelCanonicalPlayingStateV2,
  reference: DuelPhysicalReference, controllerPlayerId: string): DuelCanonicalPlayingStateV2 {
  assertCurrentDuelPhysicalReferenceV2(state, reference);
  const physical = state.physicalCardsByUID[reference.uid]!;
  const source = enumerateDuelObjectsV2(state).find(item => item.uid === reference.uid)!;
  check(state.roster.some(player => player.playerId === controllerPlayerId), 'unknown Chain controller');
  check(source.zone.kind === 'hand' || source.zone.kind === 'champion-zone', 'card is not in a playable source zone');
  check(state.frame.pendingPayment === null, 'pending payment owns physical source');
  return commitDuelPlayingMutationV2(state, draft => {
    const transfer = (player: (typeof draft.players)[number]) => ({ ...player,
      hand: player.hand.filter(card => card.uid !== reference.uid),
      champion: player.champion?.uid === reference.uid ? null : player.champion });
    return { match: { ...draft,
    players: [transfer(draft.players[0]), transfer(draft.players[1])],
    chainCards: [...(draft.chainCards ?? []), { uid: reference.uid, cardId: physical.cardId,
      ownerPlayerId: physical.ownerPlayerId, controllerPlayerId }] },
    transitions: [{ uid: reference.uid, from: source.zone,
      to: { kind: 'chain', zonePlayerId: physical.ownerPlayerId } }] };
  });
}

/**
 * Physical Unit Play finalize bridge for the CR 354 Chain path.  The caller must
 * already have closed State, settled the required payment and proved the complete
 * entry closure.  This primitive owns the only Chain -> Base transfer and therefore
 * also owns the final physical epoch/transition clock.  It deliberately accepts a
 * catalog predicate rather than a client card-type claim.
 */
export function finalizeDuelPhysicalUnitFromChainV2(state: DuelCanonicalPlayingStateV2,
  uid: string, controllerPlayerId: string, locationId: string,
  entryReplacement: 'enter-ready' | undefined,
  trustedIsUnitPrinting: (cardId: string) => boolean): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const born = printedUnitChainBirths.get(liveAuthority.origin) ?? new Set<string>();
  const claims = printedUnitChainClaims.get(liveAuthority.origin) ?? new Map<string, { poisoned: boolean }>();
  check(typeof uid === 'string' && uid.length > 0, 'Chain Unit UID required');
  check(typeof controllerPlayerId === 'string' && state.roster.some(p => p.playerId === controllerPlayerId),
    'unknown Chain Unit controller');
  check(typeof locationId === 'string' && state.board.bases.some(base =>
    base.locationId === locationId && base.ownerPlayerId === controllerPlayerId),
  'Unit must enter its controller Base');
  check((entryReplacement === undefined || entryReplacement === 'enter-ready') &&
    typeof trustedIsUnitPrinting === 'function',
    'trusted Unit finalize binding required');
  check(state.frame.stateOpen === false && state.frame.pendingPayment === null,
    'Chain Unit finalize requires closed State and settled payment');
  const chain = (state.chainCards ?? []).filter(card => card.uid === uid);
  check(chain.length === 1, 'physical Unit is not uniquely on the Chain');
  const card = chain[0]!;
  const physical = state.physicalCardsByUID[uid];
  check(physical?.ownerPlayerId === controllerPlayerId && physical.cardId === card.cardId,
    'Chain Unit physical identity mismatch');
  const origin = state.provenance.originalPhysicalCards.find(item => item.uid === uid);
  check(origin?.cardType === 'Unit' && origin.cardId === card.cardId && origin.ownerPlayerId === controllerPlayerId,
    'Chain source is not an original Unit printing');
  check(!state.board.units.some(unit => unit.objectId === uid), 'Unit already born');
  const roundKey = physicalChainRoundKey(uid, physical.zoneEpoch);
  const previousClaim = claims.get(roundKey);
  if (previousClaim) previousClaim.poisoned = true;
  check(!born.has(roundKey) && !previousClaim, 'Chain Unit physical Chain round already claimed on native origin');
  const claim = { poisoned: false };
  claims.set(roundKey, claim);
  printedUnitChainClaims.set(liveAuthority.origin, claims);
  try {
    check(trustedIsUnitPrinting(card.cardId) === true && !claim.poisoned,
      'untrusted or reentered Unit printing');
    const next = commitDuelPlayingMutationV2(state, draft => {
    check(!claim.poisoned, 'Chain Unit finalize reentered');
    const board = placeDuelUnit(draft.board, { objectId: uid,
      controllerPlayerId, locationId });
    const unitMeta = { ...draft.unitMeta,
      [uid]: { ownerPlayerId: controllerPlayerId, readied: entryReplacement === 'enter-ready', damageMarks: [],
        trait: { kind: 'card' as const, cardId: card.cardId } } };
    return { match: { ...draft, board, unitMeta,
      frame: { ...draft.frame, stateOpen: true },
      chainCards: (draft.chainCards ?? []).filter(item => item.uid !== uid) },
      transitions: [{ uid, from: { kind: 'chain', zonePlayerId: controllerPlayerId },
        to: { kind: 'board-base', locationId } }] };
    });
    check(!claim.poisoned, 'Chain Unit finalize reentered');
    check(next !== state, 'Chain Unit finalize made no Core transition');
    born.add(roundKey);
    printedUnitChainBirths.set(liveAuthority.origin, born);
    return next;
  } finally {
    claims.delete(roundKey);
    if (claims.size === 0) printedUnitChainClaims.delete(liveAuthority.origin);
  }
}

/** Pre-payment cancellation bridge.  No payment/refund is attempted here; the
 * physical card is returned through the same native transition journal. */
export function cancelDuelPhysicalUnitChainToHandV2(state: DuelCanonicalPlayingStateV2,
  uid: string, ownerPlayerId: string): DuelCanonicalPlayingStateV2 {
  check(state.frame.stateOpen === false && state.frame.pendingPayment === null,
    'Chain cancellation requires closed State and no payment');
  const chain = (state.chainCards ?? []).filter(card => card.uid === uid);
  check(chain.length === 1 && chain[0]!.ownerPlayerId === ownerPlayerId,
    'physical card is not uniquely on the owner Chain');
  check(!state.players.some(player => player.hand.some(card => card.uid === uid)) &&
    !state.board.units.some(unit => unit.objectId === uid), 'Chain cancellation source is already present');
  const physical = state.physicalCardsByUID[uid];
  check(physical && Number.isSafeInteger(physical.zoneEpoch), 'Chain cancellation source epoch missing');
  const origin = capability(state).origin;
  const born = printedUnitChainBirths.get(origin) ?? new Set<string>();
  check(!born.has(physicalChainRoundKey(uid, physical.zoneEpoch)),
    'physical Chain round already cancelled or finalized');
  // Cancellation is a terminal tombstone for this Chain epoch. A stale sibling or
  // late finalize may not reuse its old head after the card returned to Hand.
  const next = commitDuelPlayingMutationV2(state, draft => {
    const players = draft.players.map(player => player.playerId === ownerPlayerId
      ? { ...player, hand: [...player.hand, { uid, cardId: chain[0]!.cardId }] } : player) as unknown as typeof draft.players;
    return { match: { ...draft, players,
      frame: { ...draft.frame, stateOpen: true },
      chainCards: (draft.chainCards ?? []).filter(card => card.uid !== uid) },
      transitions: [{ uid, from: { kind: 'chain', zonePlayerId: ownerPlayerId },
        to: { kind: 'hand', zonePlayerId: ownerPlayerId } }] };
  });
  born.add(physicalChainRoundKey(uid, physical.zoneEpoch));
  printedUnitChainBirths.set(origin, born);
  return next;
}

/**
 * Physical non-Unit Gear CardPlay finalize bridge for the CR 354 Chain path.
 * The caller must have closed the Chain State, settled the exact required
 * payment, and proved the whole entry/closure boundary.  This is deliberately
 * separate from `registerDuelGearFromTrustedSourceV2`: that legacy entry point
 * admits a Hand card directly and is not a Chain admission primitive.
 */
export function finalizeDuelPhysicalGearFromChainV1(state: DuelCanonicalPlayingStateV2,
  uid: string, controllerPlayerId: string, locationId: string,
  trustedIsGearPrinting: (cardId: string) => boolean): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const born = printedGearChainBirths.get(liveAuthority.origin) ?? new Set<string>();
  const claims = printedGearChainClaims.get(liveAuthority.origin) ??
    new Map<string, { poisoned: boolean }>();
  check(typeof uid === 'string' && uid.length > 0, 'Chain Gear UID required');
  check(typeof controllerPlayerId === 'string' && state.roster.some(p => p.playerId === controllerPlayerId),
    'unknown Chain Gear controller');
  check(typeof locationId === 'string' && state.board.bases.some(base =>
    base.locationId === locationId && base.ownerPlayerId === controllerPlayerId),
  'Gear must enter its controller Base');
  check(typeof trustedIsGearPrinting === 'function', 'trusted Gear finalize binding required');
  check(state.frame.stateOpen === false && state.frame.pendingPayment === null,
    'Chain Gear finalize requires closed State and settled payment');
  const chain = (state.chainCards ?? []).filter(card => card.uid === uid);
  check(chain.length === 1, 'physical Gear is not uniquely on the Chain');
  const card = chain[0]!;
  const physical = state.physicalCardsByUID[uid];
  check(physical?.ownerPlayerId === controllerPlayerId && physical.cardId === card.cardId &&
    card.controllerPlayerId === controllerPlayerId, 'Chain Gear physical identity mismatch');
  const origin = state.provenance.originalPhysicalCards.find(item => item.uid === uid);
  check(origin?.cardType === 'Gear' && origin.cardId === card.cardId && origin.ownerPlayerId === controllerPlayerId,
    'Chain source is not an original Gear printing');
  check(!state.gears.some(gear => gear.uid === uid), 'Gear already born');
  check(!state.board.units.some(unit => unit.objectId === uid), 'Gear UID collides with a Unit');
  const roundKey = physicalChainRoundKey(uid, physical.zoneEpoch);
  const previousClaim = claims.get(roundKey);
  if (previousClaim) previousClaim.poisoned = true;
  check(!born.has(roundKey) && !previousClaim,
    'Chain Gear physical Chain round already claimed on native origin');
  const claim = { poisoned: false };
  claims.set(roundKey, claim);
  printedGearChainClaims.set(liveAuthority.origin, claims);
  try {
    check(trustedIsGearPrinting(card.cardId) === true && !claim.poisoned,
      'untrusted or reentered Gear printing');
    const next = commitDuelPlayingMutationV2(state, draft => {
      check(!claim.poisoned, 'Chain Gear finalize reentered');
      const gear: DuelGearAuthority = { uid, controllerPlayerId, locationId,
        readied: true, attachedToUID: null };
      return { match: { ...draft, gears: [...draft.gears, gear],
        frame: { ...draft.frame, stateOpen: true },
        chainCards: (draft.chainCards ?? []).filter(item => item.uid !== uid) },
        transitions: [{ uid, from: { kind: 'chain', zonePlayerId: controllerPlayerId },
          to: { kind: 'board-base', locationId } }] };
    });
    check(!claim.poisoned, 'Chain Gear finalize reentered');
    check(next !== state, 'Chain Gear finalize made no Core transition');
    born.add(roundKey);
    printedGearChainBirths.set(liveAuthority.origin, born);
    return next;
  } finally {
    claims.delete(roundKey);
    if (claims.size === 0) printedGearChainClaims.delete(liveAuthority.origin);
  }
}

/** Pre-payment Gear cancellation.  This consumes the exact Chain epoch as a
 * tombstone and returns the original physical card to its owner's Hand. */
export function cancelDuelPhysicalGearChainToHandV1(state: DuelCanonicalPlayingStateV2,
  uid: string, ownerPlayerId: string): DuelCanonicalPlayingStateV2 {
  check(state.frame.stateOpen === false && state.frame.pendingPayment === null,
    'Gear Chain cancellation requires closed State and no payment');
  const chain = (state.chainCards ?? []).filter(card => card.uid === uid);
  check(chain.length === 1 && chain[0]!.ownerPlayerId === ownerPlayerId &&
    chain[0]!.controllerPlayerId === ownerPlayerId,
  'physical Gear is not uniquely on the owner Chain');
  check(!state.players.some(player => player.hand.some(card => card.uid === uid)) &&
    !state.gears.some(gear => gear.uid === uid), 'Gear Chain cancellation source is already present');
  const physical = state.physicalCardsByUID[uid];
  check(physical && Number.isSafeInteger(physical.zoneEpoch), 'Gear Chain cancellation source epoch missing');
  const origin = capability(state).origin;
  const roundKey = physicalChainRoundKey(uid, physical.zoneEpoch);
  const born = printedGearChainBirths.get(origin) ?? new Set<string>();
  const claims = printedGearChainClaims.get(origin);
  const activeClaim = claims?.get(roundKey);
  if (activeClaim) activeClaim.poisoned = true;
  check(!born.has(roundKey) && !activeClaim,
    'Gear physical Chain round already cancelled or finalized');
  const next = commitDuelPlayingMutationV2(state, draft => {
    const players = draft.players.map(player => player.playerId === ownerPlayerId
      ? { ...player, hand: [...player.hand, { uid, cardId: chain[0]!.cardId }] } : player) as
      unknown as typeof draft.players;
    return { match: { ...draft, players,
      frame: { ...draft.frame, stateOpen: true },
      chainCards: (draft.chainCards ?? []).filter(item => item.uid !== uid) },
      transitions: [{ uid, from: { kind: 'chain', zonePlayerId: ownerPlayerId },
        to: { kind: 'hand', zonePlayerId: ownerPlayerId } }] };
  });
  born.add(roundKey);
  printedGearChainBirths.set(origin, born);
  return next;
}

// Core V2 naming aliases for adapters that version primitives by the owning
// Core module rather than by the opt-in Gear CardPlay coordinator.
export const finalizeDuelPhysicalGearFromChainV2 = finalizeDuelPhysicalGearFromChainV1;
export const cancelDuelPhysicalGearChainToHandV2 = cancelDuelPhysicalGearChainToHandV1;

/** Physical end of an executed/countered Spell. An actual resolution receipt is
 * still required by the action/Chain owner before it may close the response window. */
export function moveDuelChainCardToOwnerTrashV2(state: DuelCanonicalPlayingStateV2,
  reference: DuelPhysicalReference): DuelCanonicalPlayingStateV2 {
  assertCurrentDuelPhysicalReferenceV2(state, reference);
  const card = state.chainCards?.find(item => item.uid === reference.uid);
  check(card, 'card is not on the Chain');
  check(state.frame.pendingPayment === null, 'pending payment owns Chain source');
  return commitDuelPlayingMutationV2(state, draft => {
    const transfer = (player: (typeof draft.players)[number]) => player.playerId === card.ownerPlayerId
      ? { ...player, trash: [...player.trash, { uid: card.uid, cardId: card.cardId }] } : player;
    return { match: { ...draft,
    chainCards: draft.chainCards!.filter(item => item.uid !== reference.uid),
    players: [transfer(draft.players[0]), transfer(draft.players[1])] },
    transitions: [{ uid: card.uid, from: { kind: 'chain', zonePlayerId: card.ownerPlayerId },
      to: { kind: 'trash', zonePlayerId: card.ownerPlayerId } }] };
  });
}

/** Explicit public allowlist for the outer P4 Chain projection (CR 108.1.b). */
export function projectDuelChainCardsV2(state: DuelCanonicalPlayingStateV2): readonly {
  readonly uid: string; readonly cardId: string; readonly ownerPlayerId: string; readonly controllerPlayerId: string;
}[] {
  capability(state);
  return Object.freeze((state.chainCards ?? []).map(card => Object.freeze({
    uid: card.uid, cardId: card.cardId, ownerPlayerId: card.ownerPlayerId,
    controllerPlayerId: card.controllerPlayerId })));
}

/** Trusted combat bridge only: record a genuine kernel Deal, including zero
 * damage. The bridge must bind this receipt to its exact current head/plan and
 * publish it with the outer CAS; this API does not authenticate a JSON receipt. */
export function commitDuelCombatDealMutationV2(
  state: DuelCanonicalPlayingStateV2,
  completion: DuelBaseCombatCompleteAllocation,
  mutate: (draft: DuelCanonicalPlayingStateV2) => {
    readonly match: DuelCanonicalPlayingStateV2;
    readonly transitions: readonly DuelPhysicalZoneTransition[];
  },
): DuelCanonicalPlayingStateV2 {
  capability(state);
  const issued = inspectDuelBaseCombatCompletion(completion, state.stateVersion);
  const field = state.board.battlefields.find(item => item.locationId === issued.plan.fieldId);
  check(field?.combat === 'active', 'combat Deal needs the current active battlefield');
  // Active combat can temporarily leave the battlefield uncontrolled. Bind
  // sides to its contesting player and live occupants, rather than requiring
  // the pre-combat defender to retain control during the damage step.
  check((field.controllerPlayerId === null || field.controllerPlayerId === issued.plan.sideIDs[1]) &&
    field.contestingPlayerId === issued.plan.sideIDs[0] &&
    issued.plan.sideIDs.every(playerId => state.board.units.some(unit =>
      unit.locationId === field.locationId && unit.controllerPlayerId === playerId)),
  'combat Deal sides differ from current battlefield');
  check(state.frame.pendingPayment === null, 'pending payment blocks combat Deal');
  return commitDuelPlayingMutationInternalV2(state, mutate, undefined, true);
}

function sourceAuthorityForToken(state: DuelCanonicalPlayingStateV2,
  request: DuelTokenCreationRequestV2,
  source: DuelTokenSourceAttestorV2 | DuelTokenCreationAuthorityV2): {
    readonly attestation: DuelTokenSourceAttestationV2;
    readonly authority: DuelTokenCreationAuthorityV2;
  } {
  if (typeof source === 'function') return attestTokenSource(state, request, source);
  const entry = tokenAuthorities.get(source as object);
  check(entry?.state === state && !entry.used, 'unissued, foreign, or spent token creation authority');
  check(same(entry.attestation, tokenAttestation(entry.attestation, state, request)),
    'token authority/request binding');
  return { attestation: entry.attestation, authority: source };
}
function assertTokenUIDAvailable(state: DuelCanonicalPlayingStateV2, uid: string): void {
  check(!allCarrierUIDs(state).has(uid), `token UID is already carried or retired: ${uid}`);
  check(!Object.hasOwn(state.physicalCardsByUID, uid) &&
    !state.retiredPhysicalUIDs.includes(uid), `token UID collides with physical history: ${uid}`);
  check(!(state.tokenChain ?? []).some(entry => entry.tokenUID === uid),
    `token UID is already reserved on the canonical Chain: ${uid}`);
}

/** Validate an independent source once and return a non-serializable one-use authority. */
export function attestDuelTokenSourceV2(state: DuelCanonicalPlayingStateV2,
  request: DuelTokenCreationRequestV2, attestor: DuelTokenSourceAttestorV2): {
    readonly attestation: DuelTokenSourceAttestationV2;
    readonly authority: DuelTokenCreationAuthorityV2;
  } {
  const parsed = tokenRequest(request, 'token creation request');
  return sourceAuthorityForToken(state, parsed, attestor);
}

/**
 * Create the Gold Gear token in its controller's Base.  Gold intentionally remains a resource
 * carrier in this slice (full Gear attachment/steal semantics are a later scope), but its owner
 * is retained in the independent token journal and proof map rather than inferred from the Base.
 */
export function createDuelGoldTokenV2(state: DuelCanonicalPlayingStateV2,
  rawRequest: DuelTokenCreationRequestV2,
  source: DuelTokenSourceAttestorV2 | DuelTokenCreationAuthorityV2): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const request = tokenRequest(rawRequest, 'Gold creation request');
  check(request.kind === 'gold', 'Gold creation requires a Gold source');
  assertTokenUIDAvailable(state, request.tokenUID);
  check(!liveAuthority.tokenHistory.births.some(entry => entry.sourceEffectId === request.sourceEffectId),
    'source effect already created a token');
  check(!(state.tokenChain ?? []).some(entry => entry.sourceEffectId === request.sourceEffectId ||
    entry.eventId === request.eventId), 'source effect already owns a canonical Chain token');
  const { attestation, authority: creationAuthority } = sourceAuthorityForToken(state, request, source);
  const nextProof = tokenInventory(liveAuthority.inventory, 'gold', request.tokenUID,
    attestation.effectControllerPlayerId, true);
  const nextHistory = tokenBirth(liveAuthority.tokenHistory, attestation, state.stateVersion + 1);
  check(state.board.bases.some(base => base.locationId === request.locationId &&
    base.ownerPlayerId === request.controllerPlayerId), 'Gold must enter its controller\'s Base');
  return commitDuelPlayingMutationInternalV2(state, draft => {
    const resources = createDuelGoldTokenResource(draft.resources, {
      uid: request.tokenUID, playerId: request.controllerPlayerId,
      locationId: request.locationId, readied: request.readied,
    });
    return { match: { ...draft, resources }, transitions: [] };
  }, { inventory: nextProof, tokenHistory: nextHistory, creationAuthority });
}

/** Explicit alias for callers that want to name the trusted-source route. */
export const createDuelGoldFromTrustedSourceV2 = createDuelGoldTokenV2;

/** Consume Gold through the real resource kernel: readiness/timing, removal, and +1 Any. */
export function activateDuelGoldPowerV2(state: DuelCanonicalPlayingStateV2, actor: string,
  uid: string, resourceTiming: DuelResourceTiming): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const token = liveAuthority.tokenHistory.births.find(entry => entry.tokenUID === uid);
  check(token?.kind === 'gold', 'Gold has no independently attested birth');
  check(Object.hasOwn(liveAuthority.inventory.goldOwnersByUID, uid), 'Gold is not a live trusted token');
  check(liveAuthority.inventory.goldOwnersByUID[uid] === token.effectControllerPlayerId,
    'Gold original owner proof mismatch');
  const nextProof = tokenInventory(liveAuthority.inventory, 'gold', uid,
    token.effectControllerPlayerId, false);
  const nextHistory = tokenRetire(liveAuthority.tokenHistory, uid, 'consume-gold', state.stateVersion + 1);
  return commitDuelPlayingMutationInternalV2(state, draft => ({
    match: { ...draft, resources: activateDuelGoldPowerResource(draft.resources, actor, uid, resourceTiming) },
    transitions: [],
  }), { inventory: nextProof, tokenHistory: nextHistory });
}

/** Familiar intrinsic naming for the V2 source-bound Gold operation. */
export const consumeDuelGoldV2 = activateDuelGoldPowerV2;

/** Reserve the token's Chain identity without changing the board, score, resource pool or
 * physical inventory. The caller must retain this private handle until Finalize. */
export function beginDuelRecruitTokenOnChainV2(state: DuelCanonicalPlayingStateV2,
  rawRequest: DuelTokenCreationRequestV2,
  attestor: DuelTokenSourceAttestorV2): DuelRecruitTokenChainReservationV2 {
  const liveAuthority = capability(state);
  const request = tokenRequest(rawRequest, 'Recruit Chain request');
  check(request.kind === 'recruit' && request.readied === false,
    'Chain Recruit requires an exhausted entry request');
  check(state.board.bases.some(base => base.locationId === request.locationId &&
    base.ownerPlayerId === request.controllerPlayerId), 'Chain Recruit must choose its controller Base');
  assertTokenUIDAvailable(state, request.tokenUID);
  check(!liveAuthority.tokenHistory.births.some(entry => entry.sourceEffectId === request.sourceEffectId),
    'source effect already created a token');
  check(!(state.tokenChain ?? []).some(entry => entry.sourceEffectId === request.sourceEffectId ||
    entry.eventId === request.eventId), 'source effect already owns a canonical Chain token');
  const canonicalEntries = recruitChainByOriginV3.get(liveAuthority.origin);
  check(!canonicalEntries || ![...canonicalEntries].some(entry =>
    entry.request.tokenUID === request.tokenUID || entry.request.sourceEffectId === request.sourceEffectId ||
    entry.request.eventId === request.eventId), 'V3 canonical Chain owns this Recruit tuple');
  const canonicalClaims = recruitChainClaimsV3.get(liveAuthority.origin);
  const collidingCanonicalClaims = [...(canonicalClaims ?? [])].filter(claim =>
    claim.request.tokenUID === request.tokenUID || claim.request.sourceEffectId === request.sourceEffectId ||
      claim.request.eventId === request.eventId);
  if (collidingCanonicalClaims.length > 0) {
    for (const claim of collidingCanonicalClaims) claim.poisoned = true;
    throw new TypeError('Duel Core V3: canonical Chain source callback reentered from V2');
  }
  const origin = liveAuthority.origin;
  const entries = recruitChainByOrigin.get(origin) ?? new Set<RecruitChainEntryV2>();
  // Publish the origin index before any provider callback. This keeps sibling branches on one
  // shared reservation index even when a provider re-enters synchronously.
  recruitChainByOrigin.set(origin, entries);
  check(![...entries].some(entry =>
    (entry.request.tokenUID === request.tokenUID || entry.request.sourceEffectId === request.sourceEffectId ||
      entry.request.eventId === request.eventId)),
  'Recruit Chain UID/effect/event already reserved');
  const activeClaims = recruitChainClaims.get(origin);
  const nested = Boolean(activeClaims?.size);
  const sameClaim = activeClaims ? [...activeClaims].some(claim =>
    claim.request.tokenUID === request.tokenUID ||
    claim.request.sourceEffectId === request.sourceEffectId ||
    claim.request.eventId === request.eventId) : false;
  if (sameClaim) {
    for (const claim of activeClaims!) claim.poisoned = true;
    throw new TypeError('Duel Core V2: Recruit Chain source callback reentered');
  }
  const claim: RecruitChainClaimV2 = { request, poisoned: false };
  const claims = activeClaims ?? new Set<RecruitChainClaimV2>();
  claims.add(claim);
  recruitChainClaims.set(origin, claims);
  try {
    const { attestation } = attestTokenSource(state, request, attestor);
    check(!claim.poisoned, 'Recruit Chain source callback changed reservation');
    const entry: RecruitChainEntryV2 = { head: state, request, attestation, origin,
      busy: false, used: false, cancelled: false, poisoned: false };
    const reservation = Object.freeze(Object.create(null)) as DuelRecruitTokenChainReservationV2;
    recruitChainEntries.set(reservation, entry);
    entries.add(entry);
    return reservation;
  } catch (error) {
    // A nested provider failure that is caught by its parent must still poison the outer proof;
    // otherwise the parent could continue after a half-registered nested claim.
    if (nested) for (const parentClaim of claims) parentClaim.poisoned = true;
    throw error;
  } finally {
    claims.delete(claim);
    if (claims.size === 0) recruitChainClaims.delete(origin);
  }
}

/** Read-only process-local Chain birth; a copied handle never acquires this identity. */
export function inspectDuelRecruitTokenOnChainV2(reservation: DuelRecruitTokenChainReservationV2):
  Readonly<{ tokenUID: string; sourceEffectId: string; eventId: string; ownerPlayerId: string;
    locationId: string; zoneEpoch: null; status: 'on-chain' | 'finalized' | 'cancelled' }> {
  const entry = reservation && typeof reservation === 'object' ? recruitChainEntries.get(reservation) : undefined;
  check(entry, 'unknown Recruit Chain reservation');
  return Object.freeze({ tokenUID: entry.request.tokenUID, sourceEffectId: entry.request.sourceEffectId,
    eventId: entry.request.eventId, ownerPlayerId: entry.request.effectControllerPlayerId,
    locationId: entry.request.locationId, zoneEpoch: null,
    status: entry.cancelled ? 'cancelled' : entry.used ? 'finalized' : 'on-chain' });
}

/** Release an un-born reservation before payment. The exact original head is required so an old
 * sibling cannot cancel a live branch; the tombstone remains to reject late Finalize/reuse. */
export function cancelDuelRecruitTokenOnChainV2(state: DuelCanonicalPlayingStateV2,
  reservation: DuelRecruitTokenChainReservationV2): void {
  const entry = reservation && typeof reservation === 'object' ? recruitChainEntries.get(reservation) : undefined;
  check(entry, 'unknown Recruit Chain reservation');
  if (entry.busy) entry.poisoned = true;
  check(!entry.used && !entry.cancelled && !entry.busy && !entry.poisoned,
    'unknown, busy, poisoned, finalized or cancelled Recruit Chain reservation');
  check(capability(state).origin === entry.origin, 'foreign Recruit Chain origin');
  check(state === entry.head, 'Recruit Chain cancel requires its current reservation head');
  check(state.frame.pendingPayment === null, 'Recruit Chain cancel requires a closed payment window');
  entry.cancelled = true;
}

/** Create a 1-Might domainless Recruit Unit token on a trusted board location. */
function createDuelRecruitUnitInternalV2(state: DuelCanonicalPlayingStateV2,
  rawRequest: DuelTokenCreationRequestV2,
  source: DuelTokenSourceAttestorV2 | DuelTokenCreationAuthorityV2,
  reserved?: RecruitChainEntryV2,
  canonicalChainTokenUID?: string): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const request = tokenRequest(rawRequest, 'Recruit creation request');
  check(request.kind === 'recruit', 'Recruit creation requires a Recruit source');
  const activeCanonicalClaims = recruitChainClaimsV3.get(liveAuthority.origin);
  if (activeCanonicalClaims?.size) {
    for (const claim of activeCanonicalClaims) claim.poisoned = true;
    throw new TypeError('Duel Core V3: legacy Recruit birth reentered canonical Chain source');
  }
  const activeClaims = recruitChainClaims.get(liveAuthority.origin);
  if (activeClaims?.size) {
    for (const claim of activeClaims) claim.poisoned = true;
    throw new TypeError('Duel Core V2: Recruit Chain source callback reentered');
  }
  const reservations = recruitChainByOrigin.get(liveAuthority.origin);
  check(!reservations || ![...reservations].some(entry => entry !== reserved &&
    (entry.request.tokenUID === request.tokenUID || entry.request.sourceEffectId === request.sourceEffectId ||
      entry.request.eventId === request.eventId)),
  'Recruit Chain reservation owns this token birth');
  const canonicalReservations = recruitChainByOriginV3.get(liveAuthority.origin);
  check(!canonicalReservations || ![...canonicalReservations].some(entry =>
    entry.request.tokenUID !== canonicalChainTokenUID &&
    (entry.request.tokenUID === request.tokenUID || entry.request.sourceEffectId === request.sourceEffectId ||
      entry.request.eventId === request.eventId)), 'V3 canonical Chain owns this token birth');
  check(!(state.tokenChain ?? []).some(entry =>
    entry.tokenUID !== canonicalChainTokenUID &&
    (entry.tokenUID === request.tokenUID || entry.sourceEffectId === request.sourceEffectId ||
      entry.eventId === request.eventId)),
  'canonical Recruit Chain owns this token birth');
  if (canonicalChainTokenUID !== request.tokenUID) assertTokenUIDAvailable(state, request.tokenUID);
  check(!liveAuthority.tokenHistory.births.some(entry => entry.sourceEffectId === request.sourceEffectId),
    'source effect already created a token');
  const { attestation, authority: creationAuthority } = sourceAuthorityForToken(state, request, source);
  const nextProof = tokenInventory(liveAuthority.inventory, 'recruit', request.tokenUID,
    attestation.effectControllerPlayerId, true);
  const nextHistory = tokenBirth(liveAuthority.tokenHistory, attestation, state.stateVersion + 1);
  check(state.board.bases.some(base => base.locationId === request.locationId &&
    base.ownerPlayerId === request.controllerPlayerId) ||
    state.board.battlefields.some(field => field.locationId === request.locationId),
  'Recruit must enter a legal Base or Battlefield');
  return commitDuelPlayingMutationInternalV2(state, draft => {
    const board = placeDuelUnit(draft.board, { objectId: request.tokenUID,
      controllerPlayerId: request.controllerPlayerId, locationId: request.locationId });
    const unitMeta: Record<string, DuelUnitMeta> = { ...draft.unitMeta,
      [request.tokenUID]: { ownerPlayerId: attestation.effectControllerPlayerId,
        readied: request.readied, damageMarks: [],
        trait: { kind: 'token', name: request.name!, baseMight: 1, tags: [...request.tags!] } } };
    const tokenChain = canonicalChainTokenUID === undefined ? draft.tokenChain :
      (draft.tokenChain ?? []).filter(entry => entry.tokenUID !== canonicalChainTokenUID);
    return { match: { ...draft, board, unitMeta,
      ...(canonicalChainTokenUID === undefined ? {} : { tokenChain }) }, transitions: [] };
  }, { inventory: nextProof, tokenHistory: nextHistory, creationAuthority,
    ...(canonicalChainTokenUID === undefined ? {} : { allowCanonicalRecruitChain: true as const }) });
}

export function createDuelRecruitUnitV2(state: DuelCanonicalPlayingStateV2,
  rawRequest: DuelTokenCreationRequestV2,
  source: DuelTokenSourceAttestorV2 | DuelTokenCreationAuthorityV2): DuelCanonicalPlayingStateV2 {
  return createDuelRecruitUnitInternalV2(state, rawRequest, source);
}

/** Finalize one paid/settled Chain token. The outer TokenPlay executor proves payment,
 * legality, entry, trigger and queue closure before invoking this protected primitive. */
export function finalizeDuelRecruitTokenFromChainV2(state: DuelCanonicalPlayingStateV2,
  reservation: DuelRecruitTokenChainReservationV2,
  attestor: DuelTokenSourceAttestorV2): DuelCanonicalPlayingStateV2 {
  const entry = reservation && typeof reservation === 'object' ? recruitChainEntries.get(reservation) : undefined;
  if (entry?.busy) entry.poisoned = true;
  check(entry && !entry.used && !entry.cancelled && !entry.busy && !entry.poisoned,
    'unknown, busy, poisoned, finalized or cancelled Recruit Chain reservation');
  check(capability(state).origin === entry.origin, 'foreign Recruit Chain origin');
  check(state.frame.pendingPayment === null, 'Recruit Chain Finalize requires a closed payment window');
  inspectDuelNativeCommitPathV2(entry.head, state);
  entry.busy = true;
  try {
    const { attestation, authority: creationAuthority } = attestTokenSource(state, entry.request, attestor);
    check(!entry.poisoned, 'Recruit Chain source callback reentered Finalize');
    check(same(attestation, entry.attestation), 'Recruit Chain source attestation drift');
    const next = createDuelRecruitUnitInternalV2(state, entry.request, creationAuthority, entry);
    check(next !== state, 'Recruit Chain Finalize did not commit');
    entry.used = true;
    return next;
  } finally {
    entry.busy = false;
  }
}

/** Native V3 reservation. Unlike the V2 handle, its birth is already represented by
 * `state.tokenChain` and therefore survives every admitted native commit in the lineage. */
export interface DuelRecruitTokenChainReservationV3 {
  readonly _duelRecruitTokenChainReservationV3: unique symbol;
}
export interface DuelRecruitTokenChainBeginV3 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly reservation: DuelRecruitTokenChainReservationV3;
}
export interface DuelRecruitTokenChainCancelV3 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly reservation: DuelRecruitTokenChainReservationV3;
}
type RecruitChainEntryV3 = {
  readonly originalHead: DuelCanonicalPlayingStateV2;
  readonly chainHead: DuelCanonicalPlayingStateV2;
  readonly request: DuelTokenCreationRequestV2;
  readonly attestation: DuelTokenSourceAttestationV2;
  readonly origin: object;
  busy: boolean;
  used: boolean;
  cancelled: boolean;
  poisoned: boolean;
};
type RecruitChainClaimV3 = { readonly request: DuelTokenCreationRequestV2; poisoned: boolean };

function canonicalRecruitEntryV3(attestation: DuelTokenSourceAttestationV2,
  birthStateVersion: number): DuelCanonicalRecruitTokenChainEntryV3 {
  check(attestation.kind === 'recruit' && attestation.readied === false,
    'V3 canonical Chain requires exhausted Recruit');
  return Object.freeze({ kind: 'recruit', tokenUID: attestation.tokenUID,
    sourceEffectId: attestation.sourceEffectId, eventId: attestation.eventId,
    sourceUID: attestation.sourceUID, sourceZoneEpoch: attestation.sourceZoneEpoch,
    sourceMode: attestation.sourceMode, sourceProofId: attestation.sourceProofId,
    effectControllerPlayerId: attestation.effectControllerPlayerId,
    controllerPlayerId: attestation.controllerPlayerId,
    ownerPlayerId: attestation.effectControllerPlayerId, locationId: attestation.locationId,
    readied: false, name: 'Recruit', baseMight: 1, tags: Object.freeze(['Recruit'] as const),
    zoneEpoch: null, birthStateVersion });
}

function canonicalEntryForReservationV3(entry: RecruitChainEntryV3,
  state: DuelCanonicalPlayingStateV2): DuelCanonicalRecruitTokenChainEntryV3 {
  const current = (state.tokenChain ?? []).find(item => item.tokenUID === entry.request.tokenUID);
  check(current, 'V3 canonical Chain token is missing from current head');
  return current;
}

function canonicalReservationV3(raw: unknown): RecruitChainEntryV3 {
  const entry = raw && typeof raw === 'object' ? recruitChainEntriesV3.get(raw) : undefined;
  check(entry, 'unknown V3 canonical Recruit reservation');
  return entry;
}

/** Begin a Recruit whose identity is a real native Chain carrier. The returned state is the
 * canonical head; callers must use it for all subsequent payment/entry work. */
export function beginDuelRecruitTokenOnChainV3(state: DuelCanonicalPlayingStateV2,
  rawRequest: DuelTokenCreationRequestV2,
  attestor: DuelTokenSourceAttestorV2): DuelRecruitTokenChainBeginV3 {
  const liveAuthority = capability(state);
  const request = tokenRequest(rawRequest, 'V3 Recruit Chain request');
  check(request.kind === 'recruit' && request.readied === false,
    'V3 Chain Recruit requires an exhausted entry request');
  check(state.board.bases.some(base => base.locationId === request.locationId &&
    base.ownerPlayerId === request.controllerPlayerId), 'V3 Chain Recruit Base');
  assertTokenUIDAvailable(state, request.tokenUID);
  check(!(state.tokenChain ?? []).some(entry => entry.sourceEffectId === request.sourceEffectId ||
    entry.eventId === request.eventId), 'V3 source effect/event already owns a Chain token');
  check(!liveAuthority.tokenHistory.births.some(entry => entry.sourceEffectId === request.sourceEffectId),
    'V3 source effect already birthed a token');
  const origin = liveAuthority.origin;
  const legacyEntries = recruitChainByOrigin.get(origin);
  check(!legacyEntries || ![...legacyEntries].some(entry =>
    entry.request.tokenUID === request.tokenUID || entry.request.sourceEffectId === request.sourceEffectId ||
      entry.request.eventId === request.eventId), 'V2 Recruit Chain already owns this tuple');
  const legacyClaims = recruitChainClaims.get(origin);
  const collidingLegacyClaims = [...(legacyClaims ?? [])].filter(claim =>
    claim.request.tokenUID === request.tokenUID || claim.request.sourceEffectId === request.sourceEffectId ||
      claim.request.eventId === request.eventId);
  if (collidingLegacyClaims.length > 0) {
    for (const claim of collidingLegacyClaims) claim.poisoned = true;
    throw new TypeError('Duel Core V2: Recruit Chain source callback reentered from V3');
  }
  const entries = recruitChainByOriginV3.get(origin) ?? new Set<RecruitChainEntryV3>();
  recruitChainByOriginV3.set(origin, entries);
  check(![...entries].some(entry => entry.request.tokenUID === request.tokenUID ||
    entry.request.sourceEffectId === request.sourceEffectId || entry.request.eventId === request.eventId),
  'V3 Recruit Chain UID/effect/event already reserved');
  const activeClaims = recruitChainClaimsV3.get(origin);
  const sameClaim = activeClaims ? [...activeClaims].some(claim =>
    claim.request.tokenUID === request.tokenUID || claim.request.sourceEffectId === request.sourceEffectId ||
    claim.request.eventId === request.eventId) : false;
  if (sameClaim) {
    for (const claim of activeClaims!) claim.poisoned = true;
    throw new TypeError('Duel Core V3: Recruit Chain source callback reentered');
  }
  const claim: RecruitChainClaimV3 = { request, poisoned: false };
  const claims = activeClaims ?? new Set<RecruitChainClaimV3>();
  claims.add(claim); recruitChainClaimsV3.set(origin, claims);
  try {
    const { attestation } = attestTokenSource(state, request, attestor);
    check(!claim.poisoned, 'V3 source callback changed Chain reservation');
    // The token's first canonical clock is the outer native commit clock, never a fabricated
    // physical zone epoch or a board birth clock.
    const canonical = canonicalRecruitEntryV3(attestation, state.stateVersion + 1);
    const next = commitDuelPlayingMutationInternalV2(state, draft => ({
      match: { ...draft, tokenChain: [...(draft.tokenChain ?? []), canonical] }, transitions: [],
    }), { inventory: liveAuthority.inventory, tokenHistory: liveAuthority.tokenHistory,
      allowCanonicalRecruitChain: true });
    check(next !== state && next.tokenChain?.some(item => item.tokenUID === request.tokenUID),
      'V3 canonical Chain begin did not commit');
    const entry: RecruitChainEntryV3 = { originalHead: state, chainHead: next,
      request, attestation, origin, busy: false, used: false, cancelled: false, poisoned: false };
    const reservation = Object.freeze(Object.create(null)) as DuelRecruitTokenChainReservationV3;
    recruitChainEntriesV3.set(reservation, entry); entries.add(entry);
    return Object.freeze({ state: next, match: next, reservation });
  } catch (error) {
    if (activeClaims?.size) for (const parentClaim of activeClaims) parentClaim.poisoned ||= claim.poisoned;
    throw error;
  } finally {
    claims.delete(claim);
    if (claims.size === 0) recruitChainClaimsV3.delete(origin);
  }
}

/** Cancel the canonical carrier before payment. This is itself one native commit and leaves a
 * reservation tombstone, so a late finalize or old sibling cannot recreate it. */
export function cancelDuelRecruitTokenOnChainV3(state: DuelCanonicalPlayingStateV2,
  reservation: DuelRecruitTokenChainReservationV3): DuelRecruitTokenChainCancelV3 {
  const liveAuthority = capability(state);
  const entry = canonicalReservationV3(reservation);
  if (entry.busy) entry.poisoned = true;
  check(!entry.busy && !entry.poisoned && !entry.used && !entry.cancelled,
    'unknown, busy, poisoned, finalized or cancelled V3 reservation');
  check(capability(state).origin === entry.origin && state === entry.chainHead,
    'V3 cancel requires the exact canonical Chain head');
  check(state.frame.pendingPayment === null, 'V3 Chain cancel requires a closed payment window');
  const next = commitDuelPlayingMutationInternalV2(state, draft => ({
    match: { ...draft, tokenChain: (draft.tokenChain ?? []).filter(item =>
      item.tokenUID !== entry.request.tokenUID) }, transitions: [],
  }), { inventory: liveAuthority.inventory, tokenHistory: liveAuthority.tokenHistory,
    allowCanonicalRecruitChain: true });
  entry.cancelled = true;
  return Object.freeze({ state: next, match: next, reservation });
}

/** Complete a paid canonical Chain token. The source identity is re-attested on the exact
 * descendant head, then the shared V2 native token birth commits board + token history once. */
export function finalizeDuelRecruitTokenFromChainV3(state: DuelCanonicalPlayingStateV2,
  reservation: DuelRecruitTokenChainReservationV3,
  attestor: DuelTokenSourceAttestorV2): DuelCanonicalPlayingStateV2 {
  const entry = canonicalReservationV3(reservation);
  if (entry.busy) entry.poisoned = true;
  check(!entry.busy && !entry.poisoned && !entry.used && !entry.cancelled,
    'unknown, busy, poisoned, finalized or cancelled V3 reservation');
  check(capability(state).origin === entry.origin, 'foreign V3 canonical Chain origin');
  check(state.frame.pendingPayment === null, 'V3 Chain Finalize requires a closed payment window');
  inspectDuelNativeCommitPathV2(entry.chainHead, state);
  canonicalEntryForReservationV3(entry, state);
  entry.busy = true;
  try {
    const { attestation, authority: creationAuthority } = attestTokenSource(state, entry.request, attestor);
    check(!entry.poisoned && same(attestation, entry.attestation), 'V3 Chain source attestation drift');
    const next = createDuelRecruitUnitInternalV2(state, entry.request, creationAuthority,
      undefined, entry.request.tokenUID);
    check(next !== state && !next.tokenChain?.some(item => item.tokenUID === entry.request.tokenUID),
      'V3 Chain Finalize did not consume canonical carrier');
    entry.used = true;
    return next;
  } finally {
    entry.busy = false;
  }
}

export function inspectDuelRecruitTokenOnChainV3(reservation: DuelRecruitTokenChainReservationV3):
  Readonly<{ tokenUID: string; sourceEffectId: string; eventId: string; ownerPlayerId: string;
    locationId: string; zoneEpoch: null; status: 'on-chain' | 'finalized' | 'cancelled' }> {
  const entry = canonicalReservationV3(reservation);
  const status = entry.cancelled ? 'cancelled' : entry.used ? 'finalized' : 'on-chain';
  return Object.freeze({ tokenUID: entry.request.tokenUID, sourceEffectId: entry.request.sourceEffectId,
    eventId: entry.request.eventId, ownerPlayerId: entry.request.controllerPlayerId,
    locationId: entry.request.locationId, zoneEpoch: null, status });
}

// Descriptive aliases for callers that prefer to make the canonical carrier explicit.
export const beginDuelRecruitTokenOnCanonicalChainV3 = beginDuelRecruitTokenOnChainV3;
export const finalizeDuelRecruitTokenFromCanonicalChainV3 = finalizeDuelRecruitTokenFromChainV3;
export const cancelDuelRecruitTokenOnCanonicalChainV3 = cancelDuelRecruitTokenOnChainV3;

export const createDuelRecruitV2 = createDuelRecruitUnitV2;

/** Kill a Recruit token and retire its UID. No physical card is placed in Trash. */
export function killRetireDuelUnitTokenV2(state: DuelCanonicalPlayingStateV2,
  uid: string): DuelCanonicalPlayingStateV2 {
  const liveAuthority = capability(state);
  const token = liveAuthority.tokenHistory.births.find(entry => entry.tokenUID === uid);
  check(token?.kind === 'recruit', 'Unit token has no independently attested Recruit birth');
  check(Object.hasOwn(liveAuthority.inventory.unitTokenOwnersByUID, uid), 'Recruit is not a live trusted token');
  const unit = state.board.units.find(entry => entry.objectId === uid);
  check(unit && state.unitMeta[uid]?.trait.kind === 'token', 'Recruit token is not on the board');
  const nextProof = tokenInventory(liveAuthority.inventory, 'recruit', uid,
    token.effectControllerPlayerId, false);
  const nextHistory = tokenRetire(liveAuthority.tokenHistory, uid, 'kill-recruit', state.stateVersion + 1);
  return commitDuelPlayingMutationInternalV2(state, draft => {
    const board = removeDuelUnit(draft.board, uid);
    const unitMeta = Object.fromEntries(Object.entries(draft.unitMeta).filter(([key]) => key !== uid));
    return { match: { ...draft, board, unitMeta,
      retiredUnitTokenUIDs: [...draft.retiredUnitTokenUIDs, uid] }, transitions: [] };
  }, { inventory: nextProof, tokenHistory: nextHistory });
}

export const retireDuelRecruitUnitV2 = killRetireDuelUnitTokenV2;

/** Trusted Rune channel: actual top-of-deck UIDs, not inferred from a final resource count. */
export function channelDuelRunesV2(state: DuelCanonicalPlayingStateV2, actor: string,
  count: number, readied = true): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationV2(state, draft => {
    const index = draft.resources.players.findIndex(p => p.playerId === actor);
    check(index >= 0, 'unknown channeling actor');
    const taken = draft.resources.players[index]!.runeDeck.slice(0, count);
    const resources = channelDuelRunes(draft.resources, actor, count, readied);
    const locationId = resources.bases[index]!.locationId;
    return { match: { ...draft, resources }, transitions: taken.map(r => ({ uid: r.uid,
      from: z('rune-deck', actor), to: baseZone(locationId) })) };
  });
}
/** Only current physical references survive; pre-exit triggers need their own future source proof. */
export function referenceDuelPhysicalCardV2(state: DuelCanonicalPlayingStateV2, uid: string): DuelPhysicalReference {
  return referenceDuelPhysicalCard(candidate(state), authority(state), uid);
}
export function assertCurrentDuelPhysicalReferenceV2(state: DuelCanonicalPlayingStateV2,
  ref: DuelPhysicalReference): void {
  assertCurrentDuelPhysicalReference(candidate(state), authority(state), ref);
}
const objectViewCacheV2 = new WeakMap<object, readonly DuelObjectView[]>();
export function enumerateDuelObjectsV2(state: DuelCanonicalPlayingStateV2): readonly DuelObjectView[] {
  // Admission deeply freezes this exact state. A successor, sibling or DATA
  // clone is never this cache key; always verify the native authority first.
  const owner = capability(state), inventory = owner.inventory;
  if (!immutableObjectViewOriginsV2.has(owner.origin))
    return enumerateDuelObjects(candidate(state), inventory);
  const cached = objectViewCacheV2.get(state);
  if (cached) return cached;
  const views = enumerateDuelObjects(candidate(state), inventory);
  objectViewCacheV2.set(state, views);
  return views;
}
export function attachDuelGearV2(state: DuelCanonicalPlayingStateV2, uid: string,
  hostUID: string | null): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, gears: attachDuelGear(candidate(draft), authority(state), uid, hostUID).gears },
    transitions: [],
  }));
}
export function moveDuelUnitV2(state: DuelCanonicalPlayingStateV2, uid: string,
  locationId: string): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationV2(state, draft => {
    const unit = draft.board.units.find(u => u.objectId === uid);
    check(unit, 'unknown moving Unit');
    const board = relocateDuelUnit(draft.board, uid, locationId);
    const followed = followDuelAttachedHostMove(candidate(draft), authority(state), board);
    const from: DuelPhysicalZone = draft.board.bases.some(b => b.locationId === unit.locationId)
      ? baseZone(unit.locationId) : { kind: 'board-battlefield', locationId: unit.locationId };
    const to: DuelPhysicalZone = board.bases.some(b => b.locationId === locationId)
      ? baseZone(locationId) : { kind: 'board-battlefield', locationId };
    const attachedSteps: DuelPhysicalZoneTransition[] = followed.gears
      .filter(g => g.locationId !== draft.gears.find(before => before.uid === g.uid)!.locationId)
      .map(g => ({ uid: g.uid, from: draft.board.bases.some(b =>
        b.locationId === draft.gears.find(old => old.uid === g.uid)!.locationId)
        ? baseZone(draft.gears.find(old => old.uid === g.uid)!.locationId)
        : { kind: 'board-battlefield', locationId: draft.gears.find(old => old.uid === g.uid)!.locationId },
      to: followed.board.bases.some(b => b.locationId === g.locationId) ? baseZone(g.locationId)
        : { kind: 'board-battlefield', locationId: g.locationId } }));
    return { match: { ...draft, board: followed.board, gears: followed.gears },
      transitions: [{ uid, from, to }, ...attachedSteps] };
  });
}
/** Source-bound entry. No client card-type flag or zone-inferred owner accepted. */
export function registerDuelGearFromTrustedSourceV2(state: DuelCanonicalPlayingStateV2, uid: string,
  controllerPlayerId: string, locationId: string, readied = true): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationV2(state, draft => {
    const origin = draft.provenance.originalPhysicalCards.find(c => c.uid === uid);
    check(origin?.cardType === 'Gear' && draft.physicalCardsByUID[uid]?.cardId === origin.cardId,
      'Gear requires trusted catalog printing and creation');
    const player = draft.players.find(p => p.hand.some(c => c.uid === uid));
    check(player, 'Gear must be played from a real hand');
    check(draft.board.bases.some(b => b.locationId === locationId && b.ownerPlayerId === controllerPlayerId) ||
      draft.board.battlefields.some(b => b.locationId === locationId), 'unapproved Gear board location');
    check(draft.board.playerIds.includes(controllerPlayerId) && typeof readied === 'boolean', 'trusted Gear entry');
    const gear: DuelGearAuthority = { uid, controllerPlayerId, locationId, readied, attachedToUID: null };
    return { match: { ...draft, players: draft.players.map(p => ({ ...p,
      hand: p.hand.filter(c => c.uid !== uid) })) as unknown as DuelCanonicalPlayingStateV2['players'],
      gears: [...draft.gears, gear] },
    transitions: [{ uid, from: z('hand', player.playerId), to: draft.board.bases.some(b => b.locationId === locationId)
      ? baseZone(locationId) : { kind: 'board-battlefield', locationId } }] };
  });
}
/** Remove Gear with attachment descendants detached in their original location first. */
export function removeDuelGearToOwnerTrashV2(state: DuelCanonicalPlayingStateV2,
  uid: string): DuelCanonicalPlayingStateV2 {
  return commitDuelPlayingMutationV2(state, draft => {
    const gear = draft.gears.find(g => g.uid === uid);
    check(gear, 'unknown Gear');
    const detached = detachDuelGearsBeforeHostExit(candidate(draft), authority(state), uid);
    const origin = draft.physicalCardsByUID[uid]!;
    const players = draft.players.map(p => p.playerId === origin.ownerPlayerId
      ? { ...p, trash: [...p.trash, { uid, cardId: origin.cardId }] } : p) as
      unknown as DuelCanonicalPlayingStateV2['players'];
    return { match: { ...draft, gears: detached.gears.filter(g => g.uid !== uid), players },
      transitions: [{ uid, from: draft.board.bases.some(b => b.locationId === gear.locationId)
        ? baseZone(gear.locationId) : { kind: 'board-battlefield', locationId: gear.locationId },
        to: z('trash', origin.ownerPlayerId) }] };
  });
}
