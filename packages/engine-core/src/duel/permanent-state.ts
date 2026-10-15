// V1 candidate compatibility and the explicit V2 core codec share the same carrier checks.
// V2's four fields live on the ONE playing match; neither a second board/resource registry
// nor an unverified archive sidecar is an acceptable source of creation provenance.
// CR 123/124: physical owner survives control and zone changes; EACH change to/from ANY
// non-board zone makes a new game object. An outer trusted executor must supply the FULL
// ordered transition trace (including round trips within one outer mutation).
import { assertDuelBoard, type DuelBoard } from './battlefields.js';
import { detachedDuelPlaying } from './canonical-transaction.js';
import type { DuelCanonicalPlayingState } from './canonical-session.js';

export interface DuelPhysicalCardOrigin {
  readonly cardId: string;
  readonly ownerPlayerId: string;
  readonly origin: 'submitted-deck' | 'created';
  readonly zoneEpoch: number;
}
export interface DuelLegendAuthority {
  readonly controllerPlayerId: string;
  readonly readiness: 'not-established' | 'ready' | 'exhausted';
}
export interface DuelGearAuthority {
  readonly uid: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly readied: boolean;
  readonly attachedToUID: string | null;
}
/** Contract-facing aliases retained for the S1b integrator; these do not create a second store. */
export type PhysicalCardOrigin = DuelPhysicalCardOrigin;
export type DuelLegendState = DuelLegendAuthority;
export type DuelGearOnBoard = DuelGearAuthority;
/** Physical card on the shared public Chain (CR 108.1, 328, 354). The owner tag
 * identifies provenance; it does not turn the Chain into a private player zone. */
export interface DuelChainPhysicalCard {
  readonly uid: string;
  readonly cardId: string;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string;
}
export interface DuelPermanentFields {
  readonly physicalCardsByUID: Readonly<Record<string, PhysicalCardOrigin>>;
  readonly legendStates: Readonly<Record<string, DuelLegendState>>;
  readonly gears: readonly DuelGearOnBoard[];
  readonly retiredPhysicalUIDs: readonly string[];
  /** Absent on earlier private candidates; presence must pass the complete carrier codec. */
  readonly chainCards?: readonly DuelChainPhysicalCard[];
}
/** A proposed extended playing state; production is STILL V1 until Root integrates S1b. */
export type DuelPermanentCandidate = DuelCanonicalPlayingState & DuelPermanentFields;

export interface TrustedDuelOriginalCard {
  readonly uid: string;
  readonly cardId: string;
  readonly ownerPlayerId: string;
  readonly origin: 'submitted-deck' | 'created';
  /** Independently verified printing kind, NOT guessed from card text or the current carrier. */
  readonly cardType: 'Unit' | 'Champion' | 'Gear' | 'Rune' | 'Legend' | 'Battlefield' | 'Other';
}
/** Independently protected creation record + trusted transition results, NOT copied from a
 * snapshot, client projection, current zone, or controller. The caller must obtain this
 * from the server's separate verified creation journal and catalog/roster attestation.
 * expectedZoneEpochByUID must include even retired physical UIDs. A standalone JSON
 * snapshot cannot prove historical crossings or archive integrity by itself.
 * Gold/Unit tokens need their own creation-effect owner proof, even when the old kernel
 * currently constrains owner == base player. Never infer Gold owner from its base. */
export interface TrustedDuelPermanentInventory {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly rosterPlayerIds: readonly [string, string];
  readonly originalPhysicalCards: readonly TrustedDuelOriginalCard[];
  /** Six submitted BF identities, including four removed during selection; separate genesis evidence. */
  readonly submittedBattlefieldUIDs: readonly string[];
  readonly expectedZoneEpochByUID: Readonly<Record<string, number>>;
  readonly retiredPhysicalUIDs: readonly string[];
  readonly goldOwnersByUID: Readonly<Record<string, string>>;
  readonly unitTokenOwnersByUID: Readonly<Record<string, string>>;
}
export type DuelPhysicalZone =
  | { readonly kind: 'board-base' | 'board-battlefield'; readonly locationId: string }
  | { readonly kind: 'legend-zone' | 'champion-zone' | 'hand' | 'main-deck' | 'trash' | 'rune-deck' | 'chain'; readonly zonePlayerId: string };
export interface DuelPhysicalZoneTransition {
  readonly uid: string;
  readonly from: DuelPhysicalZone;
  readonly to: DuelPhysicalZone;
}
export interface DuelPhysicalReference { readonly uid: string; readonly zoneEpoch: number }
export type DuelObjectReadiness = { readonly kind: 'ready' | 'exhausted' | 'not-established' | 'not-applicable' | 'not-modeled' };
export interface DuelObjectView {
  readonly uid: string;
  readonly kind: 'card' | 'champion' | 'legend' | 'battlefield' | 'unit' | 'gear' | 'rune' | 'gold';
  readonly cardId: string | null;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string | null;
  readonly zone: DuelPhysicalZone;
  readonly locationId: string | null;
  readonly readiness: DuelObjectReadiness;
  readonly attachedToUID: string | null;
  /** Private provider reference, never include this view in the public projection. */
  readonly zoneEpoch: number | null;
}

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new TypeError(`Duel permanent authority: ${label}`);
}
function record(raw: unknown, keys: readonly string[] | null, label: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label} record`);
  check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null, `${label} prototype`);
  const actual = Reflect.ownKeys(raw);
  check(actual.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(raw, key)!),
    `${label} accessors/symbols`);
  if (keys !== null) check(actual.length === keys.length && keys.every(key => actual.includes(key)), `${label} keys`);
  return raw as Record<string, unknown>;
}
function list(raw: unknown, label: string, length: number | null = null): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype &&
    (length === null || raw.length === length), `${label} array`);
  check(Reflect.ownKeys(raw).length === raw.length + 1, `${label} sparse/extra`);
  for (let i = 0; i < raw.length; i++)
    check('value' in Object.getOwnPropertyDescriptor(raw, String(i))!, `${label}[${i}] accessor/hole`);
  return raw;
}
function id(raw: unknown, label: string): string {
  check(typeof raw === 'string' && raw.trim().length > 0, label);
  return raw;
}
function epoch(raw: unknown, label: string): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, `${label} safe epoch`);
  return raw;
}
function player(raw: unknown, ids: readonly string[], label: string): string {
  const value = id(raw, label);
  check(ids.includes(value), `${label} unknown player`);
  return value;
}
function dictionary<T>(raw: unknown, label: string, parse: (raw: unknown, key: string) => T): Record<string, T> {
  const source = record(raw, null, label), result = Object.create(null) as Record<string, T>;
  for (const key of Object.keys(source)) result[id(key, `${label} UID`)] = parse(source[key], key);
  return result;
}
function originType(raw: unknown, label: string): 'submitted-deck' | 'created' {
  check(raw === 'submitted-deck' || raw === 'created', `${label} origin`);
  return raw;
}
function identity(raw: unknown, label: string, ids: readonly string[]): TrustedDuelOriginalCard {
  const r = record(raw, ['uid', 'cardId', 'ownerPlayerId', 'origin', 'cardType'], label);
  check(r.cardType === 'Unit' || r.cardType === 'Champion' || r.cardType === 'Gear' || r.cardType === 'Rune' ||
    r.cardType === 'Legend' || r.cardType === 'Battlefield' || r.cardType === 'Other',
  `${label} catalog-attested printing type`);
  return { uid: id(r.uid, `${label}.uid`), cardId: id(r.cardId, `${label}.cardId`),
    ownerPlayerId: player(r.ownerPlayerId, ids, `${label}.ownerPlayerId`),
    origin: originType(r.origin, label), cardType: r.cardType };
}
function trusted(raw: unknown, match: DuelCanonicalPlayingState): TrustedDuelPermanentInventory {
  const r = record(raw, ['matchId', 'dataVersion', 'catalogDigest', 'rosterPlayerIds',
    'originalPhysicalCards', 'submittedBattlefieldUIDs', 'expectedZoneEpochByUID', 'retiredPhysicalUIDs',
    'goldOwnersByUID', 'unitTokenOwnersByUID'], 'independent trusted inventory');
  check(r.matchId === match.matchId && r.dataVersion === match.dataVersion &&
    r.catalogDigest === match.catalogDigest, 'independent match/catalog mismatch');
  const ids = list(r.rosterPlayerIds, 'trusted roster', 2).map((v, i) => id(v, `trusted roster[${i}]`)) as [string, string];
  check(ids[0] !== ids[1] && ids.every((value, i) => value === match.roster[i]!.playerId),
    'independent roster mismatch');
  const originals = list(r.originalPhysicalCards, 'original physical inventory')
    .map((v, i) => identity(v, `originalPhysicalCards[${i}]`, ids));
  const seen = new Set<string>();
  for (const card of originals) {
    check(!seen.has(card.uid), `duplicate original UID ${card.uid}`);
    seen.add(card.uid);
  }
  const fields = list(r.submittedBattlefieldUIDs, 'submitted Battlefield UIDs', 6)
    .map((value, i) => id(value, `submittedBattlefieldUIDs[${i}]`));
  check(new Set(fields).size === 6 && fields.every(uid => seen.has(uid)),
    'submitted Battlefield proof has duplicate/unknown UID');
  const expected = dictionary(r.expectedZoneEpochByUID, 'independent epochs',
    (v, key) => epoch(v, `independent epoch ${key}`));
  check(Object.keys(expected).length === seen.size && Object.keys(expected).every(uid => seen.has(uid)),
    'independent epochs must cover original inventory exactly');
  const retired = list(r.retiredPhysicalUIDs, 'trusted retired physical UIDs')
    .map((v, i) => id(v, `trusted retiredPhysicalUIDs[${i}]`));
  check(new Set(retired).size === retired.length && retired.every(uid => seen.has(uid)),
    'trusted retired UID missing/duplicate in original inventory');
  const gold = dictionary(r.goldOwnersByUID, 'trusted Gold owners', (v, key) => player(v, ids, `Gold ${key} owner`));
  const tokens = dictionary(r.unitTokenOwnersByUID, 'trusted Unit token owners',
    (v, key) => player(v, ids, `Unit token ${key} owner`));
  return { matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    rosterPlayerIds: ids, originalPhysicalCards: originals, submittedBattlefieldUIDs: fields,
    expectedZoneEpochByUID: expected,
    retiredPhysicalUIDs: retired, goldOwnersByUID: gold, unitTokenOwnersByUID: tokens };
}
const LEGACY_FIELDS = ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
  'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'players', 'board', 'resources', 'scoring',
  'unitMeta', 'retiredUnitTokenUIDs', 'frame'] as const;
const ADDED_FIELDS = ['physicalCardsByUID', 'legendStates', 'gears', 'retiredPhysicalUIDs'] as const;
function candidateKeys(raw: unknown): readonly string[] {
  const r = record(raw, null, 'playing candidate');
  return [...LEGACY_FIELDS, ...ADDED_FIELDS, ...(Object.hasOwn(r, 'chainCards') ? ['chainCards'] : [])];
}
function baseCopy(raw: unknown, extended: boolean): DuelCanonicalPlayingState {
  const state = record(raw, extended ? candidateKeys(raw) : LEGACY_FIELDS, 'playing candidate');
  // This is explicitly the OLD V1 canonical codec used only to validate/detach the
  // existing fields. It is NOT a V2 constructor/archive, nor a V1->V2 migrator.
  const core = Object.fromEntries(LEGACY_FIELDS.map(key => [key, state[key]]));
  return detachedDuelPlaying(core as unknown as DuelCanonicalPlayingState);
}
function parseZone(raw: unknown, match: DuelCanonicalPlayingState, label: string): DuelPhysicalZone {
  const zone = record(raw, null, label);
  if (zone.kind === 'board-base' || zone.kind === 'board-battlefield') {
    record(raw, ['kind', 'locationId'], label);
    const locationId = id(zone.locationId, `${label}.locationId`);
    const exists = zone.kind === 'board-base' ? match.board.bases : match.board.battlefields;
    check(exists.some(item => item.locationId === locationId), `${label} unknown ${zone.kind}`);
    return { kind: zone.kind, locationId };
  }
  check(zone.kind === 'legend-zone' || zone.kind === 'champion-zone' || zone.kind === 'hand' ||
    zone.kind === 'main-deck' || zone.kind === 'trash' || zone.kind === 'rune-deck' || zone.kind === 'chain', `${label} kind`);
  record(raw, ['kind', 'zonePlayerId'], label);
  return { kind: zone.kind, zonePlayerId: player(zone.zonePlayerId, match.board.playerIds, label) };
}
function boardZone(match: DuelCanonicalPlayingState, locationId: string): DuelPhysicalZone {
  return match.board.bases.some(base => base.locationId === locationId)
    ? { kind: 'board-base', locationId } : { kind: 'board-battlefield', locationId };
}
function zoneKey(zone: DuelPhysicalZone): string {
  return 'locationId' in zone ? JSON.stringify([zone.kind, zone.locationId]) :
    JSON.stringify([zone.kind, zone.zonePlayerId]);
}
function nonBoard(zone: DuelPhysicalZone): boolean {
  return zone.kind === 'champion-zone' || zone.kind === 'hand' || zone.kind === 'main-deck' ||
    zone.kind === 'trash' || zone.kind === 'rune-deck' || zone.kind === 'chain';
}
function chainCards(raw: unknown, match: DuelCanonicalPlayingState): readonly DuelChainPhysicalCard[] {
  return list(raw, 'chainCards').map((value, i) => {
    const r = record(value, ['uid', 'cardId', 'ownerPlayerId', 'controllerPlayerId'], `chainCards[${i}]`);
    return { uid: id(r.uid, `chainCards[${i}].uid`), cardId: id(r.cardId, `chainCards[${i}].cardId`),
      ownerPlayerId: player(r.ownerPlayerId, match.board.playerIds, `chainCards[${i}].ownerPlayerId`),
      controllerPlayerId: player(r.controllerPlayerId, match.board.playerIds, `chainCards[${i}].controllerPlayerId`) };
  });
}
interface Carrier { uid: string; kind: DuelObjectView['kind']; zone: DuelPhysicalZone; cardId: string | null;
  ownerPlayerId: string | null; controllerPlayerId: string | null; readied: DuelObjectReadiness['kind'];
  attachedToUID: string | null }
function carriers(match: DuelCanonicalPlayingState, gears: readonly DuelGearAuthority[],
  onChain: readonly DuelChainPhysicalCard[] = []): Map<string, Carrier> {
  const all = new Map<string, Carrier>();
  function add(value: Carrier): void {
    check(!all.has(value.uid), `duplicate primary carrier UID ${value.uid} (${all.get(value.uid)?.kind}/${value.kind})`);
    all.set(value.uid, value);
  }
  const nonboard = (kind: DuelPhysicalZone['kind'], playerId: string): DuelPhysicalZone =>
    ({ kind, zonePlayerId: playerId } as DuelPhysicalZone);
  match.players.forEach(p => {
    if (p.champion) add({ uid: p.champion.uid, kind: 'champion', cardId: p.champion.cardId,
      zone: nonboard('champion-zone', p.playerId), ownerPlayerId: null, controllerPlayerId: null,
      readied: 'not-applicable', attachedToUID: null });
    add({ uid: p.legend.uid, kind: 'legend', cardId: p.legend.cardId,
      zone: nonboard('legend-zone', p.playerId), ownerPlayerId: null, controllerPlayerId: null,
      readied: 'not-established', attachedToUID: null });
    for (const [cards, zone] of [[p.hand, 'hand'], [p.remainingMainDeck, 'main-deck'], [p.trash, 'trash']] as const)
      for (const card of cards) add({ uid: card.uid, kind: 'card', cardId: card.cardId,
        zone: nonboard(zone, p.playerId), ownerPlayerId: null, controllerPlayerId: null,
        readied: 'not-applicable', attachedToUID: null });
  });
  for (const card of onChain) add({ uid: card.uid, kind: 'card', cardId: card.cardId,
    ownerPlayerId: card.ownerPlayerId, controllerPlayerId: card.controllerPlayerId,
    zone: nonboard('chain', card.ownerPlayerId), readied: 'not-applicable', attachedToUID: null });
  for (const field of match.board.battlefields) add({ uid: field.instanceId, kind: 'battlefield',
    cardId: field.cardId, ownerPlayerId: field.ownerPlayerId, controllerPlayerId: field.controllerPlayerId,
    zone: boardZone(match, field.locationId), readied: 'not-modeled', attachedToUID: null });
  for (const unit of match.board.units) {
    const meta = match.unitMeta[unit.objectId]!;
    add({ uid: unit.objectId, kind: 'unit', cardId: meta.trait.kind === 'card' ? meta.trait.cardId : null,
      ownerPlayerId: meta.ownerPlayerId, controllerPlayerId: unit.controllerPlayerId,
      zone: boardZone(match, unit.locationId), readied: meta.readied ? 'ready' : 'exhausted', attachedToUID: null });
  }
  for (const p of match.resources.players) for (const rune of p.runeDeck)
    add({ uid: rune.uid, kind: 'rune', cardId: rune.cardId, ownerPlayerId: null,
      controllerPlayerId: null, zone: nonboard('rune-deck', p.playerId), readied: 'not-applicable', attachedToUID: null });
  for (const base of match.resources.bases) {
    for (const rune of base.baseRunes) add({ uid: rune.uid, kind: 'rune', cardId: rune.cardId,
      ownerPlayerId: rune.ownerPlayerId, controllerPlayerId: rune.controllerPlayerId,
      zone: boardZone(match, rune.locationId), readied: rune.readied ? 'ready' : 'exhausted', attachedToUID: null });
    for (const gold of base.goldTokens) add({ uid: gold.uid, kind: 'gold', cardId: null,
      ownerPlayerId: gold.ownerPlayerId, controllerPlayerId: gold.controllerPlayerId,
      zone: boardZone(match, gold.locationId), readied: gold.readied ? 'ready' : 'exhausted', attachedToUID: null });
  }
  for (const gear of gears) add({ uid: gear.uid, kind: 'gear', cardId: null,
    ownerPlayerId: null, controllerPlayerId: gear.controllerPlayerId, zone: boardZone(match, gear.locationId),
    readied: gear.readied ? 'ready' : 'exhausted', attachedToUID: gear.attachedToUID });
  return all;
}
/** Validates ALL primary carriers before checking aliases/references. Context must be a
 * separate trusted creation record, not values copied from this snapshot. This candidate
 * validator deliberately does not claim to validate future V2 archive/private sidecars. */
export function assertDuelPermanentState(raw: unknown, inventory: unknown): asserts raw is DuelPermanentCandidate {
  const match = baseCopy(raw, true);
  const source = record(raw, candidateKeys(raw), 'playing candidate');
  const proof = trusted(inventory, match);
  const ids = match.board.playerIds;
  const original = new Map(proof.originalPhysicalCards.map(card => [card.uid, card]));
  const origins = dictionary(source.physicalCardsByUID, 'physicalCardsByUID', (value, uid) => {
    const r = record(value, ['cardId', 'ownerPlayerId', 'origin', 'zoneEpoch'], `origin ${uid}`);
    return { cardId: id(r.cardId, `origin ${uid}.cardId`), ownerPlayerId: player(r.ownerPlayerId, ids, `origin ${uid}.owner`),
      origin: originType(r.origin, `origin ${uid}`), zoneEpoch: epoch(r.zoneEpoch, `origin ${uid}.zoneEpoch`) };
  });
  const legendStates = dictionary(source.legendStates, 'legendStates', (value, uid) => {
    const r = record(value, ['controllerPlayerId', 'readiness'], `legend ${uid}`);
    check(r.readiness === 'not-established' || r.readiness === 'ready' || r.readiness === 'exhausted',
      `legend ${uid} readiness`);
    return { controllerPlayerId: player(r.controllerPlayerId, ids, `legend ${uid} controller`),
      readiness: r.readiness };
  });
  const gears = list(source.gears, 'gears').map((rawGear, i): DuelGearAuthority => {
    const r = record(rawGear, ['uid', 'controllerPlayerId', 'locationId', 'readied', 'attachedToUID'], `gears[${i}]`);
    check(typeof r.readied === 'boolean', `gears[${i}] readiness must be trusted settled Boolean`);
    check(r.attachedToUID === null || typeof r.attachedToUID === 'string', `gears[${i}] host`);
    return { uid: id(r.uid, `gears[${i}].uid`), controllerPlayerId: player(r.controllerPlayerId, ids, `gears[${i}] controller`),
      locationId: id(r.locationId, `gears[${i}] location`), readied: r.readied,
      attachedToUID: r.attachedToUID === null ? null : id(r.attachedToUID, `gears[${i}] host`) };
  });
  const retired = list(source.retiredPhysicalUIDs, 'retiredPhysicalUIDs')
    .map((value, i) => id(value, `retiredPhysicalUIDs[${i}]`));
  check(retired.length === proof.retiredPhysicalUIDs.length &&
    retired.every((uid, i) => uid === proof.retiredPhysicalUIDs[i]), 'retired physical UIDs lack independent proof');
  const selectedFields = match.board.battlefields.map(field => field.instanceId);
  check(proof.submittedBattlefieldUIDs.length === 6 &&
    selectedFields.every(uid => proof.submittedBattlefieldUIDs.includes(uid)) &&
    proof.submittedBattlefieldUIDs.every(uid => selectedFields.includes(uid) || retired.includes(uid)) &&
    retired.every(uid => !proof.submittedBattlefieldUIDs.includes(uid) || !selectedFields.includes(uid)),
  'submitted/removed Battlefield provenance mismatch');
  const primary = carriers(match, gears, Object.hasOwn(source, 'chainCards') ? chainCards(source.chainCards, match) : []);
  const reserved = new Set<string>();
  for (const value of [...ids, ...match.board.bases.map(base => base.locationId),
    ...match.board.battlefields.map(field => field.locationId)]) {
    check(!reserved.has(value), 'player/location namespace collision'); reserved.add(value);
  }
  for (const uid of original.keys()) check(!reserved.has(uid), `original UID ${uid} collides with player/location`);
  for (const uid of primary.keys()) check(!reserved.has(uid), `primary UID ${uid} collides with player/location`);
  const tombstones = [...retired, ...match.retiredUnitTokenUIDs, ...match.resources.retiredGoldUids];
  check(new Set(tombstones).size === tombstones.length, 'duplicate retired UID across categories');
  for (const uid of tombstones) check(!reserved.has(uid) && !primary.has(uid), `retired UID ${uid} reused`);
  const physicalUIDs = [...primary.values()].filter(c => c.kind !== 'gold' &&
    !(c.kind === 'unit' && c.cardId === null)).map(c => c.uid);
  check(physicalUIDs.length === Object.keys(origins).length &&
    physicalUIDs.every(uid => Object.hasOwn(origins, uid)), 'origin must map EXACTLY physical primary carriers');
  check(physicalUIDs.length + retired.length === original.size &&
    [...original.keys()].every(uid => Object.hasOwn(origins, uid) || retired.includes(uid)),
  'independent original inventory not accounted for by live/retired physical cards');
  for (const [uid, carrier] of primary) {
    if (carrier.kind === 'gold' || (carrier.kind === 'unit' && carrier.cardId === null)) {
      check(!Object.hasOwn(origins, uid) && !original.has(uid), `token ${uid} misrepresented as physical card`);
      const owners = carrier.kind === 'gold' ? proof.goldOwnersByUID : proof.unitTokenOwnersByUID;
      check(Object.hasOwn(owners, uid) && owners[uid] === carrier.ownerPlayerId,
        `token ${uid} owner lacks independent creation-effect proof`);
      continue;
    }
    const fromProof = original.get(uid)!, physical = origins[uid]!;
    check(fromProof !== undefined && physical.cardId === fromProof.cardId &&
      physical.ownerPlayerId === fromProof.ownerPlayerId && physical.origin === fromProof.origin,
    `physical UID ${uid} identity/cardId/owner not independently proved`);
    check((carrier.kind === 'battlefield' && fromProof.cardType === 'Battlefield') ||
      (carrier.kind === 'legend' && fromProof.cardType === 'Legend') ||
      (carrier.kind === 'rune' && fromProof.cardType === 'Rune') ||
      (carrier.kind === 'gear' && fromProof.cardType === 'Gear') ||
      (carrier.kind === 'unit' && (fromProof.cardType === 'Unit' || fromProof.cardType === 'Champion')) ||
      (carrier.kind === 'champion' && fromProof.cardType === 'Champion') ||
      (carrier.kind === 'card'), `physical UID ${uid} carrier/printing type mismatch`);
    check(physical.zoneEpoch === proof.expectedZoneEpochByUID[uid], `physical UID ${uid} epoch lacks trusted history`);
    check(carrier.cardId === null || carrier.cardId === physical.cardId, `physical UID ${uid} cardId alias mismatch`);
    check(carrier.ownerPlayerId === null || carrier.ownerPlayerId === physical.ownerPlayerId,
      `physical UID ${uid} owner alias mismatch`);
  }
  const liveGold = [...primary.values()].filter(c => c.kind === 'gold').map(c => c.uid);
  const liveTokens = [...primary.values()].filter(c => c.kind === 'unit' && c.cardId === null).map(c => c.uid);
  check(Object.keys(proof.goldOwnersByUID).length === liveGold.length &&
    Object.keys(proof.unitTokenOwnersByUID).length === liveTokens.length, 'orphan/missing token creation proof');
  const legends = match.players.map(p => p.legend.uid);
  check(Object.keys(legendStates).length === legends.length && legends.every(uid => Object.hasOwn(legendStates, uid)),
    'legendStates keys must exactly match players.legend');
  for (const p of match.players) {
    const value = legendStates[p.legend.uid]!;
    check(value.readiness !== 'not-established' ||
      (match.frame.phase === 'awaiting-turn-start' && match.frame.turnNumber === 1),
    'not-established Legend cannot be treated as ready or continue past first Awaken');
  }
  const byGear = new Map(gears.map(gear => [gear.uid, gear]));
  for (const gear of gears) {
    check(original.has(gear.uid), `Gear ${gear.uid} has no physical printing proof`);
    check(match.board.bases.some(base => base.locationId === gear.locationId) ||
      match.board.battlefields.some(field => field.locationId === gear.locationId),
    `Gear ${gear.uid} unknown board location`);
    if (gear.attachedToUID !== null) {
      const host = primary.get(gear.attachedToUID);
      check(host && (host.kind === 'unit' && host.cardId !== null || host.kind === 'gear'),
        `Gear ${gear.uid} unknown/hidden/non-card host`);
      check(zoneKey(host.zone) === zoneKey(boardZone(match, gear.locationId)),
        `Gear ${gear.uid} attachment crosses location`);
    }
    const base = match.board.bases.find(b => b.locationId === gear.locationId);
    if (base) {
      const host = gear.attachedToUID === null ? null : primary.get(gear.attachedToUID)!;
      check(base.ownerPlayerId === gear.controllerPlayerId ||
        (host !== null && host.controllerPlayerId === base.ownerPlayerId),
      `Gear ${gear.uid} at uncontrolled foreign base`);
    }
  }
  // Each edge must point at a real board card Unit or Gear. No Gear may attach to
  // itself or an indirect cycle; an unattached top Gear is a valid chain end.
  for (const gear of gears) {
    const visited = new Set([gear.uid]);
    let host = gear.attachedToUID;
    while (host !== null && byGear.has(host)) {
      check(!visited.has(host), `Gear attachment cycle ${gear.uid}`);
      visited.add(host); host = byGear.get(host)!.attachedToUID;
    }
  }
}
/** Initial candidate ONLY for an actual constructor-created first post-mulligan state.
 * The independent input MUST attest owner/printing, all removed BF tombstones, AND
 * current epochs (including mulligan hand->deck->hand history). No defaults/guesses. */
export function initializeDuelPermanentState(state: DuelCanonicalPlayingState,
  independentInventory: TrustedDuelPermanentInventory): DuelPermanentCandidate {
  const base = baseCopy(state, false);
  check(base.schemaVersion === 1 && base.stage === 'playing' &&
    base.frame.phase === 'awaiting-turn-start' && base.frame.turnNumber === 1 &&
    base.stateVersion === 2 && base.eventSeq === 2 && base.board.units.length === 0 &&
    Object.keys(base.unitMeta).length === 0 && base.retiredUnitTokenUIDs.length === 0 &&
    base.resources.retiredGoldUids.length === 0 && base.resources.bases.every(b =>
      b.baseRunes.length === 0 && b.goldTokens.length === 0) &&
    base.players.every(p => p.champion !== null && p.trash.length === 0 && p.hand.length === 4),
  'initializer requires actual first post-mulligan baseline; never reconstruct older history');
  const proof = trusted(independentInventory, base);
  check(Object.keys(proof.goldOwnersByUID).length === 0 && Object.keys(proof.unitTokenOwnersByUID).length === 0,
    'unexpected initial token proof');
  const retired = proof.retiredPhysicalUIDs;
  check(retired.length === 4 && retired.every(uid => proof.submittedBattlefieldUIDs.includes(uid)) &&
    proof.submittedBattlefieldUIDs.every(uid => retired.includes(uid) ||
      base.board.battlefields.some(field => field.instanceId === uid)),
  'initial retired BF identities require four independently attested removed fields');
  const originals = new Map(proof.originalPhysicalCards.map(item => [item.uid, item]));
  const physicalCardsByUID = Object.create(null) as Record<string, DuelPhysicalCardOrigin>;
  for (const [uid, item] of originals) if (!retired.includes(uid)) physicalCardsByUID[uid] = {
    cardId: item.cardId, ownerPlayerId: item.ownerPlayerId, origin: item.origin,
    zoneEpoch: proof.expectedZoneEpochByUID[uid]!,
  };
  const legendStates = Object.create(null) as Record<string, DuelLegendAuthority>;
  for (const p of base.players) legendStates[p.legend.uid] = { controllerPlayerId: p.playerId,
    readiness: 'not-established' };
  const candidate = { ...base, physicalCardsByUID, legendStates, gears: [], retiredPhysicalUIDs: [...retired] };
  assertDuelPermanentState(candidate, proof);
  return candidate;
}
/** Strict detached candidate restore; requires separate authenticated genesis/transfer proof.
 * Does NOT accept public DTOs, V1 without four fields, or unknown V2 archive keys. */
export function restoreDuelPermanentState(snapshot: unknown, independentInventory: unknown): DuelPermanentCandidate {
  assertDuelPermanentState(snapshot, independentInventory);
  const base = baseCopy(snapshot, true);
  const physicalCardsByUID = Object.create(null) as Record<string, DuelPhysicalCardOrigin>;
  for (const [uid, entry] of Object.entries(snapshot.physicalCardsByUID)) physicalCardsByUID[uid] = {
    cardId: entry.cardId, ownerPlayerId: entry.ownerPlayerId, origin: entry.origin, zoneEpoch: entry.zoneEpoch };
  const legendStates = Object.create(null) as Record<string, DuelLegendAuthority>;
  for (const [uid, entry] of Object.entries(snapshot.legendStates)) legendStates[uid] = {
    controllerPlayerId: entry.controllerPlayerId, readiness: entry.readiness };
  return { ...base, physicalCardsByUID, legendStates,
    gears: snapshot.gears.map(g => ({ uid: g.uid, controllerPlayerId: g.controllerPlayerId,
      locationId: g.locationId, readied: g.readied, attachedToUID: g.attachedToUID })),
    retiredPhysicalUIDs: [...snapshot.retiredPhysicalUIDs],
    ...(Object.hasOwn(snapshot, 'chainCards') ? { chainCards: chainCards(snapshot.chainCards, base) } : {}) };
}
/** Private, transient, detached and frozen provider input, NOT a public allowlist. */
export function enumerateDuelObjects(state: DuelPermanentCandidate,
  independentInventory: TrustedDuelPermanentInventory): readonly DuelObjectView[] {
  assertDuelPermanentState(state, independentInventory);
  const primary = carriers(state, state.gears, state.chainCards ?? []);
  const views = [...primary.values()].sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
    .map((c): DuelObjectView => {
      const origin = Object.hasOwn(state.physicalCardsByUID, c.uid) ? state.physicalCardsByUID[c.uid]! : null;
      const legend = c.kind === 'legend' ? state.legendStates[c.uid]! : null;
      const zone = Object.freeze({ ...c.zone }) as DuelPhysicalZone;
      const readiness = Object.freeze({ kind: legend ? legend.readiness : c.readied });
      const locationId = 'locationId' in zone ? zone.locationId : null;
      return Object.freeze({ uid: c.uid, kind: c.kind, cardId: origin?.cardId ?? null,
        ownerPlayerId: origin?.ownerPlayerId ?? c.ownerPlayerId!,
        controllerPlayerId: legend?.controllerPlayerId ?? c.controllerPlayerId,
        zone, locationId, readiness, attachedToUID: c.attachedToUID,
        zoneEpoch: origin?.zoneEpoch ?? null });
    });
  return Object.freeze(views);
}
export function referenceDuelPhysicalCard(state: DuelPermanentCandidate,
  proof: TrustedDuelPermanentInventory, uid: string): DuelPhysicalReference {
  assertDuelPermanentState(state, proof);
  id(uid, 'reference UID');
  check(Object.hasOwn(state.physicalCardsByUID, uid), `reference ${uid} not a live physical card`);
  return Object.freeze({ uid, zoneEpoch: state.physicalCardsByUID[uid]!.zoneEpoch });
}
export function assertCurrentDuelPhysicalReference(state: DuelPermanentCandidate,
  proof: TrustedDuelPermanentInventory, ref: DuelPhysicalReference): void {
  assertDuelPermanentState(state, proof);
  const r = record(ref, ['uid', 'zoneEpoch'], 'physical reference');
  const uid = id(r.uid, 'reference UID');
  check(Object.hasOwn(state.physicalCardsByUID, uid) &&
    state.physicalCardsByUID[uid]!.zoneEpoch === epoch(r.zoneEpoch, 'reference epoch'),
  `stale physical reference ${uid}`);
  // A pre-exit trigger source is NOT a current-object reference; future trusted IR must
  // attest its actual pre-exit origin separately rather than applying this predicate.
}
/** A pure candidate helper: proposal ALREADY has new primary carriers and OLD origins.
 * The FULL, ordered, trusted outer transfer trace is mandatory; before/after alone cannot
 * detect hand->deck->hand in one mutation. Never allocates a frame/event clock. */
export function advanceDuelPhysicalZoneTransitions(before: DuelPermanentCandidate,
  proposal: DuelPermanentCandidate, independentInventory: TrustedDuelPermanentInventory,
  rawSteps: readonly DuelPhysicalZoneTransition[],
  proposalInventory: TrustedDuelPermanentInventory = independentInventory): {
    readonly state: DuelPermanentCandidate; readonly nextInventory: TrustedDuelPermanentInventory;
  } {
  assertDuelPermanentState(before, independentInventory);
  const from = restoreDuelPermanentState(before, independentInventory);
  // Token birth/retire is intentionally the only carrier-set delta accepted here.  The
  // proposal is checked against its post-lifecycle inventory, while the before side remains
  // checked against the inventory that actually admitted it; one union proof would permit
  // orphan token keys on either side.
  const to = restoreDuelPermanentState(proposal, proposalInventory);
  const previous = carriers(from, from.gears, from.chainCards ?? []),
    next = carriers(to, to.gears, to.chainCards ?? []);
  // Physical cards still cannot be created, retired, or replaced by this helper.  Token
  // lifecycle kernels are the one deliberate exception: a trusted outer executor may add or
  // retire a Gold/Unit token, while this helper continues to protect every physical identity.
  const physicalUIDs = new Set(Object.keys(from.physicalCardsByUID));
  for (const uid of physicalUIDs)
    check(previous.has(uid) && next.has(uid), `physical transfer ${uid} cannot create/retire a carrier`);
  for (const [uid, old] of previous) {
    const current = next.get(uid);
    if (!physicalUIDs.has(uid)) {
      check(current === undefined || current.kind === old.kind,
        `token transfer ${uid} changed carrier kind`);
    }
  }
  for (const [uid, current] of next) if (!previous.has(uid)) {
    check(!physicalUIDs.has(uid) && (current.kind === 'gold' ||
      (current.kind === 'unit' && current.cardId === null)),
    `unproved non-token carrier ${uid} was created`);
  }
  check(from.retiredPhysicalUIDs.every((uid, i) => uid === to.retiredPhysicalUIDs[i]),
    'transfer cannot alter retirement');
  for (const [uid, old] of Object.entries(from.physicalCardsByUID)) {
    const target = to.physicalCardsByUID[uid];
    check(target && target.cardId === old.cardId && target.ownerPlayerId === old.ownerPlayerId &&
      target.origin === old.origin && target.zoneEpoch === old.zoneEpoch,
    `transfer ${uid} cannot forge original identity/epoch`);
  }
  const steps = list(rawSteps, 'ordered trusted transfers').map((raw, i) => {
    const r = record(raw, ['uid', 'from', 'to'], `steps[${i}]`);
    const uid = id(r.uid, `steps[${i}].uid`);
    check(Object.hasOwn(from.physicalCardsByUID, uid), `steps[${i}] no live physical UID`);
    const origin = parseZone(r.from, from, `steps[${i}].from`);
    const destination = parseZone(r.to, to, `steps[${i}].to`);
    check(zoneKey(origin) !== zoneKey(destination), `steps[${i}] unchanged zone`);
    return { uid, from: origin, to: destination };
  });
  const position = new Map<string, DuelPhysicalZone>();
  const bumped = new Map<string, number>();
  for (const [uid, item] of previous) if (Object.hasOwn(from.physicalCardsByUID, uid)) {
    position.set(uid, item.zone); bumped.set(uid, 0);
  }
  for (const step of steps) {
    check(zoneKey(position.get(step.uid)!) === zoneKey(step.from), `out-of-order transfer for ${step.uid}`);
    if (nonBoard(step.from) || nonBoard(step.to)) {
      const number = bumped.get(step.uid)! + 1;
      check(Number.isSafeInteger(from.physicalCardsByUID[step.uid]!.zoneEpoch + number),
        `zoneEpoch overflow ${step.uid}`);
      bumped.set(step.uid, number);
    }
    position.set(step.uid, step.to);
  }
  for (const [uid, old] of previous) {
    const current = next.get(uid);
    if (Object.hasOwn(from.physicalCardsByUID, uid)) {
      check(current !== undefined, `physical carrier ${uid} disappeared`);
      check(zoneKey(position.get(uid)!) === zoneKey(current.zone), `missing/fabricated ordered transfer for ${uid}`);
      check(old.kind === current.kind ||
        (old.kind === 'champion' && (current.kind === 'unit' || current.kind === 'card')) ||
        (old.kind === 'unit' && (current.kind === 'card' || current.kind === 'champion')) ||
        (old.kind === 'card' && (current.kind === 'unit' || current.kind === 'gear' || current.kind === 'champion')) ||
        (old.kind === 'gear' && current.kind === 'card'), `illegal carrier kind transfer ${uid}`);
    } else if (current !== undefined) {
      check(old.kind === current.kind, `token category changed ${uid}`);
    }
  }
  const origins = Object.create(null) as Record<string, DuelPhysicalCardOrigin>;
  const expected = Object.assign(Object.create(null) as Record<string, number>, independentInventory.expectedZoneEpochByUID);
  for (const [uid, value] of Object.entries(from.physicalCardsByUID)) {
    const zoneEpoch = value.zoneEpoch + bumped.get(uid)!;
    origins[uid] = { ...value, zoneEpoch }; expected[uid] = zoneEpoch;
  }
  const state = { ...to, physicalCardsByUID: origins };
  // Preserve independently attested token-owner keys from the post-lifecycle proposal while
  // deriving physical epochs from the before-side history. Token proof must not regress to the
  // old inventory merely because this helper is also used for physical traces.
  const nextInventory = { ...proposalInventory, expectedZoneEpochByUID: expected };
  assertDuelPermanentState(state, nextInventory);
  return { state, nextInventory };
}
/** Pure attached-Gear candidate edits; never parses printed text or changes the host's
 * controller/readiness. The caller must authorize timing, targets and outer commit. */
export function attachDuelGear(state: DuelPermanentCandidate, proof: TrustedDuelPermanentInventory,
  uid: string, hostUID: string | null): DuelPermanentCandidate {
  const source = restoreDuelPermanentState(state, proof);
  id(uid, 'Gear UID');
  check(hostUID === null || typeof hostUID === 'string', 'host UID');
  const index = source.gears.findIndex(gear => gear.uid === uid);
  check(index >= 0, `unknown Gear ${uid}`);
  const gears = source.gears.map((gear, i) => i === index ? { ...gear, attachedToUID: hostUID } : gear);
  const next = { ...source, gears };
  assertDuelPermanentState(next, proof);
  return next;
}
/** Reconcile attachments after a trusted board-only Unit relocation; descendants of an
 * attached Gear follow its new location, with no Move, epoch, control or ready changes. */
export function followDuelAttachedHostMove(state: DuelPermanentCandidate,
  proof: TrustedDuelPermanentInventory, board: DuelBoard): DuelPermanentCandidate {
  const source = restoreDuelPermanentState(state, proof);
  assertDuelBoard(board);
  check(board.playerIds.every((id, i) => id === source.board.playerIds[i]), 'host-move board seats');
  check(source.board.units.length === board.units.length &&
    source.board.units.every(unit => board.units.some(now => now.objectId === unit.objectId &&
      now.controllerPlayerId === unit.controllerPlayerId)), 'host-move may only relocate existing Units');
  check(JSON.stringify(source.board.bases.map(b => [b.locationId, b.ownerPlayerId])) ===
    JSON.stringify(board.bases.map(b => [b.locationId, b.ownerPlayerId])) &&
    JSON.stringify(source.board.battlefields.map(b => [b.instanceId, b.cardId, b.ownerPlayerId])) ===
    JSON.stringify(board.battlefields.map(b => [b.instanceId, b.cardId, b.ownerPlayerId])),
  'host-move cannot replace locations/identities');
  // Board is already strictly checked, but detach it from the caller before publishing.
  const copied = { ...source, board: {
    ...board, playerIds: [...board.playerIds], bases: board.bases.map(b => ({ ...b, occupancy: [...b.occupancy] })),
    battlefields: board.battlefields.map(b => ({ ...b, occupancy: [...b.occupancy] })),
    units: board.units.map(u => ({ ...u })),
  } };
  const moved = new Map(board.units.map(u => [u.objectId, u.locationId]));
  const gears = source.gears.map(g => ({ ...g }));
  const pending = new Map(gears.map(g => [g.uid, g]));
  function place(uid: string, path = new Set<string>()): string {
    if (moved.has(uid)) return moved.get(uid)!;
    const gear = pending.get(uid);
    check(gear && !path.has(uid), `unknown/cyclic host ${uid}`);
    path.add(uid);
    if (gear.attachedToUID !== null) gear.locationId = place(gear.attachedToUID, path);
    path.delete(uid);
    return gear.locationId;
  }
  for (const gear of gears) place(gear.uid);
  const next = { ...copied, gears };
  assertDuelPermanentState(next, proof);
  return next;
}
/** Detach before a card-Unit/Gear host exits board; unattached Gear stays where it was.
 * The outer executor must then move the host via advanceDuelPhysicalZoneTransitions.
 * No speculative Kill/Recall, Gear creation or event clock occurs here. */
export function detachDuelGearsBeforeHostExit(state: DuelPermanentCandidate,
  proof: TrustedDuelPermanentInventory, hostUID: string): DuelPermanentCandidate {
  const source = restoreDuelPermanentState(state, proof);
  id(hostUID, 'exiting host UID');
  check(source.board.units.some(u => u.objectId === hostUID &&
    source.unitMeta[hostUID]!.trait.kind === 'card') || source.gears.some(g => g.uid === hostUID),
  'exit host must be a card Unit or Gear currently on board');
  const gears = source.gears.map(g => g.uid === hostUID || g.attachedToUID === hostUID
    ? { ...g, attachedToUID: null } : g);
  const next = { ...source, gears };
  assertDuelPermanentState(next, proof);
  return next;
}
