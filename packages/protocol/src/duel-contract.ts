// Public Duel V1/V2/V3 wire DTOs. No engine import: engine-core already depends on protocol.
// These shapes describe allowlisted public projections, not trusted archives or turn executors.
export const DUEL_RULESET_ID = 'riftbound-duel' as const;
/** The existing V1 projection schema remains unchanged. */
export const DUEL_PROJECTION_SCHEMA = 'riftbound-duel-v1' as const;
export const DUEL_PROJECTION_SCHEMA_V2 = 'riftbound-duel-v2' as const;
export const DUEL_PROJECTION_SCHEMA_V3 = 'riftbound-duel-v3' as const;
export const DUEL_POWER_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const;
export type DuelWireDomain = (typeof DUEL_POWER_DOMAINS)[number];
export type DuelWirePowerSource = DuelWireDomain | 'any';

export interface DuelWireCard { readonly uid: string; readonly cardId: string }
export interface DuelWirePerson { readonly playerId: string; readonly displayName: string }
interface DuelWireCommon<Version extends 1 | 2 | 3> {
  readonly schemaVersion: Version;
  readonly rulesetId: typeof DUEL_RULESET_ID;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly roster: readonly [DuelWirePerson, DuelWirePerson];
  readonly turnOrder: readonly [string, string];
}
export interface DuelWireSetupPlayer {
  readonly playerId: string;
  readonly legend: { readonly cardId: string };
  readonly champion: { readonly cardId: string };
  readonly handCount: number;
  readonly mainDeckCount: number;
  readonly runeDeckCount: number;
  readonly mulliganStatus: 'pending' | 'complete';
  /** Absent, not an empty hand, for everyone other than the authenticated viewer. */
  readonly hand?: readonly DuelWireCard[];
}
export interface DuelWireSetup {
  readonly stage: 'mulligan' | 'complete';
  readonly turnOrder: readonly [string, string];
  readonly firstPlayerId: string;
  readonly currentMulliganOwner: string | null;
  readonly players: readonly [DuelWireSetupPlayer, DuelWireSetupPlayer];
  readonly selectedBattlefields: readonly { readonly playerId: string; readonly instanceId: string; readonly cardId: string }[];
}
interface DuelWireMatchSetupShape<Version extends 1 | 2 | 3> extends DuelWireCommon<Version> {
  readonly stage: 'setup';
  readonly setup: DuelWireSetup;
}
/** The original setup type remains fixed to schemaVersion 1. */
export type DuelWireMatchSetup = DuelWireMatchSetupShape<1>;
export type DuelWireMatchSetupV2 = DuelWireMatchSetupShape<2>;
/** V3 setup has no permanent fields; only its schemaVersion changes. */
export type DuelWireMatchSetupV3 = DuelWireMatchSetupShape<3>;
export interface DuelWirePlayingPlayer {
  readonly playerId: string;
  readonly champion: { readonly cardId: string } | null;
  readonly legend: { readonly cardId: string };
  readonly handCount: number;
  readonly mainDeckCount: number;
  readonly hand?: readonly DuelWireCard[];
  readonly trash: readonly DuelWireCard[];
}
export interface DuelWireBase {
  readonly locationId: string;
  readonly ownerPlayerId: string;
  readonly occupancy: readonly string[];
}
export type DuelWireEngagement = 'none' | 'staged' | 'active';
export interface DuelWireBattlefield {
  readonly locationId: string;
  readonly instanceId: string;
  readonly cardId: string;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string | null;
  readonly contested: boolean;
  readonly contestingPlayerId: string | null;
  readonly showdown: DuelWireEngagement;
  readonly combat: DuelWireEngagement;
  readonly occupancy: readonly string[];
}
export type DuelWireUnitTrait =
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'token'; readonly name: string; readonly baseMight: number; readonly tags: readonly string[] };
export interface DuelWireUnit {
  readonly objectId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly ownerPlayerId: string;
  readonly readied: boolean;
  readonly trait: DuelWireUnitTrait;
  readonly totalDamage: number;
  readonly damageMarks: readonly { readonly amount: number; readonly responsiblePlayerId: string }[];
}
export interface DuelWireBoard {
  readonly bases: readonly [DuelWireBase, DuelWireBase];
  readonly battlefields: readonly [DuelWireBattlefield, DuelWireBattlefield];
  readonly units: readonly DuelWireUnit[];
}
/** Public V3 permanent fields are playing-only; no private owner/epoch/provenance. */
export interface DuelWireGearPermanent {
  readonly uid: string;
  readonly cardId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly readied: boolean;
  readonly attachedToUID: string | null;
}
export type DuelWireLegendReadiness = 'not-established' | 'ready' | 'exhausted';
export interface DuelWireLegendPermanent {
  readonly cardId: string;
  readonly controllerPlayerId: string;
  readonly readiness: DuelWireLegendReadiness;
}
export type DuelWirePlayingPlayerV3 = Omit<DuelWirePlayingPlayer, 'legend'> & {
  readonly legend: DuelWireLegendPermanent;
};
export type DuelWireBoardV3 = DuelWireBoard & {
  readonly gears: readonly DuelWireGearPermanent[];
};
export interface DuelWireRunePool {
  readonly energy: number;
  readonly power: Readonly<Record<DuelWirePowerSource, number>>;
}
export interface DuelWireBaseRune extends DuelWireCard {
  readonly domain: DuelWireDomain;
  readonly readied: boolean;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
}
export interface DuelWireGoldToken {
  readonly uid: string;
  readonly readied: boolean;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
}
export interface DuelWireResourceBase {
  readonly playerId: string;
  readonly locationId: string;
  readonly baseRunes: readonly DuelWireBaseRune[];
  readonly goldTokens: readonly DuelWireGoldToken[];
}
export interface DuelWireResources {
  readonly players: readonly [
    { readonly playerId: string; readonly runePool: DuelWireRunePool; readonly runeDeckCount: number },
    { readonly playerId: string; readonly runePool: DuelWireRunePool; readonly runeDeckCount: number },
  ];
  readonly bases: readonly [DuelWireResourceBase, DuelWireResourceBase];
}
export interface DuelWireScoring {
  readonly playerIds: readonly [string, string];
  readonly battlefieldLocationIds: readonly [string, string];
  readonly victoryScore: number;
  /** The constructor's first awaiting-turn-start frame has turnNumber 1 but scoring.turnNumber 0. */
  readonly turnNumber: number;
  readonly players: readonly [
    { readonly playerId: string; readonly points: number; readonly scoredBattlefieldLocationIds: readonly string[] },
    { readonly playerId: string; readonly points: number; readonly scoredBattlefieldLocationIds: readonly string[] },
  ];
}
export interface DuelWireRuneCost {
  readonly energy: number;
  readonly power: readonly { readonly allowedDomains: readonly DuelWireDomain[]; readonly amount: number }[];
}
export interface DuelWireFrame {
  readonly phase: 'awaiting-turn-start' | 'awaken' | 'beginning' | 'scoring' | 'channel' |
    'draw' | 'main' | 'ending' | 'expiration' | 'ended';
  readonly turnNumber: number;
  readonly turnPlayerId: string;
  readonly priorityPlayerId: string | null;
  readonly focusPlayerId: string | null;
  readonly stateOpen: boolean;
  /** The cost/ID may only be projected to the payment actor by the trusted projector. */
  readonly pendingPayment: null | { readonly active: true; readonly paymentId?: string; readonly resolvedCost?: DuelWireRuneCost };
}
interface DuelWireMatchPlayingShape<Version extends 1 | 2> extends DuelWireCommon<Version> {
  readonly stage: 'playing';
  readonly players: readonly [DuelWirePlayingPlayer, DuelWirePlayingPlayer];
  readonly board: DuelWireBoard;
  readonly resources: DuelWireResources;
  readonly scoring: DuelWireScoring;
  readonly frame: DuelWireFrame;
}
export type DuelWireMatchPlaying = DuelWireMatchPlayingShape<1>;
export type DuelWireMatchPlayingV2 = DuelWireMatchPlayingShape<2>;
export interface DuelWireMatchPlayingV3 extends DuelWireCommon<3> {
  readonly stage: 'playing';
  readonly players: readonly [DuelWirePlayingPlayerV3, DuelWirePlayingPlayerV3];
  readonly board: DuelWireBoardV3;
  readonly resources: DuelWireResources;
  readonly scoring: DuelWireScoring;
  readonly frame: DuelWireFrame;
}
/** Existing V1 names remain fixed to schemaVersion 1 for source compatibility. */
export type DuelWireMatch = DuelWireMatchSetup | DuelWireMatchPlaying;
export type DuelWireMatchV2 = DuelWireMatchSetupV2 | DuelWireMatchPlayingV2;
export type DuelWireMatchV3 = DuelWireMatchSetupV3 | DuelWireMatchPlayingV3;

interface DuelWireActionBase {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
}
/** Display options from server authority; never infer a legal command from an empty options list. */
export type DuelWireAction =
  | (DuelWireActionBase & { readonly kind: 'mulligan'; readonly selectableUIDs: readonly string[]; readonly maxSelections: 2 })
  | (DuelWireActionBase & { readonly kind: 'rune-energy' | 'rune-power' | 'gold-power'; readonly uid: string })
  | (DuelWireActionBase & { readonly kind: 'pay-pending'; readonly paymentId: string; readonly resolvedCost?: DuelWireRuneCost });
interface DuelProjectionShape<Schema extends string, Match extends DuelWireMatch | DuelWireMatchV2 | DuelWireMatchV3> {
  readonly projectionSchema: Schema;
  readonly viewerPlayerId: string | null;
  readonly match: Match;
  readonly actions: readonly DuelWireAction[];
}
export type DuelProjectionV1 = DuelProjectionShape<typeof DUEL_PROJECTION_SCHEMA, DuelWireMatch>;
export type DuelProjectionV2 = DuelProjectionShape<typeof DUEL_PROJECTION_SCHEMA_V2, DuelWireMatchV2>;
export type DuelProjectionV3 = DuelProjectionShape<typeof DUEL_PROJECTION_SCHEMA_V3, DuelWireMatchV3>;
/** Original public name stays V1-only: existing consumers may rely on schemaVersion 1. */
export type DuelProjection = DuelProjectionV1;
/** Explicit versioned wire union; projectionSchema fixes match.schemaVersion in each arm. */
export type DuelProjectionAny = DuelProjectionV1 | DuelProjectionV2 | DuelProjectionV3;
/** Actor and timing/cost authority come solely from the authenticated server context. */
export type DuelWireCommand =
  | { readonly type: 'mulligan'; readonly selectedUIDs: readonly string[] }
  | { readonly type: 'rune-energy' | 'rune-power' | 'gold-power'; readonly uid: string }
  | { readonly type: 'pay-pending'; readonly paymentId: string; readonly plan?: {
      readonly power: readonly { readonly requirementIndex: number; readonly from: DuelWirePowerSource; readonly amount: number }[];
    } };
export interface DuelCommandMessage {
  readonly type: 'duel-command';
  readonly requestId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelWireCommand;
}
export interface DuelProjectionMessage {
  readonly type: 'duel-projection';
  readonly roomId: string;
  readonly projection: DuelProjection;
}
export interface DuelProjectionMessageV2 {
  readonly type: 'duel-projection';
  readonly roomId: string;
  readonly projection: DuelProjectionV2;
}
export interface DuelProjectionMessageV3 {
  readonly type: 'duel-projection';
  readonly roomId: string;
  readonly projection: DuelProjectionV3;
}
/** Explicit versioned packet; the legacy DuelProjectionMessage remains V1-only. */
export type DuelProjectionMessageAny = DuelProjectionMessage | DuelProjectionMessageV2 | DuelProjectionMessageV3;

// These guards check the JSON-compatible public wire. They do NOT authenticate a viewer,
// validate an archive, prove a legal action, or convert a client command to ActorContext.
// The private pending actor is absent from the public DTO, so a guard cannot prove that
// pendingPayment cost/ID belongs to viewerPlayerId (priorityPlayerId is not the actor).
// The server must bind the authenticated viewer to a trusted projector and run the
// versioned outbound guard before sending; never attach the private actor to the DTO.
type Data = Record<string, unknown>;
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const keys = Reflect.ownKeys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => {
    if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor;
  });
}
function array(value: unknown, length?: number): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      (length !== undefined && value.length !== length) ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) return false;
  }
  return true;
}
function id(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function count(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function ids(raw: unknown): raw is readonly string[] {
  return array(raw) && raw.every(id) && unique(raw as string[]);
}
function pair(raw: unknown): raw is readonly [unknown, unknown] { return array(raw, 2); }
function player(raw: unknown, seats: readonly string[]): raw is string {
  return id(raw) && seats.includes(raw);
}
function nullablePlayer(raw: unknown, seats: readonly string[]): raw is string | null {
  return raw === null || player(raw, seats);
}
function card(raw: unknown): raw is DuelWireCard {
  return exact(raw, ['uid', 'cardId']) && id(raw.uid) && id(raw.cardId);
}
function cards(raw: unknown): raw is readonly DuelWireCard[] {
  return array(raw) && raw.every(card) && unique(raw.map(item => (item as DuelWireCard).uid));
}
function printing(raw: unknown): raw is { readonly cardId: string } {
  return exact(raw, ['cardId']) && id(raw.cardId);
}
function setupPlayer(raw: unknown, seat: string, viewer: string | null): raw is DuelWireSetupPlayer {
  return exact(raw, ['playerId', 'legend', 'champion', 'handCount', 'mainDeckCount',
    'runeDeckCount', 'mulliganStatus'], ['hand']) && raw.playerId === seat &&
    printing(raw.legend) && printing(raw.champion) && count(raw.handCount) &&
    count(raw.mainDeckCount) && count(raw.runeDeckCount) &&
    (raw.mulliganStatus === 'pending' || raw.mulliganStatus === 'complete') &&
    (viewer === seat ? cards(raw.hand) && raw.hand.length === raw.handCount : !Object.hasOwn(raw, 'hand'));
}
function setup(raw: unknown, seats: readonly [string, string], order: readonly [string, string],
  viewer: string | null): raw is DuelWireSetup {
  if (!exact(raw, ['stage', 'turnOrder', 'firstPlayerId', 'currentMulliganOwner',
    'players', 'selectedBattlefields']) ||
    (raw.stage !== 'mulligan' && raw.stage !== 'complete') ||
    !pair(raw.turnOrder) || raw.turnOrder[0] !== order[0] || raw.turnOrder[1] !== order[1] ||
    raw.firstPlayerId !== order[0] || !pair(raw.players) ||
    !setupPlayer(raw.players[0], seats[0], viewer) || !setupPlayer(raw.players[1], seats[1], viewer) ||
    !array(raw.selectedBattlefields, 2)) return false;
  const fields = raw.selectedBattlefields;
  if (!fields.every((field, i) => exact(field, ['playerId', 'instanceId', 'cardId']) &&
    field.playerId === seats[i] && id(field.instanceId) && id(field.cardId)) ||
    !unique(fields.map(field => (field as { instanceId: string }).instanceId))) return false;
  const players = raw.players as readonly [DuelWireSetupPlayer, DuelWireSetupPlayer];
  const fieldIds = fields.map(field => (field as { instanceId: string }).instanceId);
  const locations = [...seats.map(seat => JSON.stringify(['duel-base', seat])),
    ...fieldIds.map(instanceId => JSON.stringify(['duel-battlefield', instanceId]))];
  if (!unique([...seats, ...fieldIds, ...locations,
    ...players.flatMap(p => p.hand?.map(c => c.uid) ?? [])]) ||
    fields.some(field => locations.includes((field as { cardId: string }).cardId))) return false;
  const due = order.find(seat => players.find(p => p.playerId === seat)?.mulliganStatus === 'pending') ?? null;
  return (raw.stage === 'complete' && due === null && raw.currentMulliganOwner === null) ||
    (raw.stage === 'mulligan' && due !== null && raw.currentMulliganOwner === due &&
      players.find(p => p.playerId === order[1])?.mulliganStatus === 'pending');
}
function playingPlayer(raw: unknown, seat: string, viewer: string | null): raw is DuelWirePlayingPlayer {
  return exact(raw, ['playerId', 'champion', 'legend', 'handCount', 'mainDeckCount', 'trash'], ['hand']) &&
    raw.playerId === seat && (raw.champion === null || printing(raw.champion)) && printing(raw.legend) &&
    count(raw.handCount) && count(raw.mainDeckCount) && cards(raw.trash) &&
    (viewer === seat ? cards(raw.hand) && raw.hand.length === raw.handCount : !Object.hasOwn(raw, 'hand'));
}
function playingPlayerV3(raw: unknown, seat: string, seats: readonly string[],
  viewer: string | null, firstAwaiting: boolean): raw is DuelWirePlayingPlayerV3 {
  if (!exact(raw, ['playerId', 'champion', 'legend', 'handCount', 'mainDeckCount', 'trash'], ['hand']) ||
      raw.playerId !== seat || (raw.champion !== null && !printing(raw.champion)) ||
      !exact(raw.legend, ['cardId', 'controllerPlayerId', 'readiness']) ||
      !id(raw.legend.cardId) || !player(raw.legend.controllerPlayerId, seats) ||
      (raw.legend.readiness !== 'ready' && raw.legend.readiness !== 'exhausted' &&
        !(raw.legend.readiness === 'not-established' && firstAwaiting)) ||
      !count(raw.handCount) || !count(raw.mainDeckCount) || !cards(raw.trash)) return false;
  return viewer === seat ? cards(raw.hand) && raw.hand.length === raw.handCount : !Object.hasOwn(raw, 'hand');
}
function base(raw: unknown, owner: string): raw is DuelWireBase {
  return exact(raw, ['locationId', 'ownerPlayerId', 'occupancy']) && raw.ownerPlayerId === owner &&
    raw.locationId === JSON.stringify(['duel-base', owner]) && ids(raw.occupancy);
}
function battlefield(raw: unknown, owner: string, seats: readonly string[]): raw is DuelWireBattlefield {
  return exact(raw, ['locationId', 'instanceId', 'cardId', 'ownerPlayerId', 'controllerPlayerId',
    'contested', 'contestingPlayerId', 'showdown', 'combat', 'occupancy']) &&
    raw.ownerPlayerId === owner && id(raw.instanceId) && id(raw.cardId) &&
    raw.locationId === JSON.stringify(['duel-battlefield', raw.instanceId]) &&
    nullablePlayer(raw.controllerPlayerId, seats) && nullablePlayer(raw.contestingPlayerId, seats) &&
    typeof raw.contested === 'boolean' && raw.contested === (raw.contestingPlayerId !== null) &&
    (raw.contestingPlayerId === null || raw.contestingPlayerId !== raw.controllerPlayerId) &&
    (raw.showdown === 'none' || raw.showdown === 'staged' || raw.showdown === 'active') &&
    (raw.combat === 'none' || raw.combat === 'staged' || raw.combat === 'active') &&
    (raw.showdown !== 'none' || raw.combat === 'none') &&
    (raw.combat !== 'active' || raw.showdown === 'active') &&
    (raw.showdown === 'none' || raw.contested === true) && ids(raw.occupancy);
}
function trait(raw: unknown): raw is DuelWireUnitTrait {
  return (exact(raw, ['kind', 'cardId']) && raw.kind === 'card' && id(raw.cardId)) ||
    (exact(raw, ['kind', 'name', 'baseMight', 'tags']) && raw.kind === 'token' &&
      id(raw.name) && count(raw.baseMight) && ids(raw.tags));
}
function unit(raw: unknown, seats: readonly string[]): raw is DuelWireUnit {
  if (!exact(raw, ['objectId', 'controllerPlayerId', 'locationId', 'ownerPlayerId',
    'readied', 'trait', 'totalDamage', 'damageMarks']) || !id(raw.objectId) ||
    !player(raw.controllerPlayerId, seats) || !player(raw.ownerPlayerId, seats) ||
    !id(raw.locationId) || typeof raw.readied !== 'boolean' || !trait(raw.trait) ||
    !count(raw.totalDamage) || !array(raw.damageMarks)) return false;
  let sum = 0;
  for (const mark of raw.damageMarks) {
    if (!exact(mark, ['amount', 'responsiblePlayerId']) || !count(mark.amount, 1) ||
        !player(mark.responsiblePlayerId, seats)) return false;
    sum += mark.amount;
    if (!Number.isSafeInteger(sum)) return false;
  }
  return raw.totalDamage === sum;
}
function board(raw: unknown, seats: readonly [string, string]): raw is DuelWireBoard {
  if (!exact(raw, ['bases', 'battlefields', 'units']) || !pair(raw.bases) ||
    !pair(raw.battlefields) || !array(raw.units) ||
    !seats.every((seat, i) => base((raw.bases as readonly unknown[])[i], seat) &&
      battlefield((raw.battlefields as readonly unknown[])[i], seat, seats)) ||
    !raw.units.every(value => unit(value, seats))) return false;
  const bases = raw.bases as unknown as DuelWireBase[];
  const fields = raw.battlefields as unknown as DuelWireBattlefield[];
  const units = raw.units as DuelWireUnit[];
  const locations = [...bases, ...fields];
  const locationIds = locations.map(location => location.locationId);
  const occupied = locations.flatMap(location => location.occupancy);
  if (!unique([...seats, ...locationIds, ...fields.map(field => field.instanceId)]) ||
      !unique(units.map(value => value.objectId)) || !unique(occupied) ||
      !fields.every(field => !locationIds.includes(field.cardId)) ||
      units.some(value => seats.includes(value.objectId) || locationIds.includes(value.objectId) ||
        fields.some(field => field.instanceId === value.objectId)) ||
      units.length !== occupied.length ||
      fields.filter(field => field.showdown === 'active' || field.combat === 'active').length > 1) return false;
  for (const value of units) {
    const field = fields.find(item => item.locationId === value.locationId);
    const base = bases.find(item => item.locationId === value.locationId);
    if ((!field && !base) || !(field ?? base)!.occupancy.includes(value.objectId) ||
        (base && base.ownerPlayerId !== value.controllerPlayerId) ||
        (field && !field.contested &&
          (field.controllerPlayerId === null || value.controllerPlayerId !== field.controllerPlayerId))) return false;
  }
  return occupied.every(uid => units.some(value => value.objectId === uid));
}
function gearPermanent(raw: unknown, seats: readonly string[], locations: readonly string[]): raw is DuelWireGearPermanent {
  return exact(raw, ['uid', 'cardId', 'controllerPlayerId', 'locationId', 'readied', 'attachedToUID']) &&
    id(raw.uid) && id(raw.cardId) && player(raw.controllerPlayerId, seats) &&
    locations.includes(raw.locationId as string) && typeof raw.readied === 'boolean' &&
    (raw.attachedToUID === null || id(raw.attachedToUID));
}
function boardV3(raw: unknown, seats: readonly [string, string]): raw is DuelWireBoardV3 {
  if (!exact(raw, ['bases', 'battlefields', 'units', 'gears']) || !array(raw.gears) ||
      !board({ bases: raw.bases, battlefields: raw.battlefields, units: raw.units }, seats)) return false;
  const b = raw as unknown as DuelWireBoardV3;
  const locations = [...b.bases, ...b.battlefields];
  const locationIds = locations.map(location => location.locationId);
  if (!b.gears.every(gear => gearPermanent(gear, seats, locationIds)) ||
      !unique(b.gears.map(gear => gear.uid))) return false;
  const byGear = new Map(b.gears.map(gear => [gear.uid, gear]));
  const cardUnits = new Map(b.units.filter(unit => unit.trait.kind === 'card')
    .map(unit => [unit.objectId, unit]));
  for (const gear of b.gears) {
    if (gear.attachedToUID !== null) {
      const host = cardUnits.get(gear.attachedToUID) ?? byGear.get(gear.attachedToUID);
      if (!host || host.locationId !== gear.locationId) return false;
    }
    const base = b.bases.find(base => base.locationId === gear.locationId);
    const hostController = gear.attachedToUID === null ? null :
      (cardUnits.get(gear.attachedToUID) ?? byGear.get(gear.attachedToUID))?.controllerPlayerId;
    if (base && base.ownerPlayerId !== gear.controllerPlayerId &&
        base.ownerPlayerId !== hostController) return false;
    const visited = new Set([gear.uid]);
    let next = gear.attachedToUID;
    while (next !== null && byGear.has(next)) {
      if (visited.has(next)) return false;
      visited.add(next);
      next = byGear.get(next)!.attachedToUID;
    }
  }
  return true;
}
function pool(raw: unknown): raw is DuelWireRunePool {
  if (!exact(raw, ['energy', 'power']) || !count(raw.energy) ||
    !exact(raw.power, [...DUEL_POWER_DOMAINS, 'any'])) return false;
  let total = raw.energy;
  for (const source of [...DUEL_POWER_DOMAINS, 'any']) {
    const value = raw.power[source];
    if (!count(value)) return false;
    total += value;
    if (!Number.isSafeInteger(total)) return false;
  }
  return true;
}
function resourceBase(raw: unknown, seat: string, locationId: string): raw is DuelWireResourceBase {
  if (!exact(raw, ['playerId', 'locationId', 'baseRunes', 'goldTokens']) ||
      raw.playerId !== seat || raw.locationId !== locationId || !array(raw.baseRunes) ||
      !array(raw.goldTokens)) return false;
  return raw.baseRunes.every(r => exact(r, ['uid', 'cardId', 'domain', 'readied',
    'ownerPlayerId', 'controllerPlayerId', 'locationId']) && id(r.uid) && id(r.cardId) &&
    DUEL_POWER_DOMAINS.some(domain => domain === r.domain) && typeof r.readied === 'boolean' &&
    r.ownerPlayerId === seat && r.controllerPlayerId === seat && r.locationId === locationId) &&
    raw.goldTokens.every(g => exact(g, ['uid', 'readied', 'ownerPlayerId', 'controllerPlayerId', 'locationId']) &&
      id(g.uid) && typeof g.readied === 'boolean' && g.ownerPlayerId === seat &&
      g.controllerPlayerId === seat && g.locationId === locationId);
}
function resources(raw: unknown, seats: readonly [string, string], bases: DuelWireBoard['bases']): raw is DuelWireResources {
  if (!exact(raw, ['players', 'bases']) || !pair(raw.players) || !pair(raw.bases)) return false;
  const players = raw.players;
  const resourceBases = raw.bases;
  if (!seats.every((seat, i) => {
    const p = players[i];
    return exact(p, ['playerId', 'runePool', 'runeDeckCount']) && p.playerId === seat &&
      pool(p.runePool) && count(p.runeDeckCount) && resourceBase(resourceBases[i], seat, bases[i]!.locationId);
  })) return false;
  return unique((resourceBases as readonly [DuelWireResourceBase, DuelWireResourceBase]).flatMap(b =>
    [...b.baseRunes.map(r => r.uid), ...b.goldTokens.map(g => g.uid)]));
}
function scoring(raw: unknown, seats: readonly [string, string], fields: DuelWireBoard['battlefields'],
  turnNumber: number): raw is DuelWireScoring {
  if (!exact(raw, ['playerIds', 'battlefieldLocationIds', 'victoryScore', 'turnNumber', 'players']) ||
    !pair(raw.playerIds) || !pair(raw.battlefieldLocationIds) || !pair(raw.players) ||
    !count(raw.victoryScore, 1) || !count(raw.turnNumber) || raw.turnNumber > turnNumber) return false;
  const playerIds = raw.playerIds, fieldIds = raw.battlefieldLocationIds, players = raw.players;
  if (!seats.every((seat, i) => playerIds[i] === seat && fieldIds[i] === fields[i]!.locationId)) return false;
  return seats.every((seat, i) => {
    const value = players[i];
    return exact(value, ['playerId', 'points', 'scoredBattlefieldLocationIds']) &&
      value.playerId === seat && count(value.points) && ids(value.scoredBattlefieldLocationIds) &&
      value.scoredBattlefieldLocationIds.every(location =>
        (raw.battlefieldLocationIds as string[]).includes(location));
  });
}
export function isDuelRuneCost(raw: unknown): raw is DuelWireRuneCost {
  if (!exact(raw, ['energy', 'power']) || !count(raw.energy) || !array(raw.power)) return false;
  let total = raw.energy;
  for (const item of raw.power) {
    if (!exact(item, ['allowedDomains', 'amount']) || !array(item.allowedDomains) ||
      item.allowedDomains.length === 0 || item.allowedDomains.length > DUEL_POWER_DOMAINS.length ||
      !unique(item.allowedDomains as string[]) ||
      !item.allowedDomains.every(domain => DUEL_POWER_DOMAINS.some(allowed => allowed === domain)) ||
      !count(item.amount, 1)) return false;
    total += item.amount;
    if (!Number.isSafeInteger(total)) return false;
  }
  return true;
}
function frame(raw: unknown, seats: readonly string[], viewer: string | null): raw is DuelWireFrame {
  if (!exact(raw, ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId',
    'focusPlayerId', 'stateOpen', 'pendingPayment']) ||
    !(['awaiting-turn-start', 'awaken', 'beginning', 'scoring', 'channel', 'draw',
      'main', 'ending', 'expiration', 'ended'] as unknown[]).includes(raw.phase) ||
    !count(raw.turnNumber, 1) || !player(raw.turnPlayerId, seats) ||
    !nullablePlayer(raw.priorityPlayerId, seats) || !nullablePlayer(raw.focusPlayerId, seats) ||
    typeof raw.stateOpen !== 'boolean' ||
    (raw.phase === 'awaiting-turn-start' && (raw.priorityPlayerId !== null || raw.pendingPayment !== null))) return false;
  if (raw.pendingPayment === null) return true;
  const pending = raw.pendingPayment;
  return exact(pending, ['active'], ['paymentId', 'resolvedCost']) && pending.active === true &&
    Object.hasOwn(pending, 'paymentId') === Object.hasOwn(pending, 'resolvedCost') &&
    (!Object.hasOwn(pending, 'paymentId') ||
      (viewer !== null && id(pending.paymentId) && isDuelRuneCost(pending.resolvedCost))) &&
    raw.phase !== 'awaiting-turn-start' && raw.phase !== 'ended';
}
// One public allowlist parser for three fixed version pairs; V3 cannot loosen V1/V2.
function isDuelMatchVersion(match: unknown, matchVersion: 1 | 2 | 3,
  viewer: string | null): match is DuelWireMatch | DuelWireMatchV2 | DuelWireMatchV3 {
  if (!exact(match, ['schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
    'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'stage'],
    ['setup', 'players', 'board', 'resources', 'scoring', 'frame']) ||
    match.schemaVersion !== matchVersion || match.rulesetId !== DUEL_RULESET_ID ||
    !id(match.matchId) || !id(match.dataVersion) || !id(match.catalogDigest) ||
    !count(match.stateVersion) || !count(match.eventSeq) ||
    !pair(match.roster) || !match.roster.every(person => exact(person, ['playerId', 'displayName']) &&
      id(person.playerId) && id(person.displayName)) ||
    !pair(match.turnOrder)) return false;
  const seats = match.roster.map(person => (person as DuelWirePerson).playerId) as [string, string];
  if (!unique(seats) || (viewer !== null && !seats.includes(viewer)) ||
    !ids(match.turnOrder) || !seats.every(seat => (match.turnOrder as string[]).includes(seat))) return false;
  const order = match.turnOrder as [string, string];
  if (match.stage === 'setup') {
    if (!exact(match, ['schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
      'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'stage', 'setup']) ||
      !setup(match.setup, seats, order, viewer)) return false;
  } else if (match.stage === 'playing') {
    if (!exact(match, ['schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
      'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'stage', 'players', 'board',
      'resources', 'scoring', 'frame']) || !pair(match.players) ||
      (matchVersion === 3
        ? !frame(match.frame, seats, viewer) ||
          !seats.every((seat, i) => playingPlayerV3((match.players as readonly unknown[])[i],
            seat, seats, viewer, (match.frame as DuelWireFrame).phase === 'awaiting-turn-start' &&
              (match.frame as DuelWireFrame).turnNumber === 1)) ||
          !boardV3(match.board, seats)
        : !seats.every((seat, i) => playingPlayer((match.players as readonly unknown[])[i], seat, viewer)) ||
          !board(match.board, seats))) return false;
    const b = match.board as DuelWireBoard | DuelWireBoardV3;
    if (!resources(match.resources, seats, b.bases) || !frame(match.frame, seats, viewer) ||
        !scoring(match.scoring, seats, b.battlefields, (match.frame as DuelWireFrame).turnNumber)) return false;
    // Visible object identities cannot alias another visible zone or selected battlefield.
    const players = match.players as readonly [DuelWirePlayingPlayer, DuelWirePlayingPlayer];
    const rs = match.resources as DuelWireResources;
    const visible = [...players.flatMap(p => [...(p.hand ?? []), ...p.trash].map(c => c.uid)),
      ...rs.bases.flatMap(base => [...base.baseRunes, ...base.goldTokens].map(c => c.uid)),
      ...b.units.map(unit => unit.objectId), ...b.battlefields.map(field => field.instanceId),
      ...(matchVersion === 3 ? (b as DuelWireBoardV3).gears.map(gear => gear.uid) : [])];
    if (!unique(visible) || visible.some(uid => seats.includes(uid) ||
        [...b.bases, ...b.battlefields].some(location => location.locationId === uid))) return false;
  } else return false;
  return true;
}
function isDuelProjectionVersion(raw: unknown, schema: string, matchVersion: 1 | 2 | 3): boolean {
  if (!exact(raw, ['projectionSchema', 'viewerPlayerId', 'match', 'actions']) ||
    raw.projectionSchema !== schema || !array(raw.actions) ||
    (raw.viewerPlayerId !== null && !id(raw.viewerPlayerId)) ||
    !isDuelMatchVersion(raw.match, matchVersion, raw.viewerPlayerId as string | null)) return false;
  const match = raw.match;
  const viewer = raw.viewerPlayerId as string | null;
  if (viewer === null && raw.actions.length !== 0) return false;
  if (match.stage === 'setup' && (match.setup.stage === 'complete' ||
    match.setup.currentMulliganOwner !== viewer) && raw.actions.length !== 0) return false;
  if (match.stage === 'playing' && (match.frame.phase === 'ended' ||
    match.frame.phase === 'awaiting-turn-start') && raw.actions.length !== 0) return false;
  const actionIds = new Set<string>();
  for (const action of raw.actions) {
    if (!isDuelAction(action, match, viewer) || actionIds.has(action.id)) return false;
    actionIds.add(action.id);
  }
  return true;
}
/** The original schema's guard remains V1-only for consumers requiring an exact version. */
export function isDuelProjectionV1(raw: unknown): raw is DuelProjectionV1 {
  return isDuelProjectionVersion(raw, DUEL_PROJECTION_SCHEMA, 1);
}
export function isDuelProjectionV2(raw: unknown): raw is DuelProjectionV2 {
  return isDuelProjectionVersion(raw, DUEL_PROJECTION_SCHEMA_V2, 2);
}
export function isDuelProjectionV3(raw: unknown): raw is DuelProjectionV3 {
  return isDuelProjectionVersion(raw, DUEL_PROJECTION_SCHEMA_V3, 3);
}
/** Retained original name: only V1 is accepted. */
export function isDuelProjection(raw: unknown): raw is DuelProjection {
  return isDuelProjectionV1(raw);
}
/** Opt in to all supported schema/version pairs explicitly. */
export function isDuelProjectionAny(raw: unknown): raw is DuelProjectionAny {
  return isDuelProjectionV1(raw) || isDuelProjectionV2(raw) || isDuelProjectionV3(raw);
}
function equalCost(left: DuelWireRuneCost, right: DuelWireRuneCost | undefined): boolean {
  return right !== undefined && left.energy === right.energy && left.power.length === right.power.length &&
    left.power.every((requirement, i) => requirement.amount === right.power[i]!.amount &&
      requirement.allowedDomains.length === right.power[i]!.allowedDomains.length &&
      requirement.allowedDomains.every((domain, j) => domain === right.power[i]!.allowedDomains[j]));
}
function isDuelAction(raw: unknown, match: DuelWireMatch | DuelWireMatchV2 | DuelWireMatchV3,
  viewer: string | null): raw is DuelWireAction {
  if (!exact(raw, ['id', 'kind', 'label', 'enabled'],
    ['reason', 'selectableUIDs', 'maxSelections', 'uid', 'paymentId', 'resolvedCost']) ||
    !id(raw.id) || !id(raw.label) || typeof raw.enabled !== 'boolean' ||
    (Object.hasOwn(raw, 'reason') && !id(raw.reason)) || viewer === null) return false;
  if (raw.kind === 'mulligan') {
    return exact(raw, ['id', 'kind', 'label', 'enabled', 'selectableUIDs', 'maxSelections'], ['reason']) &&
      match.stage === 'setup' && match.setup.stage === 'mulligan' &&
      match.setup.currentMulliganOwner === viewer && raw.maxSelections === 2 && ids(raw.selectableUIDs) &&
      raw.selectableUIDs.every(uid => match.setup.players.find(p => p.playerId === viewer)?.hand?.some(card => card.uid === uid));
  }
  if (match.stage !== 'playing') return false;
  if (raw.kind === 'rune-energy' || raw.kind === 'rune-power' || raw.kind === 'gold-power') {
    if (!exact(raw, ['id', 'kind', 'label', 'enabled', 'uid'], ['reason']) || !id(raw.uid)) return false;
    const base = match.resources.bases.find(b => b.playerId === viewer);
    const source = raw.kind === 'gold-power' ? base?.goldTokens.find(g => g.uid === raw.uid) :
      base?.baseRunes.find(r => r.uid === raw.uid);
    return source !== undefined && (!raw.enabled ||
      ((match.frame.priorityPlayerId === viewer || match.frame.pendingPayment?.paymentId !== undefined) &&
        (raw.kind === 'rune-power' || source.readied)));
  }
  if (raw.kind === 'pay-pending') {
    const pending = match.frame.pendingPayment;
    return exact(raw, ['id', 'kind', 'label', 'enabled', 'paymentId'], ['reason', 'resolvedCost']) &&
      id(raw.paymentId) && pending !== null && pending.paymentId === raw.paymentId &&
      (!Object.hasOwn(raw, 'resolvedCost') ||
        isDuelRuneCost(raw.resolvedCost) && equalCost(raw.resolvedCost, pending.resolvedCost));
  }
  return false;
}
export function isDuelCommand(raw: unknown): raw is DuelWireCommand {
  if (!exact(raw, ['type'], ['selectedUIDs', 'uid', 'paymentId', 'plan'])) return false;
  if (raw.type === 'mulligan') return exact(raw, ['type', 'selectedUIDs']) &&
    ids(raw.selectedUIDs) && raw.selectedUIDs.length <= 2;
  if (raw.type === 'rune-energy' || raw.type === 'rune-power' || raw.type === 'gold-power')
    return exact(raw, ['type', 'uid']) && id(raw.uid);
  if (raw.type !== 'pay-pending' || !exact(raw, ['type', 'paymentId'], ['plan']) || !id(raw.paymentId)) return false;
  if (!Object.hasOwn(raw, 'plan')) return true;
  if (!exact(raw.plan, ['power']) || !array(raw.plan.power)) return false;
  const power = raw.plan.power;
  return power.every(p => exact(p, ['requirementIndex', 'from', 'amount']) &&
    count(p.requirementIndex) && count(p.amount, 1) &&
    [...DUEL_POWER_DOMAINS, 'any'].some(source => source === p.from)) &&
    unique(power.map(p => `${(p as { requirementIndex: number }).requirementIndex}:${(p as { from: string }).from}`));
}
export function isDuelCommandMessage(raw: unknown): raw is DuelCommandMessage {
  return exact(raw, ['type', 'requestId', 'commandId', 'expectedVersion', 'command']) &&
    raw.type === 'duel-command' && id(raw.requestId) && id(raw.commandId) &&
    count(raw.expectedVersion) && isDuelCommand(raw.command);
}
/** Retained original packet guard: only a V1 projection is accepted. */
export function isDuelProjectionMessage(raw: unknown): raw is DuelProjectionMessage {
  return exact(raw, ['type', 'roomId', 'projection']) && raw.type === 'duel-projection' &&
    id(raw.roomId) && isDuelProjection(raw.projection);
}
export function isDuelProjectionMessageV2(raw: unknown): raw is DuelProjectionMessageV2 {
  return exact(raw, ['type', 'roomId', 'projection']) && raw.type === 'duel-projection' &&
    id(raw.roomId) && isDuelProjectionV2(raw.projection);
}
export function isDuelProjectionMessageV3(raw: unknown): raw is DuelProjectionMessageV3 {
  return exact(raw, ['type', 'roomId', 'projection']) && raw.type === 'duel-projection' &&
    id(raw.roomId) && isDuelProjectionV3(raw.projection);
}
export function isDuelProjectionMessageAny(raw: unknown): raw is DuelProjectionMessageAny {
  return isDuelProjectionMessage(raw) || isDuelProjectionMessageV2(raw) || isDuelProjectionMessageV3(raw);
}
