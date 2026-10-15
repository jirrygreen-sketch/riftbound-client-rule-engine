// INTERNAL V2 phase-source closure audit.
//
// This module deliberately does not advance a phase, execute an effect, or mint a
// token.  It only builds the complete private source candidate set at a trusted
// boundary and accepts a catalog-bound whole-program proof for each candidate.
// The caller of the factories below is an internal trusted runtime.  A WeakMap
// handle is an opaque capability, not authentication of network JSON.
import {
  enumerateDuelObjectsV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import type {
  DuelObjectView,
  DuelPhysicalZone,
} from './permanent-state.js';
import type { DuelPhaseEventV2 } from './phase-source-authority-v2.js';

export type DuelPhaseSourceClosurePhaseV2 = DuelPhaseEventV2;
export type DuelPhaseSourceClosureEventV2 =
  | DuelPhaseEventV2
  | 'pre-exit'
  | 'zone-transition'
  | 'draw-subject'
  | 'continuous'
  | 'chain'
  | 'effect-queue'
  | 'fepr-outstanding';

const PHASES: readonly string[] = [
  'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
  'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
];
const EVENTS: readonly string[] = [
  ...PHASES, 'pre-exit', 'zone-transition', 'draw-subject', 'continuous',
  'chain', 'effect-queue', 'fepr-outstanding',
];
const OBJECT_KINDS: readonly DuelObjectView['kind'][] = [
  'card', 'champion', 'legend', 'battlefield', 'unit', 'gear', 'rune', 'gold',
];
const RUNTIME_KINDS = [
  'continuous-effect', 'replacement-effect', 'triggered-effect',
  'chain-effect', 'queued-effect', 'fepr-outstanding',
] as const;
const LEDGER_NAMES = ['activeEffects', 'chain', 'effectQueue', 'feprOutstanding'] as const;
type LedgerNameV2 = (typeof LEDGER_NAMES)[number];

export type DuelPhaseSourceClosureCandidateKindV2 = DuelObjectView['kind'] | 'effect';

export interface DuelPhaseSourceClosureClockV2 {
  readonly stateVersion: number;
  readonly eventSeq: number;
}

export interface DuelPhaseSourceClosureContextV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly turn: number;
  readonly taskId: string;
  readonly phase: DuelPhaseSourceClosurePhaseV2;
  readonly event: DuelPhaseSourceClosureEventV2;
  readonly clock: DuelPhaseSourceClosureClockV2;
}

/** A private source candidate.  It may include hidden-zone card identity, but
 * this object must never be copied into a public player projection. */
export interface DuelPhaseSourceClosureCandidateV2 {
  readonly uid: string;
  readonly kind: DuelPhaseSourceClosureCandidateKindV2;
  readonly cardId: string | null;
  readonly zoneEpoch: number | null;
  readonly controllerPlayerId: string | null;
  readonly zone: DuelPhysicalZone;
  readonly ownerPlayerId: string | null;
  readonly locationId: string | null;
  readonly attachedToUID: string | null;
  readonly visibility: 'internal';
  readonly carrier: 'object' | 'runtime-effect' | 'pre-exit';
  readonly sourceUID?: string;
  readonly effectId?: string;
  readonly runtimeKind?: (typeof RUNTIME_KINDS)[number];
}

export interface DuelPhaseSourceClosureRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly source: DuelPhaseSourceClosureCandidateV2;
  /** The reference comes from the independent catalog index or protected
   * token journal.  A producer must not choose a reference from card text. */
  readonly expectedProgramReference: string;
  readonly referenceKind: 'printing' | 'gold-cr-intrinsic' | 'recruit-birth' | 'runtime-effect';
}

export interface DuelPhaseSourceClosureCoverageV2 {
  readonly wholeProgram: true;
  readonly zoneScope: 'whole-program';
  readonly eventScope: 'whole-program';
  readonly static: true;
  readonly replacements: true;
  readonly continuous: true;
  readonly triggers: true;
}

/** `decision` is the result of inspecting the whole program in this source
 * zone and for this event.  It is not a keyword match or a client flag. */
export interface DuelPhaseSourceClosureProgramEvidenceV2 {
  readonly status: 'complete';
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly turn: number;
  readonly taskId: string;
  readonly phase: DuelPhaseSourceClosurePhaseV2;
  readonly event: DuelPhaseSourceClosureEventV2;
  readonly clock: DuelPhaseSourceClosureClockV2;
  readonly uid: string;
  readonly kind: DuelPhaseSourceClosureCandidateKindV2;
  readonly cardId: string | null;
  readonly zoneEpoch: number | null;
  readonly controllerPlayerId: string | null;
  readonly zone: DuelPhysicalZone;
  readonly programReference: string;
  readonly referenceKind: 'printing' | 'gold-cr-intrinsic' | 'recruit-birth' | 'runtime-effect';
  readonly proofId: string;
  readonly eventSupported: true;
  readonly decision: 'active' | 'inactive' | 'handler';
  readonly coverage: DuelPhaseSourceClosureCoverageV2;
}

export interface DuelPhaseSourceClosureUnknownEvidenceV2 {
  readonly status: 'unknown';
  readonly reason?: string;
}
export type DuelPhaseSourceClosureProgramResultV2 =
  | DuelPhaseSourceClosureProgramEvidenceV2
  | DuelPhaseSourceClosureUnknownEvidenceV2;
export type DuelPhaseSourceClosureProgramProducerV2 =
  (request: DuelPhaseSourceClosureRequestV2) => DuelPhaseSourceClosureProgramResultV2;

export interface DuelPhaseSourceClosureProgramIndexV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly printings: readonly {
    readonly cardId: string;
    readonly programReference: string;
  }[];
}

export interface DuelPhaseSourceClosureRegistryV2 {
  readonly _duelPhaseSourceClosureRegistryV2: unique symbol;
}

interface RegistryEntryV2 {
  readonly producer: DuelPhaseSourceClosureProgramProducerV2;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly references: ReadonlyMap<string, string>;
}
const registries = new WeakMap<object, RegistryEntryV2>();

export type DuelPhaseSourceClosureTokenReferenceKindV2 =
  | 'gold-cr-intrinsic'
  | 'recruit-birth';

/** Protected source proof for a null-cardId runtime token.  No catalog
 * printing is inferred for these carriers. */
export interface DuelPhaseSourceClosureTokenReferenceV2 {
  readonly uid: string;
  readonly kind: 'gold' | 'recruit';
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly sourceMode: 'current' | 'pre-exit';
  readonly controllerPlayerId: string;
  readonly referenceKind: DuelPhaseSourceClosureTokenReferenceKindV2;
  readonly programReference: string;
  readonly sourceProofId: string;
}

export interface DuelPhaseSourceClosureRuntimeEntryV2 {
  readonly effectId: string;
  readonly kind: (typeof RUNTIME_KINDS)[number];
  readonly eventId: string;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly cardId: string | null;
  readonly controllerPlayerId: string | null;
  readonly zone: DuelPhysicalZone;
  readonly programReference: string;
}

export interface DuelPhaseSourceClosureLedgerV2 {
  readonly status: 'empty' | 'entries';
  readonly ledgerId: string;
  readonly revision: number;
  readonly proofId: string;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly turn: number;
  readonly taskId: string;
  readonly clock: DuelPhaseSourceClosureClockV2;
  readonly entries: readonly DuelPhaseSourceClosureRuntimeEntryV2[];
}

export interface DuelPhaseSourceClosureTransitionV2 {
  readonly eventId: string;
  readonly uid: string;
  readonly from: DuelPhysicalZone;
  readonly to: DuelPhysicalZone;
  readonly fromZoneEpoch: number;
  readonly toZoneEpoch: number;
  readonly proofId: string;
}

export interface DuelPhaseSourceClosurePreExitV2 {
  readonly eventId: string;
  readonly source: DuelPhaseSourceClosureCandidateV2;
  readonly transition: DuelPhaseSourceClosureTransitionV2;
  readonly proofId: string;
}

export interface DuelPhaseSourceClosureDrawSubjectV2 {
  readonly eventId: string;
  readonly uid: string;
  readonly from: DuelPhysicalZone;
  readonly to: DuelPhysicalZone;
  readonly fromZoneEpoch: number;
  readonly toZoneEpoch: number;
  readonly proofId: string;
}

export interface DuelPhaseSourceClosureJournalInputV2 extends DuelPhaseSourceClosureContextV2 {
  readonly tokenReferences: readonly DuelPhaseSourceClosureTokenReferenceV2[];
  readonly preExitSources: readonly DuelPhaseSourceClosurePreExitV2[];
  readonly drawSubjects: readonly DuelPhaseSourceClosureDrawSubjectV2[];
  readonly transitions: readonly DuelPhaseSourceClosureTransitionV2[];
  readonly activeEffects: DuelPhaseSourceClosureLedgerV2;
  readonly chain: DuelPhaseSourceClosureLedgerV2;
  readonly effectQueue: DuelPhaseSourceClosureLedgerV2;
  readonly feprOutstanding: DuelPhaseSourceClosureLedgerV2;
}

export interface DuelPhaseSourceClosureJournalV2 {
  readonly _duelPhaseSourceClosureJournalV2: unique symbol;
}

interface JournalEntryV2 {
  readonly input: DuelPhaseSourceClosureJournalInputV2;
}
const journals = new WeakMap<object, JournalEntryV2>();

export interface DuelPhaseSourceClosureInspectionV2 {
  readonly status: 'ready' | 'pending';
  /** All actual object carriers, including hand/main-deck/trash/champion-zone/
   * rune-deck objects, plus protected pre-exit and runtime-ledger candidates. */
  readonly candidates: readonly DuelPhaseSourceClosureCandidateV2[];
  /** Alias retained for source-audit callers.  It is never a public projection. */
  readonly sources: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly eventSources: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly activeSources: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly handlers: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly runtimeSources: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly reason?: string;
  readonly drawSubjects?: readonly DuelPhaseSourceClosureCandidateV2[];
  readonly preExitSources?: readonly DuelPhaseSourceClosureCandidateV2[];
}

function fail(
  candidates: readonly DuelPhaseSourceClosureCandidateV2[],
  reason: string,
  extras: Partial<DuelPhaseSourceClosureInspectionV2> = {},
): DuelPhaseSourceClosureInspectionV2 {
  return {
    status: 'pending', candidates, sources: candidates, eventSources: [], activeSources: [],
    handlers: [], runtimeSources: [], reason, ...extras,
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) &&
    (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null);
}
function exactRecord(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new TypeError(`${label} record`);
  const actual = Reflect.ownKeys(raw);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(raw, key) || !('value' in Object.getOwnPropertyDescriptor(raw, key)!)))
    throw new TypeError(`${label} keys/accessors`);
  return raw;
}
function exactRecordOptional(raw: unknown, keys: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new TypeError(`${label} record`);
  const actual = Reflect.ownKeys(raw);
  if (actual.some(key => typeof key !== 'string' || (!keys.includes(key) && !optional.includes(key))) ||
      keys.some(key => !Object.hasOwn(raw, key)) ||
      actual.some(key => typeof key === 'string' && !('value' in Object.getOwnPropertyDescriptor(raw, key)!)))
    throw new TypeError(`${label} keys/accessors`);
  return raw;
}
function list(raw: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
      Reflect.ownKeys(raw).length !== raw.length + 1 ||
      Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
        .some(descriptor => descriptor === undefined || !('value' in descriptor)))
    throw new TypeError(`${label} array`);
  return raw;
}
function text(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new TypeError(`${label} text`);
  return raw;
}
function integer(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) throw new TypeError(`${label} integer`);
  return raw;
}
function nullableText(raw: unknown, label: string): string | null {
  return raw === null ? null : text(raw, label);
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function copiedZone(raw: DuelPhysicalZone): DuelPhysicalZone {
  return 'locationId' in raw
    ? { kind: raw.kind, locationId: raw.locationId }
    : { kind: raw.kind, zonePlayerId: raw.zonePlayerId };
}
function zone(raw: unknown, label: string): DuelPhysicalZone {
  if (!isRecord(raw)) throw new TypeError(`${label} zone`);
  if (raw.kind === 'board-base' || raw.kind === 'board-battlefield') {
    const parsed = exactRecord(raw, ['kind', 'locationId'], label);
    return { kind: parsed.kind as 'board-base' | 'board-battlefield', locationId: text(parsed.locationId, `${label}.locationId`) };
  }
  if (raw.kind !== 'legend-zone' && raw.kind !== 'champion-zone' && raw.kind !== 'hand' &&
      raw.kind !== 'main-deck' && raw.kind !== 'trash' && raw.kind !== 'rune-deck' && raw.kind !== 'chain')
    throw new TypeError(`${label}.kind`);
  const parsed = exactRecord(raw, ['kind', 'zonePlayerId'], label);
  return { kind: parsed.kind as 'legend-zone' | 'champion-zone' | 'hand' | 'main-deck' | 'trash' | 'rune-deck' | 'chain',
    zonePlayerId: text(parsed.zonePlayerId, `${label}.zonePlayerId`) };
}
function zoneKey(value: DuelPhysicalZone): string {
  return 'locationId' in value
    ? JSON.stringify([value.kind, value.locationId])
    : JSON.stringify([value.kind, value.zonePlayerId]);
}
function nonBoard(value: DuelPhysicalZone): boolean {
  return value.kind !== 'board-base' && value.kind !== 'board-battlefield' && value.kind !== 'legend-zone';
}
function expectedEpoch(from: DuelPhysicalZone, to: DuelPhysicalZone, fromEpoch: number): number {
  return fromEpoch + (nonBoard(from) || nonBoard(to) ? 1 : 0);
}
function freezeDeep(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) freezeDeep(descriptor.value, seen);
  }
  Object.freeze(value);
}
function validContext(raw: unknown): DuelPhaseSourceClosureContextV2 {
  const r = exactRecord(raw, [
    'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'phase', 'event', 'clock',
  ], 'source-closure context');
  const phase = text(r.phase, 'context.phase') as DuelPhaseSourceClosurePhaseV2;
  const event = text(r.event, 'context.event') as DuelPhaseSourceClosureEventV2;
  if (!PHASES.includes(phase) || !EVENTS.includes(event)) throw new TypeError('context phase/event');
  if (PHASES.includes(event) && phase !== event && !(event === 'draw' && phase === 'draw'))
    throw new TypeError('context phase/event mismatch');
  const c = exactRecord(r.clock, ['stateVersion', 'eventSeq'], 'context.clock');
  return {
    matchId: text(r.matchId, 'context.matchId'), dataVersion: text(r.dataVersion, 'context.dataVersion'),
    catalogDigest: text(r.catalogDigest, 'context.catalogDigest'), turn: integer(r.turn, 'context.turn'),
    taskId: text(r.taskId, 'context.taskId'), phase, event,
    clock: { stateVersion: integer(c.stateVersion, 'context.clock.stateVersion'), eventSeq: integer(c.eventSeq, 'context.clock.eventSeq') },
  };
}
function contextMatches(a: DuelPhaseSourceClosureJournalInputV2, b: DuelPhaseSourceClosureContextV2): boolean {
  return a.matchId === b.matchId && a.dataVersion === b.dataVersion &&
    a.catalogDigest === b.catalogDigest && a.turn === b.turn && a.taskId === b.taskId &&
    a.phase === b.phase && a.event === b.event && same(a.clock, b.clock);
}
function candidateFromView(view: DuelObjectView): DuelPhaseSourceClosureCandidateV2 {
  return {
    uid: view.uid, kind: view.kind, cardId: view.cardId, zoneEpoch: view.zoneEpoch,
    controllerPlayerId: view.controllerPlayerId, zone: copiedZone(view.zone),
    ownerPlayerId: view.ownerPlayerId, locationId: view.locationId,
    attachedToUID: view.attachedToUID, visibility: 'internal', carrier: 'object',
  };
}
function candidateRecord(raw: unknown, label: string, carrier: 'pre-exit' | 'runtime-effect' = 'pre-exit'):
  DuelPhaseSourceClosureCandidateV2 {
  const r = exactRecord(raw, [
    'uid', 'kind', 'cardId', 'zoneEpoch', 'controllerPlayerId', 'zone', 'ownerPlayerId',
    'locationId', 'attachedToUID', 'visibility', 'carrier',
  ], label);
  if (!OBJECT_KINDS.includes(r.kind as DuelObjectView['kind']) || r.visibility !== 'internal' || r.carrier !== carrier)
    throw new TypeError(`${label} kind/carrier`);
  const parsed: DuelPhaseSourceClosureCandidateV2 = {
    uid: text(r.uid, `${label}.uid`), kind: r.kind as DuelObjectView['kind'],
    cardId: nullableText(r.cardId, `${label}.cardId`), zoneEpoch: r.zoneEpoch === null ? null : integer(r.zoneEpoch, `${label}.zoneEpoch`),
    controllerPlayerId: nullableText(r.controllerPlayerId, `${label}.controllerPlayerId`), zone: zone(r.zone, `${label}.zone`),
    ownerPlayerId: nullableText(r.ownerPlayerId, `${label}.ownerPlayerId`), locationId: nullableText(r.locationId, `${label}.locationId`),
    attachedToUID: nullableText(r.attachedToUID, `${label}.attachedToUID`), visibility: 'internal', carrier,
  };
  if (parsed.zoneEpoch === null && parsed.cardId !== null) {
    // A null epoch is legal only for a runtime token or for an explicit pre-exit
    // source whose protected journal is the authority.  The latter is checked later.
  }
  return parsed;
}
function candidateMatches(a: DuelPhaseSourceClosureCandidateV2, b: DuelPhaseSourceClosureCandidateV2): boolean {
  return a.uid === b.uid && a.kind === b.kind && a.cardId === b.cardId &&
    a.zoneEpoch === b.zoneEpoch && a.controllerPlayerId === b.controllerPlayerId &&
    same(a.zone, b.zone);
}
function clock(raw: unknown, label: string): DuelPhaseSourceClosureClockV2 {
  const r = exactRecord(raw, ['stateVersion', 'eventSeq'], label);
  return { stateVersion: integer(r.stateVersion, `${label}.stateVersion`), eventSeq: integer(r.eventSeq, `${label}.eventSeq`) };
}
function transition(raw: unknown, label: string): DuelPhaseSourceClosureTransitionV2 {
  const r = exactRecord(raw, ['eventId', 'uid', 'from', 'to', 'fromZoneEpoch', 'toZoneEpoch', 'proofId'], label);
  const from = zone(r.from, `${label}.from`), to = zone(r.to, `${label}.to`);
  const fromZoneEpoch = integer(r.fromZoneEpoch, `${label}.fromZoneEpoch`);
  const toZoneEpoch = integer(r.toZoneEpoch, `${label}.toZoneEpoch`);
  if (zoneKey(from) === zoneKey(to) || expectedEpoch(from, to, fromZoneEpoch) !== toZoneEpoch)
    throw new TypeError(`${label} epoch/unchanged transition`);
  return { eventId: text(r.eventId, `${label}.eventId`), uid: text(r.uid, `${label}.uid`),
    from, to, fromZoneEpoch, toZoneEpoch, proofId: text(r.proofId, `${label}.proofId`) };
}
function tokenReference(raw: unknown, label: string): DuelPhaseSourceClosureTokenReferenceV2 {
  const r = exactRecord(raw, [
    'uid', 'kind', 'sourceEffectId', 'eventId', 'sourceUID', 'sourceZoneEpoch', 'sourceMode',
    'controllerPlayerId', 'referenceKind', 'programReference', 'sourceProofId',
  ], label);
  if (r.kind !== 'gold' && r.kind !== 'recruit') throw new TypeError(`${label}.kind`);
  if ((r.kind === 'gold' && r.referenceKind !== 'gold-cr-intrinsic') ||
      (r.kind === 'recruit' && r.referenceKind !== 'recruit-birth')) throw new TypeError(`${label}.referenceKind`);
  if (r.sourceMode !== 'current' && r.sourceMode !== 'pre-exit') throw new TypeError(`${label}.sourceMode`);
  return {
    uid: text(r.uid, `${label}.uid`), kind: r.kind, sourceEffectId: text(r.sourceEffectId, `${label}.sourceEffectId`),
    eventId: text(r.eventId, `${label}.eventId`), sourceUID: text(r.sourceUID, `${label}.sourceUID`),
    sourceZoneEpoch: integer(r.sourceZoneEpoch, `${label}.sourceZoneEpoch`), sourceMode: r.sourceMode,
    controllerPlayerId: text(r.controllerPlayerId, `${label}.controllerPlayerId`),
    referenceKind: r.referenceKind as DuelPhaseSourceClosureTokenReferenceKindV2,
    programReference: text(r.programReference, `${label}.programReference`),
    sourceProofId: text(r.sourceProofId, `${label}.sourceProofId`),
  };
}
function runtimeEntry(raw: unknown, label: string): DuelPhaseSourceClosureRuntimeEntryV2 {
  const r = exactRecord(raw, [
    'effectId', 'kind', 'eventId', 'sourceUID', 'sourceZoneEpoch', 'cardId',
    'controllerPlayerId', 'zone', 'programReference',
  ], label);
  if (!RUNTIME_KINDS.includes(r.kind as (typeof RUNTIME_KINDS)[number])) throw new TypeError(`${label}.kind`);
  return {
    effectId: text(r.effectId, `${label}.effectId`), kind: r.kind as (typeof RUNTIME_KINDS)[number],
    eventId: text(r.eventId, `${label}.eventId`), sourceUID: text(r.sourceUID, `${label}.sourceUID`),
    sourceZoneEpoch: integer(r.sourceZoneEpoch, `${label}.sourceZoneEpoch`), cardId: nullableText(r.cardId, `${label}.cardId`),
    controllerPlayerId: nullableText(r.controllerPlayerId, `${label}.controllerPlayerId`), zone: zone(r.zone, `${label}.zone`),
    programReference: text(r.programReference, `${label}.programReference`),
  };
}
function ledger(raw: unknown, name: LedgerNameV2): DuelPhaseSourceClosureLedgerV2 {
  const r = exactRecord(raw, [
    'status', 'ledgerId', 'revision', 'proofId', 'matchId', 'dataVersion', 'catalogDigest',
    'turn', 'taskId', 'clock', 'entries',
  ], `${name} ledger`);
  if (r.status !== 'empty' && r.status !== 'entries') throw new TypeError(`${name} ledger.status`);
  const entries = list(r.entries, `${name} ledger.entries`).map((item, i) => runtimeEntry(item, `${name}.entries[${i}]`)) as DuelPhaseSourceClosureRuntimeEntryV2[];
  if ((r.status === 'empty' && entries.length !== 0) || (r.status === 'entries' && entries.length === 0))
    throw new TypeError(`${name} ledger empty/entries mismatch`);
  const parsed = {
    status: r.status, ledgerId: text(r.ledgerId, `${name}.ledgerId`), revision: integer(r.revision, `${name}.revision`),
    proofId: text(r.proofId, `${name}.proofId`), matchId: text(r.matchId, `${name}.matchId`),
    dataVersion: text(r.dataVersion, `${name}.dataVersion`), catalogDigest: text(r.catalogDigest, `${name}.catalogDigest`),
    turn: integer(r.turn, `${name}.turn`), taskId: text(r.taskId, `${name}.taskId`), clock: clock(r.clock, `${name}.clock`), entries,
  } as DuelPhaseSourceClosureLedgerV2;
  return parsed;
}
function validateLedgerKinds(value: DuelPhaseSourceClosureLedgerV2, name: LedgerNameV2): void {
  const allowed: readonly string[] = name === 'activeEffects'
    ? ['continuous-effect', 'replacement-effect', 'triggered-effect']
    : name === 'chain' ? ['chain-effect']
      : name === 'effectQueue' ? ['queued-effect'] : ['fepr-outstanding'];
  if (value.entries.some(entry => !allowed.includes(entry.kind))) throw new TypeError(`${name} ledger entry kind`);
}
function journalInput(raw: unknown): DuelPhaseSourceClosureJournalInputV2 {
  const r = exactRecord(raw, [
    'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'phase', 'event', 'clock',
    'tokenReferences', 'preExitSources', 'drawSubjects', 'transitions',
    'activeEffects', 'chain', 'effectQueue', 'feprOutstanding',
  ], 'source-closure journal');
  const context = validContext({
    matchId: r.matchId, dataVersion: r.dataVersion, catalogDigest: r.catalogDigest,
    turn: r.turn, taskId: r.taskId, phase: r.phase, event: r.event, clock: r.clock,
  });
  const tokenReferences = list(r.tokenReferences, 'tokenReferences').map((item, i) => tokenReference(item, `tokenReferences[${i}]`));
  const preExitSources = list(r.preExitSources, 'preExitSources').map((item, i) => {
    const p = exactRecord(item, ['eventId', 'source', 'transition', 'proofId'], `preExitSources[${i}]`);
    return { eventId: text(p.eventId, `preExitSources[${i}].eventId`), source: candidateRecord(p.source, `preExitSources[${i}].source`, 'pre-exit'),
      transition: transition(p.transition, `preExitSources[${i}].transition`), proofId: text(p.proofId, `preExitSources[${i}].proofId`) };
  }) as DuelPhaseSourceClosurePreExitV2[];
  const drawSubjects = list(r.drawSubjects, 'drawSubjects').map((item, i) => {
    const d = transition(item, `drawSubjects[${i}]`);
    if (d.from.kind !== 'main-deck' || d.to.kind !== 'hand') throw new TypeError(`drawSubjects[${i}] must be main-deck to hand`);
    return d;
  }) as DuelPhaseSourceClosureDrawSubjectV2[];
  const transitions = list(r.transitions, 'transitions').map((item, i) => transition(item, `transitions[${i}]`));
  const activeEffects = ledger(r.activeEffects, 'activeEffects');
  const chain = ledger(r.chain, 'chain');
  const effectQueue = ledger(r.effectQueue, 'effectQueue');
  const feprOutstanding = ledger(r.feprOutstanding, 'feprOutstanding');
  validateLedgerKinds(activeEffects, 'activeEffects'); validateLedgerKinds(chain, 'chain');
  validateLedgerKinds(effectQueue, 'effectQueue'); validateLedgerKinds(feprOutstanding, 'feprOutstanding');
  return { ...context, tokenReferences, preExitSources, drawSubjects, transitions,
    activeEffects, chain, effectQueue, feprOutstanding };
}

/** Register a trusted whole-program producer.  This factory is an internal
 * capability boundary; it does not authenticate an index, an IR, or network data. */
export function createDuelPhaseSourceClosureRegistryV2(
  index: DuelPhaseSourceClosureProgramIndexV2,
  producer: DuelPhaseSourceClosureProgramProducerV2,
): DuelPhaseSourceClosureRegistryV2 {
  if (!isRecord(index) || typeof producer !== 'function') throw new TypeError('trusted closure producer required');
  const parsed = exactRecord(index, ['matchId', 'dataVersion', 'catalogDigest', 'printings'], 'program index');
  const references = new Map<string, string>();
  for (const [i, raw] of list(parsed.printings, 'program index.printings').entries()) {
    const entry = exactRecord(raw, ['cardId', 'programReference'], `program index.printings[${i}]`);
    const cardId = text(entry.cardId, `program index.printings[${i}].cardId`);
    const programReference = text(entry.programReference, `program index.printings[${i}].programReference`);
    if (references.has(cardId)) throw new TypeError(`duplicate program index printing ${cardId}`);
    references.set(cardId, programReference);
  }
  const handle = Object.freeze(Object.create(null)) as DuelPhaseSourceClosureRegistryV2;
  registries.set(handle, { producer, matchId: text(parsed.matchId, 'program index.matchId'),
    dataVersion: text(parsed.dataVersion, 'program index.dataVersion'),
    catalogDigest: text(parsed.catalogDigest, 'program index.catalogDigest'), references });
  return handle;
}

/** Create an opaque journal from the protected runtime ledger and event journal.
 * Passing an empty ledger is still explicit evidence: it needs ledgerId,
 * revision, proofId, and the bound match/clock/task fields. */
export function createDuelPhaseSourceClosureJournalV2(
  raw: DuelPhaseSourceClosureJournalInputV2,
): DuelPhaseSourceClosureJournalV2;
export function createDuelPhaseSourceClosureJournalV2(
  _match: DuelCanonicalPlayingStateV2,
  raw: DuelPhaseSourceClosureJournalInputV2,
): DuelPhaseSourceClosureJournalV2;
export function createDuelPhaseSourceClosureJournalV2(
  first: DuelCanonicalPlayingStateV2 | DuelPhaseSourceClosureJournalInputV2,
  second?: DuelPhaseSourceClosureJournalInputV2,
): DuelPhaseSourceClosureJournalV2 {
  const parsed = journalInput(second ?? first);
  const handle = Object.freeze(Object.create(null)) as DuelPhaseSourceClosureJournalV2;
  freezeDeep(parsed);
  journals.set(handle, { input: parsed });
  return handle;
}

function transitionInHistory(match: DuelCanonicalPlayingStateV2, value: DuelPhaseSourceClosureTransitionV2): boolean {
  return match.provenance.transitions.some(step => step.uid === value.uid &&
    zoneKey(step.from) === zoneKey(value.from) && zoneKey(step.to) === zoneKey(value.to));
}
function ledgerBinding(value: DuelPhaseSourceClosureLedgerV2, context: DuelPhaseSourceClosureContextV2): boolean {
  return value.matchId === context.matchId && value.dataVersion === context.dataVersion &&
    value.catalogDigest === context.catalogDigest && value.turn === context.turn && value.taskId === context.taskId &&
    same(value.clock, context.clock);
}
function sourceReference(
  candidate: DuelPhaseSourceClosureCandidateV2,
  index: RegistryEntryV2,
  tokens: readonly DuelPhaseSourceClosureTokenReferenceV2[],
): { readonly reference: string; readonly referenceKind: 'printing' | 'gold-cr-intrinsic' | 'recruit-birth' } | undefined {
  if (candidate.cardId !== null) {
    const reference = index.references.get(candidate.cardId);
    return reference === undefined ? undefined : { reference, referenceKind: 'printing' };
  }
  const token = tokens.find(item => item.uid === candidate.uid);
  if (candidate.kind === 'gold' && token?.kind === 'gold' && token.referenceKind === 'gold-cr-intrinsic')
    return { reference: token.programReference, referenceKind: token.referenceKind };
  if (candidate.kind === 'unit' && candidate.carrier === 'object' && token?.kind === 'recruit' && token.referenceKind === 'recruit-birth')
    return { reference: token.programReference, referenceKind: token.referenceKind };
  // A runtime effect with null cardId resolves against its source UID below.
  return undefined;
}
function runtimeCandidate(entry: DuelPhaseSourceClosureRuntimeEntryV2): DuelPhaseSourceClosureCandidateV2 {
  return {
    uid: `effect:${entry.effectId}`, kind: 'effect', cardId: entry.cardId, zoneEpoch: entry.sourceZoneEpoch,
    controllerPlayerId: entry.controllerPlayerId, zone: copiedZone(entry.zone), ownerPlayerId: null,
    locationId: 'locationId' in entry.zone ? entry.zone.locationId : null, attachedToUID: null,
    visibility: 'internal', carrier: 'runtime-effect', sourceUID: entry.sourceUID,
    effectId: entry.effectId, runtimeKind: entry.kind,
  };
}
function uniqueCandidates(candidates: readonly DuelPhaseSourceClosureCandidateV2[]): boolean {
  const keys = candidates.map(candidate => JSON.stringify([
    candidate.carrier, candidate.uid, candidate.zoneEpoch, candidate.zone.kind,
    'locationId' in candidate.zone ? candidate.zone.locationId : candidate.zone.zonePlayerId,
  ]));
  return new Set(keys).size === keys.length;
}
function rawEvidence(raw: unknown): DuelPhaseSourceClosureProgramResultV2 {
  if (!isRecord(raw)) throw new TypeError('program evidence record');
  if (raw.status === 'unknown') {
    const actual = Reflect.ownKeys(raw);
    if (actual.some(key => typeof key !== 'string' || (key !== 'status' && key !== 'reason')))
      throw new TypeError('unknown evidence keys');
    return { status: 'unknown', ...(Object.hasOwn(raw, 'reason') ? { reason: text(raw.reason, 'unknown.reason') } : {}) };
  }
  const keys = [
    'status', 'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'phase', 'event', 'clock',
    'uid', 'kind', 'cardId', 'zoneEpoch', 'controllerPlayerId', 'zone', 'programReference',
    'referenceKind', 'proofId', 'eventSupported', 'decision', 'coverage',
  ] as const;
  const r = exactRecord(raw, keys, 'complete program evidence');
  if (r.status !== 'complete') throw new TypeError('program evidence status');
  const c = clock(r.clock, 'program evidence.clock');
  const coverage = exactRecord(r.coverage, [
    'wholeProgram', 'zoneScope', 'eventScope', 'static', 'replacements', 'continuous', 'triggers',
  ], 'program evidence.coverage');
  if (coverage.wholeProgram !== true || coverage.zoneScope !== 'whole-program' || coverage.eventScope !== 'whole-program' ||
      coverage.static !== true || coverage.replacements !== true || coverage.continuous !== true || coverage.triggers !== true)
    throw new TypeError('program evidence coverage');
  if (!OBJECT_KINDS.includes(r.kind as DuelObjectView['kind']) && r.kind !== 'effect') throw new TypeError('program evidence.kind');
  if (r.referenceKind !== 'printing' && r.referenceKind !== 'gold-cr-intrinsic' && r.referenceKind !== 'recruit-birth')
    throw new TypeError('program evidence.referenceKind');
  if (r.decision !== 'active' && r.decision !== 'inactive' && r.decision !== 'handler') throw new TypeError('program evidence.decision');
  if (r.eventSupported !== true) throw new TypeError('program evidence.eventSupported');
  return {
    status: 'complete', matchId: text(r.matchId, 'evidence.matchId'), dataVersion: text(r.dataVersion, 'evidence.dataVersion'),
    catalogDigest: text(r.catalogDigest, 'evidence.catalogDigest'), turn: integer(r.turn, 'evidence.turn'),
    taskId: text(r.taskId, 'evidence.taskId'), phase: text(r.phase, 'evidence.phase') as DuelPhaseSourceClosurePhaseV2,
    event: text(r.event, 'evidence.event') as DuelPhaseSourceClosureEventV2, clock: c,
    uid: text(r.uid, 'evidence.uid'), kind: r.kind as DuelPhaseSourceClosureCandidateKindV2,
    cardId: nullableText(r.cardId, 'evidence.cardId'), zoneEpoch: r.zoneEpoch === null ? null : integer(r.zoneEpoch, 'evidence.zoneEpoch'),
    controllerPlayerId: nullableText(r.controllerPlayerId, 'evidence.controllerPlayerId'), zone: zone(r.zone, 'evidence.zone'),
    programReference: text(r.programReference, 'evidence.programReference'), referenceKind: r.referenceKind,
    proofId: text(r.proofId, 'evidence.proofId'), eventSupported: true, decision: r.decision,
    coverage: { wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program', static: true,
      replacements: true, continuous: true, triggers: true },
  };
}
function matchesEvidence(
  evidence: DuelPhaseSourceClosureProgramEvidenceV2,
  source: DuelPhaseSourceClosureCandidateV2,
  context: DuelPhaseSourceClosureContextV2,
  expectedProgramReference: string,
  referenceKind: 'printing' | 'gold-cr-intrinsic' | 'recruit-birth',
): boolean {
  return evidence.matchId === context.matchId && evidence.dataVersion === context.dataVersion &&
    evidence.catalogDigest === context.catalogDigest && evidence.turn === context.turn && evidence.taskId === context.taskId &&
    evidence.phase === context.phase && evidence.event === context.event && same(evidence.clock, context.clock) &&
    evidence.uid === source.uid && evidence.kind === source.kind && evidence.cardId === source.cardId &&
    evidence.zoneEpoch === source.zoneEpoch && evidence.controllerPlayerId === source.controllerPlayerId &&
    same(evidence.zone, source.zone) && evidence.programReference === expectedProgramReference &&
    evidence.referenceKind === referenceKind;
}
function allJournalLedgers(input: DuelPhaseSourceClosureJournalInputV2): readonly [LedgerNameV2, DuelPhaseSourceClosureLedgerV2][] {
  return [
    ['activeEffects', input.activeEffects], ['chain', input.chain],
    ['effectQueue', input.effectQueue], ['feprOutstanding', input.feprOutstanding],
  ];
}
function specialBindings(
  match: DuelCanonicalPlayingStateV2,
  context: DuelPhaseSourceClosureContextV2,
  journal: DuelPhaseSourceClosureJournalInputV2,
  current: readonly DuelPhaseSourceClosureCandidateV2[],
): { ok: true; draw: DuelPhaseSourceClosureCandidateV2[]; preExit: DuelPhaseSourceClosureCandidateV2[] } | { ok: false; reason: string } {
  const byUID = new Map(current.map(candidate => [candidate.uid, candidate]));
  const tokenUIDs = current.filter(candidate =>
    (candidate.kind === 'gold' || (candidate.kind === 'unit' && candidate.cardId === null)) && candidate.carrier === 'object');
  const tokenRefs = new Map<string, DuelPhaseSourceClosureTokenReferenceV2>();
  for (const reference of journal.tokenReferences) {
    if (tokenRefs.has(reference.uid)) return { ok: false, reason: 'duplicate-token-reference' };
    if (reference.sourceMode === 'pre-exit' && context.event !== 'pre-exit' && context.event !== 'zone-transition')
      return { ok: false, reason: 'pre-exit-token-context-mismatch' };
    tokenRefs.set(reference.uid, reference);
    const candidate = byUID.get(reference.uid);
    const source = current.find(item => item.uid === reference.sourceUID && item.zoneEpoch === reference.sourceZoneEpoch);
    const preExitSource = journal.preExitSources.find(item => item.source.uid === reference.sourceUID &&
      item.source.zoneEpoch === reference.sourceZoneEpoch && item.proofId === reference.sourceProofId);
    if ((reference.sourceMode === 'current' && !source) ||
        (reference.sourceMode === 'pre-exit' && !preExitSource) ||
        !candidate || (reference.kind === 'gold' && candidate.kind !== 'gold') ||
        (reference.kind === 'recruit' && !(candidate.kind === 'unit' && candidate.cardId === null)) ||
        candidate.controllerPlayerId !== reference.controllerPlayerId || !reference.programReference.trim())
      return { ok: false, reason: 'foreign-or-stale-token-reference' };
  }
  for (const candidate of tokenUIDs) if (!tokenRefs.has(candidate.uid)) return { ok: false, reason: 'missing-token-reference' };
  const draw: DuelPhaseSourceClosureCandidateV2[] = [];
  for (const subject of journal.drawSubjects) {
    if (!transitionInHistory(match, subject) || subject.eventId.length === 0 || subject.from.kind !== 'main-deck' || subject.to.kind !== 'hand')
      return { ok: false, reason: 'unbound-draw-subject' };
    const candidate = byUID.get(subject.uid);
    if (!candidate || candidate.zone.kind !== 'hand' || candidate.zoneEpoch !== subject.toZoneEpoch ||
        zoneKey(subject.to) !== zoneKey(candidate.zone)) return { ok: false, reason: 'draw-subject-not-current' };
    draw.push(candidate);
  }
  if (context.event === 'draw' || context.event === 'draw-subject') {
    // The actual turn executor checks Draw before its intrinsic action while the
    // admitted frame is still Channel. Completed Draw/event subjects remain mandatory.
    const beforeTurnDraw = context.event === 'draw' && match.frame.phase === 'channel' &&
      context.taskId === `duel-v2:${match.matchId}:turn-${context.turn}:draw:0`;
    if (draw.length === 0 && !beforeTurnDraw) return { ok: false, reason: 'missing-draw-subject' };
  }
  const preExit: DuelPhaseSourceClosureCandidateV2[] = [];
  for (const entry of journal.preExitSources) {
    if (entry.eventId !== entry.transition.eventId || !transitionInHistory(match, entry.transition))
      return { ok: false, reason: 'invalid-pre-exit-journal' };
    if (zoneKey(entry.source.zone) !== zoneKey(entry.transition.from) || entry.source.zoneEpoch !== entry.transition.fromZoneEpoch ||
        entry.proofId !== entry.transition.proofId) return { ok: false, reason: 'pre-exit-transition-binding' };
    const now = byUID.get(entry.source.uid);
    if (now && now.zoneEpoch === entry.source.zoneEpoch && zoneKey(now.zone) === zoneKey(entry.source.zone))
      return { ok: false, reason: 'pre-exit-is-current-reference' };
    preExit.push(entry.source);
  }
  if (context.event === 'pre-exit' && preExit.length === 0) return { ok: false, reason: 'missing-pre-exit-journal' };
  if (context.event === 'zone-transition' && journal.transitions.length === 0) return { ok: false, reason: 'missing-transition-journal' };
  for (const item of journal.transitions) if (!transitionInHistory(match, item)) return { ok: false, reason: 'unbound-transition-event' };
  return { ok: true, draw, preExit };
}

/**
 * Build a complete private source closure at a phase boundary.  A missing
 * catalog program, missing token proof, unknown whole-program result, stale
 * journal, missing draw subject/pre-exit binding, or missing runtime ledger
 * coverage all return `pending` (fail closed).
 */
export function inspectDuelPhaseSourceClosureV2(
  match: DuelCanonicalPlayingStateV2,
  context: DuelPhaseSourceClosureContextV2,
  registry: DuelPhaseSourceClosureRegistryV2,
  journal: DuelPhaseSourceClosureJournalV2,
): DuelPhaseSourceClosureInspectionV2;
export function inspectDuelPhaseSourceClosureV2(
  match: DuelCanonicalPlayingStateV2,
  context: DuelPhaseSourceClosureContextV2,
  journal: DuelPhaseSourceClosureJournalV2,
  registry: DuelPhaseSourceClosureRegistryV2,
): DuelPhaseSourceClosureInspectionV2;
export function inspectDuelPhaseSourceClosureV2(
  match: DuelCanonicalPlayingStateV2,
  context: DuelPhaseSourceClosureContextV2,
  options: { readonly registry: DuelPhaseSourceClosureRegistryV2; readonly journal: DuelPhaseSourceClosureJournalV2 },
): DuelPhaseSourceClosureInspectionV2;
export function inspectDuelPhaseSourceClosureV2(
  match: DuelCanonicalPlayingStateV2,
  rawContext: DuelPhaseSourceClosureContextV2,
  third: DuelPhaseSourceClosureRegistryV2 | DuelPhaseSourceClosureJournalV2 | { readonly registry: DuelPhaseSourceClosureRegistryV2; readonly journal: DuelPhaseSourceClosureJournalV2 },
  fourth?: DuelPhaseSourceClosureRegistryV2 | DuelPhaseSourceClosureJournalV2,
): DuelPhaseSourceClosureInspectionV2 {
  let registry: DuelPhaseSourceClosureRegistryV2 | undefined;
  let journal: DuelPhaseSourceClosureJournalV2 | undefined;
  if (isRecord(third) && Object.hasOwn(third, 'registry') && Object.hasOwn(third, 'journal')) {
    registry = third.registry as DuelPhaseSourceClosureRegistryV2;
    journal = third.journal as DuelPhaseSourceClosureJournalV2;
  } else if (registries.has(third as object)) {
    registry = third as DuelPhaseSourceClosureRegistryV2;
    journal = fourth as DuelPhaseSourceClosureJournalV2 | undefined;
  } else {
    journal = third as DuelPhaseSourceClosureJournalV2;
    registry = fourth as DuelPhaseSourceClosureRegistryV2 | undefined;
  }
  let context: DuelPhaseSourceClosureContextV2;
  try { context = validContext(rawContext); } catch { return fail([], 'invalid-context'); }
  let current: DuelPhaseSourceClosureCandidateV2[];
  try {
    current = enumerateDuelObjectsV2(match).map(candidateFromView) as DuelPhaseSourceClosureCandidateV2[];
  } catch { return fail([], 'unadmitted-or-invalid-match'); }
  if (!registry || !journal) return fail(current, 'missing-opaque-authority');
  const reg = registries.get(registry as object), journalEntry = journals.get(journal as object);
  if (!reg || !journalEntry) return fail(current, 'foreign-or-cloned-opaque-authority');
  if (reg.matchId !== match.matchId || reg.dataVersion !== match.dataVersion || reg.catalogDigest !== match.catalogDigest ||
      match.matchId !== context.matchId || match.dataVersion !== context.dataVersion || match.catalogDigest !== context.catalogDigest ||
      !Number.isSafeInteger(context.turn) || context.turn !== match.frame.turnNumber ||
      context.clock.stateVersion !== match.stateVersion || context.clock.eventSeq !== match.eventSeq ||
      !context.taskId.includes(`turn-${context.turn}:`)) return fail(current, 'invalid-boundary-binding');
  const journalValue = journalEntry.input;
  if (!contextMatches(journalValue, context)) return fail(current, 'journal-context-mismatch');
  for (const [name, value] of allJournalLedgers(journalValue))
    if (!ledgerBinding(value, context)) return fail(current, `missing-${name}-coverage`);
  if (new Set(current.map(candidate => candidate.uid)).size !== current.length) return fail(current, 'duplicate-object-carrier');
  const bindings = specialBindings(match, context, journalValue, current);
  if (!bindings.ok) return fail(current, bindings.reason);
  const preExit = bindings.preExit;
  const runtime: DuelPhaseSourceClosureCandidateV2[] = [];
  const runtimeEntries: DuelPhaseSourceClosureRuntimeEntryV2[] = [];
  for (const [, value] of allJournalLedgers(journalValue)) {
    for (const entry of value.entries) {
      if (runtimeEntries.some(previous => previous.effectId === entry.effectId)) return fail(current, 'duplicate-runtime-effect');
      runtimeEntries.push(entry); runtime.push(runtimeCandidate(entry));
    }
  }
  const candidates = [...current, ...preExit, ...runtime];
  if (!uniqueCandidates(candidates)) return fail(current, 'duplicate-source-audit-candidate');
  const allObjectAndPreExit = [...current, ...preExit];
  const resolveObjectReference = (candidate: DuelPhaseSourceClosureCandidateV2) =>
    sourceReference(candidate, reg!, journalValue.tokenReferences);
  const expectedByCandidate = new Map<string, { reference: string; referenceKind: 'printing' | 'gold-cr-intrinsic' | 'recruit-birth' }>();
  for (const candidate of allObjectAndPreExit) {
    const resolved = resolveObjectReference(candidate);
    if (resolved) expectedByCandidate.set(JSON.stringify([candidate.carrier, candidate.uid, candidate.zoneEpoch, zoneKey(candidate.zone)]), resolved);
  }
  for (const entry of runtimeEntries) {
    const source = [...current, ...preExit].find(candidate => candidate.uid === entry.sourceUID && candidate.zoneEpoch === entry.sourceZoneEpoch);
    if (!source) return fail(candidates, 'runtime-source-not-bound');
    const resolved = resolveObjectReference(source);
    if (!resolved || resolved.reference !== entry.programReference || entry.cardId !== source.cardId ||
        entry.controllerPlayerId !== source.controllerPlayerId || zoneKey(entry.zone) !== zoneKey(source.zone))
      return fail(candidates, 'runtime-ledger-source-mismatch');
    expectedByCandidate.set(JSON.stringify(['runtime-effect', `effect:${entry.effectId}`, entry.sourceZoneEpoch, zoneKey(entry.zone)]), resolved);
  }
  const activeSources: DuelPhaseSourceClosureCandidateV2[] = [];
  const handlers: DuelPhaseSourceClosureCandidateV2[] = [];
  const eventSources: DuelPhaseSourceClosureCandidateV2[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.carrier === 'runtime-effect' ? 'runtime-effect' : candidate.carrier,
      candidate.uid, candidate.zoneEpoch, zoneKey(candidate.zone)]);
    const expected = expectedByCandidate.get(key);
    if (!expected) return fail(candidates, candidate.cardId === null ? 'missing-null-cardId-source-proof' : 'missing-printing-program');
    let raw: DuelPhaseSourceClosureProgramResultV2;
    try {
      const request: DuelPhaseSourceClosureRequestV2 = Object.freeze({
        match, context, source: Object.freeze({ ...candidate, zone: Object.freeze(copiedZone(candidate.zone)) }),
        expectedProgramReference: expected.reference, referenceKind: expected.referenceKind,
      });
      raw = reg.producer(request);
    } catch { return fail(candidates, 'whole-program-producer-error'); }
    let evidence: DuelPhaseSourceClosureProgramResultV2;
    try { evidence = rawEvidence(raw); } catch { return fail(candidates, 'malformed-whole-program-evidence'); }
    if (evidence.status !== 'complete') return fail(candidates, 'unknown-whole-program');
    if (!matchesEvidence(evidence, candidate, context, expected.reference, expected.referenceKind))
      return fail(candidates, 'foreign-or-incomplete-whole-program-proof');
    if (evidence.decision === 'active' || evidence.decision === 'handler') eventSources.push(candidate);
    if (evidence.decision === 'active') activeSources.push(candidate);
    if (evidence.decision === 'handler') handlers.push(candidate);
  }
  const result: DuelPhaseSourceClosureInspectionV2 = {
    status: 'ready', candidates, sources: candidates, eventSources, activeSources, handlers,
    runtimeSources: runtime, drawSubjects: bindings.draw, preExitSources: preExit,
  };
  freezeDeep(result);
  return result;
}

// Short aliases are intentionally internal convenience names; the explicit V2
// names above remain the contract used by Root integration.
export const createDuelSourceClosureRegistryV2 = createDuelPhaseSourceClosureRegistryV2;
export const createDuelSourceClosureJournalV2 = createDuelPhaseSourceClosureJournalV2;
export const inspectDuelSourceClosureV2 = inspectDuelPhaseSourceClosureV2;
export const enumerateDuelPhaseSourceClosureCandidatesV2 = (
  match: DuelCanonicalPlayingStateV2,
): readonly DuelPhaseSourceClosureCandidateV2[] => {
  try { return Object.freeze(enumerateDuelObjectsV2(match).map(candidateFromView)); }
  catch { return Object.freeze([]); }
};
