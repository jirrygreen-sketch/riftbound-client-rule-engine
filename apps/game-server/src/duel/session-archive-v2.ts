/**
 * Private V2 committed archive DATA codec (playing matches only).
 *
 * The candidate and its proofHeads are claims, NOT independent proof. Decoding/exporting
 * NEVER restores a Core/Session/turn WeakMap capability, authenticates a proof journal,
 * selects a canonical branch, or performs durable CAS. A future restore path must bind
 * trusted room/catalog/head identity and separately verify the complete private match,
 * every journal, ledger/source/cost, and cursor/program registry before admitting it.
 * This module is deliberately NOT connected to a production room or the V1 archive.
 */
import { detachedDuelPlaying, DUEL_DOMAINS, type DuelCanonicalPlayingState,
  type DuelCommandReceiptV2, type DuelPaymentBindingEntryV2,
  type DuelRequiredTaskLedgerEntryV2, type DuelTurnCursorV2 } from '@riftbound/engine-core/duel';

// The exported V2 playing/permanent assertions require an INDEPENDENT inventory and
// journal. They cannot be called here with a proof synthesized from this candidate:
// that would turn self-reported history into an apparent attestation. The checks below
// are local structural consistency only; neither they nor the V1 pure base validator
// confer the engine's private WeakMap admission.

export interface DuelV2CommittedArchiveData {
  readonly archiveSchemaVersion: 1;
  readonly kind: 'private-duel-v2-committed';
  readonly identity: { readonly roomId: string; readonly matchId: string;
    readonly rulesetId: 'riftbound-duel'; readonly dataVersion: string;
    readonly catalogDigest: string; readonly rosterPlayerIds: readonly [string, string] };
  readonly branch: { readonly commitSeq: number; readonly parentCommitSeq: number;
    readonly parentNonce: string; readonly commitNonce: string;
    readonly stateVersion: number; readonly eventSeq: number };
  /** A checked JSON record, NOT an admitted DuelCanonicalPlayingStateV2. */
  readonly candidate: { readonly match: Readonly<Record<string, unknown>>;
    readonly receipts: readonly DuelCommandReceiptV2[];
    readonly requiredTasks: readonly DuelRequiredTaskLedgerEntryV2[];
    readonly priorityPayments: readonly DuelPaymentBindingEntryV2[];
    readonly turnCursorV2: DuelTurnCursorV2 | null };
  /** Counters only; monotonicity against a prior committed head requires an independent writer. */
  readonly proofHeads: { readonly creation: number; readonly physical: number;
    readonly token: number; readonly resourceAndReadiness: number;
    readonly sourceAndCost: number; readonly commandLedger: number;
    readonly cursor: number; readonly programRegistry: number };
}

export class DuelV2ArchiveDataError extends TypeError {
  constructor(detail: string) {
    super(`Duel V2 archive data (not authority/restore/CAS): ${detail}`);
    this.name = 'DuelV2ArchiveDataError';
  }
}
function check(ok: unknown, detail: string): asserts ok {
  if (!ok) throw new DuelV2ArchiveDataError(detail);
}
function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label}: record required`);
  check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null,
    `${label}: plain prototype required`);
  const actual = Reflect.ownKeys(raw);
  check(actual.length === keys.length && keys.every(key => actual.includes(key)) &&
    actual.every(key => typeof key === 'string' &&
      Object.getOwnPropertyDescriptor(raw, key)?.enumerable === true &&
      'value' in Object.getOwnPropertyDescriptor(raw, key)!), `${label}: exact data keys required`);
  return raw as Record<string, unknown>;
}
function list(raw: unknown, label: string): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, `${label}: plain array required`);
  check(raw.length <= MAX_NODES, `${label}: array size limit`);
  check(Reflect.ownKeys(raw).length === raw.length + 1, `${label}: dense array without sidecars required`);
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    check(d?.enumerable === true && 'value' in d, `${label}: dense data elements required`);
  }
  return raw;
}
function id(raw: unknown, label: string): string {
  check(typeof raw === 'string' && raw.trim().length > 0, `${label}: nonblank ID required`);
  return raw;
}
function count(raw: unknown, label: string): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0,
    `${label}: nonnegative safe counter required`);
  return raw;
}
function unique(values: readonly string[], label: string): void {
  check(new Set(values).size === values.length, `${label}: duplicate IDs`);
}
function dictionary(raw: unknown, label: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label}: record required`);
  const keys = Reflect.ownKeys(raw);
  for (const key of keys) {
    check(typeof key === 'string', `${label}: symbol key`);
    id(key, `${label}: dictionary key`);
  }
  return record(raw, keys as string[], label);
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function physicalZone(raw: unknown, seats: readonly string[], match: Record<string, unknown>,
  label: string): Record<string, unknown> {
  const r = dictionary(raw, label);
  if (r.kind === 'board-base' || r.kind === 'board-battlefield') {
    record(r, ['kind', 'locationId'], label);
    const location = id(r.locationId, `${label}.locationId`);
    const board = match.board as Record<string, unknown>;
    const locations = list(board[r.kind === 'board-base' ? 'bases' : 'battlefields'], `${label}.board`);
    check(locations.some(item => (item as Record<string, unknown>).locationId === location),
      `${label}: unknown board location`);
  } else {
    record(r, ['kind', 'zonePlayerId'], label);
    check(['legend-zone', 'champion-zone', 'hand', 'main-deck', 'trash', 'rune-deck']
      .includes(r.kind as string), `${label}: unknown zone kind`);
    check(seats.includes(id(r.zonePlayerId, `${label}.zonePlayerId`)),
      `${label}: zone player outside roster`);
  }
  return r;
}
function zoneKey(zone: Record<string, unknown>): string {
  return JSON.stringify([zone.kind, zone.locationId ?? zone.zonePlayerId]);
}
// Legend-zone and board-to-board moves retain the same physical object/epoch.
function crossesNonboard(from: Record<string, unknown>, to: Record<string, unknown>): boolean {
  return [from, to].some(zone => zone.kind !== 'board-base' &&
    zone.kind !== 'board-battlefield' && zone.kind !== 'legend-zone');
}
function validatePhysicalCandidate(match: Record<string, unknown>, seats: readonly string[],
  originals: readonly Record<string, unknown>[], submitted: readonly string[],
  retired: readonly string[], zones: Record<string, unknown>, transitions: readonly unknown[],
  physical: Record<string, unknown>): void {
  const board = match.board as Record<string, unknown>;
  const fields = list(board.battlefields, 'board battlefields') as readonly Record<string, unknown>[];
  const bases = list(board.bases, 'board bases') as readonly Record<string, unknown>[];
  const players = list(match.players, 'match players') as readonly Record<string, unknown>[];
  const resources = match.resources as Record<string, unknown>;
  const resourcePlayers = list(resources.players, 'resource players') as readonly Record<string, unknown>[];
  const resourceBases = list(resources.bases, 'resource bases') as readonly Record<string, unknown>[];
  const unitMeta = match.unitMeta as Record<string, Record<string, unknown>>;
  const frame = match.frame as Record<string, unknown>;
  // A V2 turn successor must keep the turn-order seat and leave no phantom
  // priority/focus in a closed frame. This is local frame grammar, not a turn journal.
  check(frame.turnPlayerId === (match.turnOrder as string[])[((frame.turnNumber as number) - 1) % 2] &&
    (frame.phase !== 'awaiting-turn-start' || frame.priorityPlayerId === null &&
      frame.focusPlayerId === null && frame.stateOpen === true) &&
    (frame.phase !== 'ended' || frame.pendingPayment === null),
  'turn frame identity/phase mismatch');
  const originalsByUID = new Map(originals.map(item => [item.uid as string, item]));
  const selected = new Set(fields.map(f => f.instanceId as string));
  check(selected.size === fields.length && submitted.length === 6 &&
    submitted.every(uid => originalsByUID.get(uid)?.cardType === 'Battlefield') &&
    fields.every(f => submitted.includes(f.instanceId as string)) &&
    submitted.every(uid => selected.has(uid) || retired.includes(uid)) &&
    retired.every(uid => !submitted.includes(uid) || !selected.has(uid)),
  'selected/retired battlefield provenance mismatch');
  // Immutable printing/owner claims must agree with every physical carrier. They are
  // still self-reported until compared to a separately protected creation inventory.
  const current = new Map<string, Record<string, unknown>>();
  const carriers = new Map<string, { kind: string; location: string | null;
    controller: string | null; owner: string | null; cardId: string | null }>();
  const seatZone = (kind: string, playerId: unknown) => ({ kind, zonePlayerId: playerId });
  const boardZone = (locationId: unknown) => ({ kind: bases.some(b => b.locationId === locationId)
    ? 'board-base' : 'board-battlefield', locationId });
  const add = (uid: unknown, zone: Record<string, unknown>, kind: string,
    cardId: unknown = null, controller: unknown = null, owner: unknown = null): void => {
    check(typeof uid === 'string' && !current.has(uid), 'duplicate/missing primary carrier UID');
    current.set(uid, zone);
    carriers.set(uid, { kind, cardId: cardId as string | null,
      controller: controller as string | null, owner: owner as string | null,
      location: 'locationId' in zone ? zone.locationId as string : null });
  };
  for (const p of players) {
    const playerId = p.playerId as string;
    if (p.champion !== null) {
      const champ = p.champion as Record<string, unknown>;
      add(champ.uid, seatZone('champion-zone', playerId), 'champion', champ.cardId);
    }
    const legend = p.legend as Record<string, unknown>;
    add(legend.uid, seatZone('legend-zone', playerId), 'legend', legend.cardId);
    for (const [key, kind] of [['hand', 'hand'], ['remainingMainDeck', 'main-deck'],
      ['trash', 'trash']] as const) for (const card of p[key] as readonly Record<string, unknown>[])
      add(card.uid, seatZone(kind, playerId), 'card', card.cardId);
  }
  for (const f of fields) add(f.instanceId, boardZone(f.locationId), 'battlefield', f.cardId,
    f.controllerPlayerId, f.ownerPlayerId);
  for (const unit of list(board.units, 'board units') as readonly Record<string, unknown>[]) {
    const meta = unitMeta[unit.objectId as string];
    check(meta !== undefined, 'unit without metadata');
    const trait = meta.trait as Record<string, unknown>;
    add(unit.objectId, boardZone(unit.locationId), trait.kind === 'card' ? 'unit' : 'token',
      trait.kind === 'card' ? trait.cardId : null, unit.controllerPlayerId, meta.ownerPlayerId);
  }
  for (const p of resourcePlayers) for (const rune of p.runeDeck as readonly Record<string, unknown>[])
    add(rune.uid, seatZone('rune-deck', p.playerId), 'rune', rune.cardId);
  for (const base of resourceBases) {
    for (const rune of base.baseRunes as readonly Record<string, unknown>[])
      add(rune.uid, boardZone(rune.locationId), 'rune', rune.cardId,
        rune.controllerPlayerId, rune.ownerPlayerId);
    for (const gold of base.goldTokens as readonly Record<string, unknown>[])
      add(gold.uid, boardZone(gold.locationId), 'gold', null,
        gold.controllerPlayerId, gold.ownerPlayerId);
  }
  const legends = dictionary(match.legendStates, 'legendStates');
  const legendUIDs = players.map(p => (p.legend as Record<string, unknown>).uid as string);
  check(Object.keys(legends).length === legendUIDs.length &&
    legendUIDs.every(uid => Object.hasOwn(legends, uid)), 'legendStates UID coverage');
  for (const p of players) {
    const state = record(legends[(p.legend as Record<string, unknown>).uid as string],
      ['controllerPlayerId', 'readiness'], 'legend state');
    check(seats.includes(id(state.controllerPlayerId, 'legend controller')) &&
      ['ready', 'exhausted', 'not-established'].includes(state.readiness as string) &&
      (state.readiness !== 'not-established' ||
        ((match.frame as Record<string, unknown>).phase === 'awaiting-turn-start' &&
          (match.frame as Record<string, unknown>).turnNumber === 1)),
    'legend controller/readiness/phase mismatch');
  }
  const gears = list(match.gears, 'gears').map((value, index) => {
    const gear = record(value, ['uid', 'controllerPlayerId', 'locationId', 'readied',
      'attachedToUID'], `gear ${index}`);
    id(gear.uid, 'gear UID'); id(gear.locationId, 'gear location');
    check(seats.includes(id(gear.controllerPlayerId, 'gear controller')) &&
      typeof gear.readied === 'boolean' &&
      (gear.attachedToUID === null || typeof gear.attachedToUID === 'string' &&
        gear.attachedToUID.trim().length > 0), 'gear controller/readiness/attachment');
    check(originalsByUID.get(gear.uid as string)?.cardType === 'Gear' &&
      (bases.some(b => b.locationId === gear.locationId) ||
        fields.some(f => f.locationId === gear.locationId)), 'gear printing/board location');
    add(gear.uid, boardZone(gear.locationId), 'gear', null, gear.controllerPlayerId);
    return gear;
  });
  const byGear = new Map(gears.map(g => [g.uid as string, g]));
  for (const gear of gears) {
    if (gear.attachedToUID !== null) {
      const host = carriers.get(gear.attachedToUID as string);
      check(host !== undefined && (host.kind === 'gear' ||
        host.kind === 'unit' && host.cardId !== null) &&
        host.location === gear.locationId, 'gear host location/type');
    }
    const base = bases.find(b => b.locationId === gear.locationId);
    const host = gear.attachedToUID === null ? null : carriers.get(gear.attachedToUID as string);
    check(!base || base.ownerPlayerId === gear.controllerPlayerId ||
      host?.controller === base.ownerPlayerId, 'gear at uncontrolled foreign base');
    const visited = new Set([gear.uid]);
    let parent = gear.attachedToUID;
    while (parent !== null && byGear.has(parent as string)) {
      check(!visited.has(parent), 'gear attachment cycle');
      visited.add(parent);
      parent = byGear.get(parent as string)!.attachedToUID;
    }
  }
  const live = new Set(Object.keys(physical));
  check(current.size === live.size + [...carriers.values()]
    .filter(carrier => carrier.kind === 'gold' || carrier.kind === 'token').length &&
    [...live].every(uid => current.has(uid) && !retired.includes(uid)) &&
    [...current].every(([uid]) => live.has(uid) || ['gold', 'token'].includes(carriers.get(uid)!.kind)),
  'live physical UID/current container coverage');
  for (const [uid] of current) {
    if (!live.has(uid)) {
      check(!originalsByUID.has(uid), 'token overlaps physical originals');
      continue;
    }
    const origin = originalsByUID.get(uid);
    const carrier = carriers.get(uid)!;
    check(origin !== undefined && (carrier.cardId === null || carrier.cardId === origin.cardId) &&
      (carrier.owner === null || carrier.owner === origin.ownerPlayerId) &&
      (carrier.kind === 'card' || carrier.kind.toLowerCase() === String(origin.cardType).toLowerCase() ||
        carrier.kind === 'unit' && origin.cardType === 'Champion'),
    'physical printing/owner/carrier mismatch');
  }
  for (const [uid, value] of Object.entries(zones)) {
    const genesis = value as Record<string, unknown>, origin = originalsByUID.get(uid);
    check(origin !== undefined, 'missing genesis physical printing');
    // The genesis claim describes setup zones before later mutations, not a fresh
    // inventory. It still must agree with the printing and immutable owner.
    if (origin.cardType === 'Battlefield') check(genesis.kind === 'board-battlefield' &&
      fields.some(f => f.instanceId === uid && f.locationId === genesis.locationId),
    'battlefield genesis/location mismatch');
    else check(genesis.zonePlayerId === origin.ownerPlayerId &&
      (origin.cardType === 'Legend' ? genesis.kind === 'legend-zone' :
        origin.cardType === 'Champion' ? genesis.kind === 'champion-zone' :
          origin.cardType === 'Rune' ? genesis.kind === 'rune-deck' :
            genesis.kind === 'main-deck' || genesis.kind === 'hand'),
    'physical genesis owner/printing zone');
  }
  // Replay the candidate's own ordered trace, never treat it as an independent journal.
  const positions = new Map(Object.entries(zones) as [string, Record<string, unknown>][]);
  const epochs = new Map([...positions.keys()].map(uid => [uid, 0]));
  for (const [index, item] of transitions.entries()) {
    const step = item as Record<string, unknown>;
    const uid = step.uid as string;
    const from = step.from as Record<string, unknown>, to = step.to as Record<string, unknown>;
    check(zoneKey(positions.get(uid)!) === zoneKey(from), `out-of-order candidate transition ${index}`);
    positions.set(uid, to);
    if (crossesNonboard(from, to)) {
      const next = epochs.get(uid)! + 1;
      check(Number.isSafeInteger(next), 'physical zoneEpoch overflow');
      epochs.set(uid, next);
    }
  }
  for (const [uid, position] of positions) {
    check(zoneKey(position) === zoneKey(current.get(uid)!) &&
      (physical[uid] as Record<string, unknown>).zoneEpoch === epochs.get(uid),
    `physical UID ${uid} position/zoneEpoch differs from candidate history`);
  }
  // Replay compares the candidate against itself. Hand→Trash→Hand with a matching
  // incremented epoch is internally valid even if invented; proving that path needs
  // the independent ordered trace and epoch attestation, not this archive envelope.
}

// No JSON.stringify/structuredClone on uninspected input: both can invoke user getters,
// drop undefined, or turn sparse arrays into null. Sorting every record makes the output
// detached, deterministic JSON data. Bounds keep pathological graphs from exhausting us.
const MAX_DEPTH = 80, MAX_NODES = 100_000, MAX_BYTES = 16 * 1024 * 1024;
function canonicalData(raw: unknown): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(value: unknown, depth: number): unknown {
    check(++nodes <= MAX_NODES && depth <= MAX_DEPTH, 'JSON graph size/depth limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      check(Number.isFinite(value) && Number.isSafeInteger(value), 'JSON numbers must be finite safe integers');
      return value;
    }
    check(typeof value === 'object', 'JSON data cannot contain undefined/functions/symbols/bigints');
    check(!ancestors.has(value), 'cyclic JSON data');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const source = list(value, 'JSON graph array');
        return source.map(item => visit(item, depth + 1));
      }
      check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
        'JSON graph plain prototype required');
      const result: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(value).sort()) {
        check(typeof key === 'string', 'JSON graph symbol key');
        const d = Object.getOwnPropertyDescriptor(value, key);
        check(d?.enumerable === true && 'value' in d, 'JSON graph accessor/nonenumerable key');
        Object.defineProperty(result, key, { enumerable: true, configurable: true,
          writable: true, value: visit(d.value, depth + 1) });
      }
      return result;
    } finally { ancestors.delete(value); }
  }
  const data = visit(raw, 0);
  check(Buffer.byteLength(JSON.stringify(data), 'utf8') <= MAX_BYTES, 'canonical JSON byte limit');
  return data;
}
function paymentSource(raw: unknown, label: string) {
  check(raw !== null && typeof raw === 'object', `${label}: source record`);
  const r = record(raw, Object.hasOwn(raw, 'sourceUID')
    ? ['kind', 'referenceId', 'sourceUID'] : ['kind', 'referenceId'], label);
  check(r.kind === 'card' || r.kind === 'effect', `${label}: source kind`);
  id(r.referenceId, `${label}.referenceId`);
  if (Object.hasOwn(r, 'sourceUID')) id(r.sourceUID, `${label}.sourceUID`);
  return r;
}
function cost(raw: unknown, label: string): void {
  const r = record(raw, ['energy', 'power'], label);
  let total = count(r.energy, `${label}.energy`);
  for (const item of list(r.power, `${label}.power`)) {
    const p = record(item, ['allowedDomains', 'amount'], `${label}.power[]`);
    const domains = list(p.allowedDomains, `${label}.allowedDomains`).map(v => {
      check(typeof v === 'string' && (DUEL_DOMAINS as readonly string[]).includes(v), `${label}: unknown domain`);
      return v;
    });
    check(domains.length > 0 && domains.length <= DUEL_DOMAINS.length, `${label}: domain set`);
    unique(domains, `${label}.allowedDomains`);
    const amount = count(p.amount, `${label}.amount`);
    check(amount > 0, `${label}: positive Power requirement`);
    total += amount;
    check(Number.isSafeInteger(total), `${label}: cost sum overflow`);
  }
}
function plan(raw: unknown, label: string, completed = true): void {
  const r = record(raw, ['power'], label);
  const pairs: string[] = [];
  for (const item of list(r.power, `${label}.power`)) {
    const p = record(item, ['requirementIndex', 'from', 'amount'], `${label}.allocation`);
    const index = count(p.requirementIndex, `${label}.requirementIndex`);
    check(p.from === 'any' || (DUEL_DOMAINS as readonly unknown[]).includes(p.from), `${label}: unknown source`);
    const amount = count(p.amount, `${label}.amount`);
    if (completed) check(amount > 0, `${label}: positive completed allocation`);
    pairs.push(JSON.stringify([index, p.from]));
  }
  // A rejected request can carry a zero/duplicate proposed allocation; do not erase
  // its sticky fingerprint. A *completed* payment must be the actual valid plan.
  if (completed) unique(pairs, `${label}.allocations`);
}
function fingerprint(raw: unknown): Record<string, unknown> {
  const value = id(raw, 'receipt fingerprint');
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new DuelV2ArchiveDataError('receipt fingerprint JSON'); }
  const parsedRecord = dictionary(parsed, 'receipt fingerprint command');
  const command = record(parsedRecord, parsedRecord.type === 'mulligan'
    ? ['type', 'selectedUIDs'] : parsedRecord.type === 'pay-pending'
      ? (Object.hasOwn(parsedRecord, 'plan') ? ['type', 'paymentId', 'plan'] : ['type', 'paymentId'])
      : ['type', 'uid'], 'receipt command');
  if (command.type === 'mulligan') {
    list(command.selectedUIDs, 'mulligan selectedUIDs').forEach(v => id(v, 'mulligan UID'));
  } else if (command.type === 'pay-pending') {
    id(command.paymentId, 'pay-pending payment ID');
    if (Object.hasOwn(command, 'plan')) plan(command.plan, 'pay-pending plan', false);
  } else {
    check(command.type === 'rune-energy' || command.type === 'rune-power' || command.type === 'gold-power',
      'receipt command type');
    id(command.uid, 'resource UID');
  }
  check(JSON.stringify(canonicalData(command)) === value, 'receipt fingerprint must be canonical');
  return command;
}
function receipts(raw: unknown, match: Record<string, unknown>, seats: readonly string[]) {
  const entries = list(raw, 'candidate.receipts');
  const keys: string[] = [], paymentIDs: string[] = [];
  let lastApplied = 0;
  for (const item of entries) {
    const r = record(item, ['actor', 'commandId', 'payloadFingerprint', 'outcome'], 'receipt');
    const actor = id(r.actor, 'receipt actor');
    check(seats.includes(actor), 'receipt actor outside roster');
    keys.push(JSON.stringify([actor, id(r.commandId, 'receipt commandId')]));
    const command = fingerprint(r.payloadFingerprint);
    check(r.outcome !== null && typeof r.outcome === 'object', 'receipt outcome');
    const status = Object.getOwnPropertyDescriptor(r.outcome, 'status')?.value;
    if (status === 'rejected') {
      const o = record(r.outcome, ['status', 'reason'], 'rejected outcome');
      // The executor returns invalid envelopes/actors/commandId conflicts WITHOUT appending
      // receipts. They cannot appear in this persisted ledger even though they are return types.
      check(['stale-version', 'invalid-stage', 'invalid-phase', 'no-permission',
        'mulligan-rejected', 'resource-rejected', 'payment-rejected', 'version-overflow']
        .includes(o.reason as string), 'non-persisted receipt rejection reason');
      check(o.reason !== 'mulligan-rejected' || command.type === 'mulligan',
        'mulligan rejection command mismatch');
      check(o.reason !== 'payment-rejected' || command.type === 'pay-pending',
        'payment rejection command mismatch');
      check(o.reason !== 'resource-rejected' || command.type !== 'mulligan',
        'resource rejection command mismatch');
      continue;
    }
    check(status === 'applied', 'receipt outcome status');
    const o = record(r.outcome, Object.hasOwn(r.outcome, 'paymentCompleted')
      ? ['status', 'appliedVersion', 'eventSeq', 'paymentCompleted']
      : ['status', 'appliedVersion', 'eventSeq'], 'applied outcome');
    const version = count(o.appliedVersion, 'receipt appliedVersion');
    check(version > lastApplied && version <= (match.stateVersion as number) &&
      version === count(o.eventSeq, 'receipt eventSeq'), 'receipt future/out-of-order clock');
    lastApplied = version;
    if (command.type === 'mulligan') {
      const selected = command.selectedUIDs as string[];
      unique(selected, 'applied mulligan selected UIDs');
      check(selected.length <= 2 && version <= 2 &&
        actor === (match.turnOrder as string[])[version - 1], 'mulligan seat/clock');
    } else check(version > 2, 'playing command clock');
    if (Object.hasOwn(o, 'paymentCompleted')) {
      const p = record(o.paymentCompleted, Object.hasOwn(o.paymentCompleted as object, 'requiredTask')
        ? ['paymentId', 'sourceReference', 'plan', 'sourceProofId', 'requiredTask']
        : ['paymentId', 'sourceReference', 'plan', 'sourceProofId'], 'payment completion');
      const paymentId = id(p.paymentId, 'completed payment ID');
      paymentIDs.push(paymentId);
      check(command.type === 'pay-pending' && command.paymentId === paymentId,
        'payment completion command binding');
      paymentSource(p.sourceReference, 'completion source');
      id(p.sourceProofId, 'completion source proof ID');
      plan(p.plan, 'completion plan');
      if (Object.hasOwn(command, 'plan')) {
        check(same(command.plan, p.plan), 'completed explicit plan differs from command');
      }
      if (Object.hasOwn(p, 'requiredTask')) {
        const t = record(p.requiredTask, ['taskId', 'continuationId'], 'completion requiredTask');
        id(t.taskId, 'completed task ID'); id(t.continuationId, 'completed continuation ID');
      }
    } else check(command.type !== 'pay-pending', 'applied payment lacks completion');
  }
  unique(keys, 'receipt actor/command'); unique(paymentIDs, 'completed payments');
  return entries as DuelCommandReceiptV2[];
}
function sourceBinding(raw: unknown, match: Record<string, unknown>, actor: string, paymentId: string,
  source: unknown, liveRequired: boolean, taskId?: string, continuationId?: string) {
  check(raw !== null && typeof raw === 'object', 'source binding');
  const keys = ['matchId', 'actor', 'paymentId', 'sourceReference', 'sourceProofId', 'mode', 'sourceZoneEpoch',
    ...(taskId === undefined ? [] : ['taskId', 'continuationId'])];
  const r = record(raw, keys, 'source binding');
  check(id(r.matchId, 'binding matchId') === match.matchId &&
    id(r.actor, 'binding actor') === actor &&
    id(r.paymentId, 'binding paymentId') === paymentId, 'source binding identity mismatch');
  check(r.mode === 'current' || r.mode === 'pre-exit', 'source binding mode');
  id(r.sourceProofId, 'source proof ID');
  const epoch = count(r.sourceZoneEpoch, 'source zone epoch');
  const checkedSource = paymentSource(r.sourceReference, 'binding source');
  check(Object.hasOwn(checkedSource, 'sourceUID') && same(checkedSource, source), 'bound physical source mismatch');
  if (r.mode === 'current' && liveRequired) {
    // Active cost windows bind the current match. A completed payment preserves its
    // historical binding even if later admitted mutations move or retire its source;
    // verifying that old snapshot needs the separate command/source journal.
    // Pre-exit likewise needs its independent pre-exit event attestation.
    const physical = match.physicalCardsByUID as Record<string, Record<string, unknown>>;
    const uid = checkedSource.sourceUID as string;
    check(Object.hasOwn(physical, uid) && physical[uid]?.zoneEpoch === epoch,
      'current source UID/zoneEpoch is not a live physical reference');
  }
  if (taskId !== undefined) check(id(r.taskId, 'binding task ID') === taskId &&
    id(r.continuationId, 'binding continuation ID') === continuationId,
  'source binding task/continuation mismatch');
  return r;
}
function completionPlanMatchesCost(paymentPlan: { readonly power: readonly {
  readonly requirementIndex: number; readonly from: string; readonly amount: number }[] },
  finalCost: { readonly power: readonly { readonly allowedDomains: readonly string[];
    readonly amount: number }[] }): boolean {
  const paid = finalCost.power.map(() => 0);
  for (const allocation of paymentPlan.power) {
    const requirement = finalCost.power[allocation.requirementIndex];
    if (!requirement || (allocation.from !== 'any' &&
      !requirement.allowedDomains.includes(allocation.from))) return false;
    paid[allocation.requirementIndex] = paid[allocation.requirementIndex]! + allocation.amount;
    if (!Number.isSafeInteger(paid[allocation.requirementIndex])) return false;
  }
  return paid.every((amount, index) => amount === finalCost.power[index]!.amount);
}
function ledger(raw: Record<string, unknown>, match: Record<string, unknown>, seats: readonly string[],
  rs: readonly DuelCommandReceiptV2[]) {
  const requiredTasks = list(raw.requiredTasks, 'candidate.requiredTasks');
  const priorityPayments = list(raw.priorityPayments, 'candidate.priorityPayments');
  const taskIds: string[] = [], continuationIds: string[] = [], paymentIds: string[] = [];
  const active: Record<string, unknown>[] = [];
  const frame = match.frame as Record<string, unknown>;
  const activePhase = ['awaken', 'beginning', 'scoring', 'channel', 'draw', 'main',
    'ending', 'expiration'].includes(frame.phase as string);
  let issued = 0;
  for (const item of requiredTasks) {
    const t = record(item, ['matchId', 'expectedVersion', 'taskId', 'paymentId', 'actor',
      'finalResolvedCost', 'opaqueSource', 'continuationId', 'status', 'sourceBinding'], 'required task');
    check(t.matchId === match.matchId, 'task matchId mismatch');
    const version = count(t.expectedVersion, 'task expectedVersion');
    check(version <= (match.stateVersion as number) && version >= 2, 'task future/setup version');
    const actor = id(t.actor, 'task actor'); check(seats.includes(actor), 'task actor outside roster');
    const taskId = id(t.taskId, 'task ID'), continuationId = id(t.continuationId, 'continuation ID');
    const paymentId = id(t.paymentId, 'task payment ID');
    taskIds.push(taskId); continuationIds.push(continuationId); paymentIds.push(paymentId);
    cost(t.finalResolvedCost, 'task finalResolvedCost');
    const source = paymentSource(t.opaqueSource, 'task source');
    sourceBinding(t.sourceBinding, match, actor, paymentId, source,
      t.status !== 'completed', taskId, continuationId);
    check(t.status === 'issued' || t.status === 'active' || t.status === 'completed', 'task status');
    if (t.status === 'issued') {
      issued++;
      check(activePhase && frame.pendingPayment === null && version === match.stateVersion,
        'issued task outside live phase/version');
    }
    if (t.status === 'active') {
      active.push(t);
      check(activePhase && version < (match.stateVersion as number),
        'active task outside live phase/version');
    }
    if (t.status === 'completed')
      check(version < (match.stateVersion as number), 'completed task before payment commit');
  }
  for (const item of priorityPayments) {
    const p = record(item, ['paymentId', 'actor', 'finalResolvedCost', 'opaqueSource',
      'sourceBinding', 'status'], 'priority payment');
    const paymentId = id(p.paymentId, 'priority payment ID'), actor = id(p.actor, 'priority actor');
    check(seats.includes(actor), 'priority actor outside roster');
    paymentIds.push(paymentId);
    cost(p.finalResolvedCost, 'priority finalResolvedCost');
    const source = paymentSource(p.opaqueSource, 'priority source');
    sourceBinding(p.sourceBinding, match, actor, paymentId, source,
      p.status !== 'completed');
    check(p.status === 'active' || p.status === 'completed', 'priority status');
    if (p.status === 'active') {
      check(activePhase, 'active priority payment outside live phase');
      active.push(p);
    }
  }
  unique(taskIds, 'task'); unique(continuationIds, 'continuation'); unique(paymentIds, 'reserved payment');
  check(issued <= 1 && active.length <= 1, 'multiple issued/active payments');
  const pending = frame.pendingPayment;
  check((pending !== null) === (active.length === 1), 'pending payment/active ledger mismatch');
  if (active.length === 1) check(issued === 0, 'issued task conflicts with active payment');
  if (pending !== null) {
    check(activePhase && (match.stateVersion as number) > 2, 'pending payment outside playing phase');
    const p = record(pending, ['paymentId', 'actor', 'resolvedCost', 'sourceReference'], 'pending payment');
    const a = active[0]!;
    check(p.paymentId === a.paymentId && p.actor === a.actor &&
      same(p.resolvedCost, a.finalResolvedCost) && same(p.sourceReference, a.opaqueSource),
    'pending payment cost/source/identity mismatch');
  }
  const completed = rs.flatMap(r => r.outcome.status === 'applied' && r.outcome.paymentCompleted
    ? [{ actor: r.actor, outcome: r.outcome, payment: r.outcome.paymentCompleted }] : []);
  for (const item of [...requiredTasks, ...priorityPayments]) {
    const entry = item as Record<string, unknown>;
    const matches = completed.filter(c => c.payment.paymentId === entry.paymentId);
    check(entry.status === 'completed' ? matches.length === 1 : matches.length === 0,
      'payment completion/ledger mismatch');
    if (!matches.length) continue;
    const c = matches[0]!;
    const binding = entry.sourceBinding as Record<string, unknown>;
    check(c.actor === entry.actor && c.payment.sourceProofId === binding.sourceProofId &&
      same(c.payment.sourceReference, entry.opaqueSource) &&
      completionPlanMatchesCost(c.payment.plan, entry.finalResolvedCost as DuelRequiredTaskLedgerEntryV2['finalResolvedCost']),
    'completion source/actor/cost-plan binding');
    if (Object.hasOwn(entry, 'taskId')) {
      const t = entry as unknown as DuelRequiredTaskLedgerEntryV2;
      check(c.outcome.appliedVersion > t.expectedVersion &&
        c.payment.requiredTask?.taskId === t.taskId &&
        c.payment.requiredTask?.continuationId === t.continuationId,
      'completion task/continuation binding');
    } else check(!c.payment.requiredTask, 'ordinary completion cannot claim required task');
  }
  for (const c of completed) check(paymentIds.includes(c.payment.paymentId), 'orphan payment completion');
  return { requiredTasks: requiredTasks as DuelRequiredTaskLedgerEntryV2[],
    priorityPayments: priorityPayments as DuelPaymentBindingEntryV2[] };
}
const START_STEPS = ['awaken', 'begin', 'hold', 'hold-effects', 'channel', 'channel-effects',
  'draw', 'burnout-first', 'burnout-intervention', 'draw-effects', 'main-effects', 'main'] as const;
const END_STEPS = ['ending', 'special-designations', 'special-lethal', 'special-expiration',
  'special-remaining', 'special-fepr', 'ordinary-designations', 'ordinary-lethal',
  'ordinary-remaining', 'ordinary-fepr'] as const;
const STEPS: readonly string[] = [...START_STEPS, ...END_STEPS, 'awaiting-turn-start', 'ended'];
function cursorTask(root: string, step: string, hold: number, expiration: number,
  round: number, burnout: number | null): string {
  const suffix = step === 'hold' || step === 'hold-effects' ? String(hold) :
    step.startsWith('special-') || step.startsWith('ordinary-') ? `${expiration}:${round}` :
      step.startsWith('burnout-') ? String(burnout) : '0';
  return `${root}:${step}:${suffix}`;
}
function cursorTaskGrammar(value: string, root: string, holdLimit: number,
  label: string): { step: string; index: number; round: number | null } {
  check(value.startsWith(`${root}:`), `${label}: wrong root`);
  const suffix = value.slice(root.length + 1);
  const parts = suffix.split(':');
  const step = parts[0]!;
  check(STEPS.includes(step) && step !== 'awaiting-turn-start' && step !== 'ended',
    `${label}: unknown task step`);
  const cleanup = step.startsWith('special-') || step.startsWith('ordinary-');
  check(parts.length === (cleanup ? 3 : 2), `${label}: task ID segments`);
  const validNumber = (text: string | undefined) => text !== undefined &&
    /^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text));
  check(validNumber(parts[1]) && (!cleanup || validNumber(parts[2])),
    `${label}: noncanonical task index`);
  const index = Number(parts[1]);
  const round = cleanup ? Number(parts[2]) : null;
  check(cleanup ? index <= 64 && round! <= 64 :
    step === 'hold' || step === 'hold-effects' ? index <= holdLimit &&
      (step === 'hold-effects' ? index < holdLimit : true) :
      step.startsWith('burnout-') ? index > 0 : index === 0,
  `${label}: task index out of range`);
  return { step, index, round };
}
function cursorHistory(c: Record<string, unknown>, consumed: readonly string[],
  battlefields: number, draw: Record<string, unknown> | null): void {
  const root = c.rootTaskID as string, step = c.step as string;
  const hold = c.holdIndex as number, expiration = c.expirationIteration as number;
  const round = c.cleanupRound as number;
  const task = (name: string, index = 0, iteration = expiration, cleanupRound = round) =>
    cursorTask(root, name, index, iteration, cleanupRound,
      name.startsWith('burnout-') ? index : null);
  if (START_STEPS.includes(step as typeof START_STEPS[number])) {
    check(expiration === 0 && round === 0 && c.cleanupChanged === false &&
      c.feprProcessed === false &&
      (['hold', 'hold-effects'].includes(step) ? hold <= battlefields :
        ['awaken', 'begin'].includes(step) ? hold === 0 : hold === battlefields),
    'start cursor cannot contain ending counters');
    const prefix: string[] = [];
    if (step !== 'awaken') prefix.push(task('awaken'));
    if (!['awaken', 'begin'].includes(step)) prefix.push(task('begin'));
    if (!['awaken', 'begin', 'hold', 'hold-effects'].includes(step)) {
      for (let n = 0; n < battlefields; n++)
        prefix.push(task('hold', n), task('hold-effects', n));
      prefix.push(task('hold', battlefields));
    } else for (let n = 0; n < hold; n++)
      prefix.push(task('hold', n), task('hold-effects', n));
    if (step === 'hold-effects') prefix.push(task('hold', hold));
    if (['channel-effects', 'draw', 'burnout-first', 'burnout-intervention',
      'draw-effects', 'main-effects', 'main'].includes(step)) prefix.push(task('channel'));
    if (['draw', 'burnout-first', 'burnout-intervention', 'draw-effects',
      'main-effects', 'main'].includes(step)) prefix.push(task('channel-effects'));
    if (['burnout-first', 'burnout-intervention', 'draw-effects', 'main-effects', 'main']
      .includes(step)) prefix.push(task('draw'));
    if (step === 'burnout-intervention' || step === 'burnout-first') {
      // Only point one is preventable. Subsequent burnout points reuse the
      // intervention boundary with increasing indices, never a new first task.
      const burnout = draw!.burnoutIndex as number;
      check(step !== 'burnout-first' || burnout === 1, 'fictional first burnout point');
      if (step === 'burnout-intervention') {
        prefix.push(task('burnout-first', 1));
        for (let index = 1; index < burnout; index++)
          prefix.push(task('burnout-intervention', index));
      }
    }
    if (['main-effects', 'main'].includes(step)) prefix.push(task('draw-effects'));
    if (step === 'main') prefix.push(task('main-effects'));
    if (draw === null && ['draw-effects', 'main-effects', 'main'].includes(step)) {
      const start = prefix.indexOf(task('draw'));
      check(start >= 0, 'draw continuation history');
      const beforeDraw = prefix.slice(0, start + 1);
      const afterDraw = prefix.slice(start + 1);
      const burnout = consumed.slice(beforeDraw.length, consumed.length - afterDraw.length);
      check(consumed.length >= beforeDraw.length + afterDraw.length &&
        same(consumed.slice(0, beforeDraw.length), beforeDraw) &&
        same(consumed.slice(consumed.length - afterDraw.length), afterDraw) &&
        (burnout.length === 0 || burnout[0] === task('burnout-first', 1) &&
          burnout.slice(1).every((value, index) =>
            value === task('burnout-intervention', index + 1))),
      'start cursor consumed order');
    } else check(same(consumed, prefix), 'start cursor consumed order');
  } else if (step === 'awaiting-turn-start') {
    check(hold === 0 && expiration === 0 && round === 0 &&
      c.cleanupChanged === false && c.feprProcessed === false && draw === null &&
      consumed.length === 0 && c.pendingTaskID === null,
    'turn handoff cursor must be fresh');
  } else if (END_STEPS.includes(step as typeof END_STEPS[number])) {
    // End drive carries the completed Main hold index; it resets only the Ending
    // counters/consumed IDs, not the prior Start hold index.
    check(hold === battlefields && draw === null, 'ending cursor cannot contain start continuation');
    if (step === 'ending') check(consumed.length === 0 && expiration === 0 &&
      round === 0 && c.cleanupChanged === false && c.feprProcessed === false,
    'ending cursor must start with empty history');
    else {
      // The real executor may clear consumedIDs on each turn and repeat cleanup
      // passes. IDs must belong to the ordered Ending program, never a fiction or
      // an unrelated start step. Complete ordering across passes still needs a
      // separate trusted cursor journal and stable program registry.
      const steps = END_STEPS as readonly string[];
      const seen = new Set<string>();
      let previousIteration = -1, previousRound = -1, previousStep = -1;
      for (const value of consumed) {
        const parsed = cursorTaskGrammar(value, root, battlefields, 'ending consumed task');
        const position = steps.indexOf(parsed.step);
        // "ending:0" is the single bridge task, not a cleanup-scoped ID.
        if (parsed.step === 'ending') {
          check(seen.size === 0 && parsed.round === null && parsed.index === 0,
            'ending bridge task order');
          seen.add(value);
          continue;
        }
        check(position >= 0 && parsed.round !== null &&
          (parsed.index < expiration || parsed.index === expiration && parsed.round <= round) &&
          (parsed.index > previousIteration || parsed.index === previousIteration &&
            (parsed.round! > previousRound || parsed.round === previousRound &&
              position > previousStep)) && !seen.has(value),
        'ending cursor out-of-order/future task');
        seen.add(value);
        previousIteration = parsed.index;
        previousRound = parsed.round;
        previousStep = position;
      }
      check(consumed.length > 0 || step === 'special-designations',
        'ending cursor lacks previous task');
    }
  } else if (step === 'ended') {
    check(draw === null && c.pendingTaskID === null, 'ended cursor pending task');
  }
}
function cursor(raw: unknown, match: Record<string, unknown>, seats: readonly string[]): DuelTurnCursorV2 | null {
  if (raw === null) return null;
  const c = record(raw, ['kind', 'matchId', 'turn', 'rootTaskID', 'step', 'holdIndex',
    'pendingTaskID', 'consumedIDs', 'handlerSettledIDs', 'firstChannelProcessedPlayerIDs',
    'drawCursor', 'expirationIteration', 'cleanupRound', 'cleanupChanged', 'feprProcessed',
    'stateVersion', 'eventSeq'], 'turnCursorV2');
  const frame = match.frame as Record<string, unknown>;
  check(c.kind === 'v2-turn' && c.matchId === match.matchId &&
    count(c.turn, 'cursor turn') === frame.turnNumber &&
    c.rootTaskID === `duel-v2:${match.matchId}:turn-${c.turn}` &&
    count(c.stateVersion, 'cursor stateVersion') === match.stateVersion &&
    count(c.eventSeq, 'cursor eventSeq') === match.eventSeq, 'cursor clock/identity mismatch');
  check(STEPS.includes(c.step as string), 'cursor step');
  // A no-cursor state is possible at constructor handoff; once a cursor exists,
  // turn one must have crossed a real program/clock boundary.
  check(c.step !== 'awaken' || frame.phase !== 'awaiting-turn-start' ||
    (c.turn as number) > 1 || (match.stateVersion as number) === 2,
  'unbound first-turn awaken clock');
  const hold = count(c.holdIndex, 'cursor holdIndex');
  const battlefields = list((match.board as Record<string, unknown>).battlefields, 'match.board.battlefields');
  check(hold <= battlefields.length && count(c.expirationIteration, 'cursor expirationIteration') <= 64 &&
    count(c.cleanupRound, 'cursor cleanupRound') <= 64, 'cursor counters out of range');
  check(typeof c.cleanupChanged === 'boolean' && typeof c.feprProcessed === 'boolean', 'cursor flags');
  const strings = (key: string) => list(c[key], `cursor ${key}`).map(v => id(v, `cursor ${key} ID`));
  const consumed = strings('consumedIDs'), settled = strings('handlerSettledIDs');
  const first = strings('firstChannelProcessedPlayerIDs');
  unique(consumed, 'cursor consumed'); unique(settled, 'cursor handler settled'); unique(first, 'cursor first channel');
  consumed.forEach(value => cursorTaskGrammar(value, c.rootTaskID as string,
    battlefields.length, 'consumed task'));
  check(first.every(v => v === (match.turnOrder as string[])[1] && seats.includes(v)) &&
    (first.length === 0 || (c.turn as number) >= 2) &&
    ((c.turn as number) <= 2 || first.length === 1), 'cursor task/player IDs');
  if (c.drawCursor !== null) {
    const d = record(c.drawCursor, ['actor', 'remainingCount', 'burnoutIndex', 'step'], 'draw cursor');
    check(d.actor === frame.turnPlayerId && seats.includes(id(d.actor, 'draw actor')) &&
      count(d.remainingCount, 'draw remainingCount') > 0 &&
      count(d.burnoutIndex, 'draw burnoutIndex') > 0 &&
      (d.step === 'awaiting-first-resolution' || d.step === 'awaiting-intervention') &&
      (d.step !== 'awaiting-first-resolution' || d.burnoutIndex === 1) &&
      (c.step !== 'burnout-first' || d.step === 'awaiting-first-resolution') &&
      (c.step !== 'burnout-intervention' || d.step === 'awaiting-intervention'),
    'draw cursor values');
  }
  check((c.step === 'burnout-first' || c.step === 'burnout-intervention') === (c.drawCursor !== null),
    'draw continuation mismatch');
  const prefix = `${c.rootTaskID}:`;
  check(!(c.step === 'draw' && consumed.includes(`${prefix}draw:0`)) &&
    !(c.step === 'channel' && consumed.includes(`${prefix}channel:0`)) &&
    (c.step !== 'hold-effects' || consumed.includes(`${prefix}hold:${hold}`)) &&
    (c.step !== 'channel-effects' || consumed.includes(`${prefix}channel:0`)) &&
    (c.step !== 'draw-effects' || consumed.includes(`${prefix}draw:0`)) &&
    (!(c.step as string).startsWith('burnout-') || consumed.includes(`${prefix}draw:0`)) &&
    (c.step !== 'main-effects' || consumed.includes(`${prefix}draw-effects:0`)) &&
    (c.step !== 'main' || consumed.includes(`${prefix}main-effects:0`)),
  'cursor step history mismatch');
  const task = cursorTask(c.rootTaskID as string, c.step as string, hold,
    c.expirationIteration as number, c.cleanupRound as number,
    c.drawCursor === null ? null : (c.drawCursor as Record<string, unknown>).burnoutIndex as number);
  check(c.pendingTaskID === null || c.pendingTaskID === task, 'cursor pending task mismatch');
  check(settled.every(v => v.startsWith(`${task}:handler:`)),
    'settled handler must belong to current task');
  check(!consumed.includes(task), 'cursor current task already consumed');
  const currentHandlerPrefix = `${task}:handler:`;
  for (const value of settled) {
    check(value.startsWith(currentHandlerPrefix) && !consumed.includes(value),
      'settled handler must belong to current unconsumed task');
    let identity: unknown;
    try { identity = JSON.parse(value.slice(currentHandlerPrefix.length)); }
    catch { throw new DuelV2ArchiveDataError('settled handler identity JSON'); }
    const parts = list(identity, 'settled handler identity');
    check(parts.length === 7 && count(parts[0], 'registry ID') > 0 &&
      typeof parts[1] === 'string' && parts[1].length > 0 &&
      (parts[2] === null || count(parts[2], 'handler source epoch') >= 0) &&
      ['card', 'champion', 'legend', 'battlefield', 'unit', 'gear', 'rune', 'gold']
        .includes(parts[3] as string) &&
      (parts[4] === null || typeof parts[4] === 'string') &&
      (parts[5] === null || seats.includes(parts[5] as string)),
    'settled handler identity grammar');
    const claimedZone = dictionary(parts[6], 'settled handler zone');
    if (claimedZone.kind === 'board-base' || claimedZone.kind === 'board-battlefield') {
      record(claimedZone, ['kind', 'locationId'], 'settled handler zone');
      id(claimedZone.locationId, 'settled handler location');
    } else {
      record(claimedZone, ['kind', 'zonePlayerId'], 'settled handler zone');
      check(['legend-zone', 'champion-zone', 'hand', 'main-deck', 'trash', 'rune-deck']
        .includes(claimedZone.kind as string) &&
        seats.includes(id(claimedZone.zonePlayerId, 'settled handler player')),
      'settled handler zone grammar');
    }
    // Handler source may have moved while the fixed-point resolver runs. The ID
    // grammar is checkable here; live source/registry equivalence needs the
    // independent cursor/program journal and must not be guessed from this match.
    check(JSON.stringify(parts) === value.slice(currentHandlerPrefix.length),
      'noncanonical settled handler identity');
  }
  cursorHistory(c, consumed, battlefields.length, c.drawCursor as Record<string, unknown> | null);
  const phase = frame.phase;
  check((c.step === 'main' || c.step === 'main-effects' ? phase === 'main' :
    c.step === 'awaiting-turn-start' ? phase === 'awaiting-turn-start' :
    c.step === 'ended' ? phase === 'ended' :
    c.step === 'awaken' ? phase === 'awaiting-turn-start' :
    c.step === 'begin' ? phase === 'awaken' :
    c.step === 'hold' || c.step === 'hold-effects' ? phase === 'beginning' || phase === 'scoring' :
    c.step === 'channel' ? phase === 'scoring' :
    c.step === 'channel-effects' ? phase === 'channel' :
    c.step === 'draw' ? phase === 'channel' :
    c.step === 'draw-effects' || (c.step as string).startsWith('burnout-') ? phase === 'draw' :
    c.step === 'ending' ? phase === 'main' :
    c.step === 'special-designations' && consumed.length === 1 ? phase === 'ending' :
    phase === 'expiration'), 'cursor phase mismatch');
  const pending = frame.pendingPayment;
  if (pending !== null) check(c.step === 'main' && phase === 'main' &&
    c.pendingTaskID === null && settled.length === 0,
  'payment cannot coexist with phase task or handlers');
  // Main can carry a trusted focus/priority handoff; the cursor only proves that
  // its own task is not simultaneously pending with a payment. Do not infer a
  // permanent turn-player Priority invariant from the initial Main frame.
  return c as unknown as DuelTurnCursorV2;
}
function matchData(raw: unknown, identity: DuelV2CommittedArchiveData['identity'],
  branch: DuelV2CommittedArchiveData['branch']): Record<string, unknown> {
  const m = record(raw, ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion',
    'catalogDigest', 'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'players', 'board',
    'resources', 'scoring', 'unitMeta', 'retiredUnitTokenUIDs', 'frame',
    'physicalCardsByUID', 'legendStates', 'gears', 'retiredPhysicalUIDs', 'provenance'],
  'V2 playing candidate');
  check(m.stage === 'playing' && m.schemaVersion === 2 && m.rulesetId === identity.rulesetId &&
    m.matchId === identity.matchId && m.dataVersion === identity.dataVersion &&
    m.catalogDigest === identity.catalogDigest, 'V2 match schema/identity mismatch');
  check(count(m.stateVersion, 'match stateVersion') === branch.stateVersion &&
    count(m.eventSeq, 'match eventSeq') === branch.eventSeq &&
    branch.stateVersion >= 2, 'match/branch clocks mismatch');
  const roster = list(m.roster, 'match roster');
  check(roster.length === 2, 'match roster length');
  const players = roster.map(value => {
    const r = record(value, ['playerId', 'displayName'], 'match roster seat');
    id(r.displayName, 'match displayName');
    return id(r.playerId, 'match playerId');
  });
  check(same(players, identity.rosterPlayerIds), 'ordered match roster mismatch');
  const turnOrder = list(m.turnOrder, 'match turnOrder').map(v => id(v, 'turnOrder player'));
  unique(turnOrder, 'turnOrder');
  check(turnOrder.length === 2 && turnOrder.every(v => players.includes(v)), 'turn order permutation');
  const frame = record(m.frame, ['phase', 'turnNumber', 'turnPlayerId',
    'priorityPlayerId', 'focusPlayerId', 'stateOpen', 'pendingPayment'], 'match frame');
  check(['awaiting-turn-start', 'awaken', 'beginning', 'scoring', 'channel', 'draw',
    'main', 'ending', 'expiration', 'ended'].includes(frame.phase as string), 'match phase');
  check(count(frame.turnNumber, 'match turnNumber') > 0 &&
    players.includes(id(frame.turnPlayerId, 'turn player')), 'match turn identity');
  for (const key of ['priorityPlayerId', 'focusPlayerId']) if (frame[key] !== null)
    check(players.includes(id(frame[key], key)), `${key} outside roster`);
  check(typeof frame.stateOpen === 'boolean', 'match stateOpen');
  if (frame.pendingPayment !== null) {
    const p = record(frame.pendingPayment, ['paymentId', 'actor', 'resolvedCost',
      'sourceReference'], 'pending payment');
    id(p.paymentId, 'pending payment ID');
    check(players.includes(id(p.actor, 'pending actor')), 'pending actor outside roster');
    cost(p.resolvedCost, 'pending resolvedCost');
    paymentSource(p.sourceReference, 'pending source');
  }
  const provenance = record(m.provenance, ['originalPhysicalCards', 'submittedBattlefieldUIDs',
    'initialZonesByUID', 'transitions'], 'candidate provenance (untrusted)');
  const originals = list(provenance.originalPhysicalCards, 'candidate originals').map(item => {
    const r = record(item, ['uid', 'cardId', 'ownerPlayerId', 'origin', 'cardType'], 'candidate original');
    id(r.cardId, 'original cardId');
    check(players.includes(id(r.ownerPlayerId, 'original owner')) &&
      (r.origin === 'submitted-deck' || r.origin === 'created') &&
      ['Unit', 'Champion', 'Gear', 'Rune', 'Legend', 'Battlefield', 'Other'].includes(r.cardType as string),
    'original card identity');
    return id(r.uid, 'original UID');
  });
  unique(originals, 'original physical UID');
  const submitted = list(provenance.submittedBattlefieldUIDs, 'submitted battlefield UIDs')
    .map(v => id(v, 'submitted battlefield UID'));
  unique(submitted, 'submitted battlefield UID');
  check(submitted.length === 6 && submitted.every(v => originals.includes(v)), 'submitted battlefield identities');
  const transitions = list(provenance.transitions, 'candidate transitions');
  const retired = list(m.retiredPhysicalUIDs, 'retired physical UIDs').map(v => id(v, 'retired UID'));
  unique(retired, 'retired physical UID');
  // Reuse only the V1 *pure validation kernel* after explicitly stripping V2-only
  // fields into an ephemeral V1-shaped value. Never downgrade the returned candidate
  // or call a V1 restoration/admission path; a V1 input cannot pass m.schemaVersion=2.
  const { provenance: _claimedProof, physicalCardsByUID: _physical,
    legendStates: _legends, gears: _gears, retiredPhysicalUIDs: _retired, ...base } = m;
  detachedDuelPlaying({ ...base, schemaVersion: 1 } as unknown as DuelCanonicalPlayingState);
  const zones = dictionary(provenance.initialZonesByUID, 'initial zones');
  check(retired.every(uid => originals.includes(uid)), 'retired UID outside originals');
  check(Object.keys(zones).length === originals.length - retired.length &&
    Object.keys(zones).every(key => originals.includes(key) && !retired.includes(key)) &&
    originals.every(key => retired.includes(key) || Object.hasOwn(zones, key)),
  'initial zone UID set mismatch');
  for (const [uid, zone] of Object.entries(zones))
    physicalZone(zone, players, m, `initial zone ${uid}`);
  for (const item of transitions) {
    const step = record(item, ['uid', 'from', 'to'], 'candidate transition');
    check(Object.hasOwn(zones, id(step.uid, 'transition UID')), 'transition UID missing from genesis');
    physicalZone(step.from, players, m, 'transition from');
    physicalZone(step.to, players, m, 'transition to');
    check(zoneKey(step.from as Record<string, unknown>) !== zoneKey(step.to as Record<string, unknown>),
      'transition must change zones');
  }
  const retiredTokens = list(m.retiredUnitTokenUIDs, 'retired unit token UIDs')
    .map(v => id(v, 'retired token UID'));
  unique(retiredTokens, 'retired unit token UID');
  unique([...retired, ...retiredTokens], 'retired UID');
  const physical = dictionary(m.physicalCardsByUID, 'physicalCardsByUID');
  check(Object.keys(physical).length === originals.length - retired.length &&
    Object.keys(physical).every(uid => originals.includes(uid) && !retired.includes(uid)) &&
    originals.every(uid => retired.includes(uid) || Object.hasOwn(physical, uid)),
  'physical origin UID coverage');
  for (const [uid, value] of Object.entries(physical)) {
    const origin = record(value, ['cardId', 'ownerPlayerId', 'origin', 'zoneEpoch'], `physical ${uid}`);
    const original = (provenance.originalPhysicalCards as readonly Record<string, unknown>[])
      .find(item => item.uid === uid)!;
    check(origin.cardId === original.cardId && origin.ownerPlayerId === original.ownerPlayerId &&
      origin.origin === original.origin, 'physical origin identity');
    count(origin.zoneEpoch, `physical ${uid} zoneEpoch`);
  }
  validatePhysicalCandidate(m, players, provenance.originalPhysicalCards as readonly Record<string, unknown>[],
    submitted, retired, zones, transitions, physical);
  return m;
}
function decode(raw: unknown): DuelV2CommittedArchiveData {
  // Before touching any nested value, remove accessors, non-JSON values, sparse arrays,
  // extra properties and cycles; the result has canonical, detached own data properties.
  const data = canonicalData(raw);
  const a = record(data, ['archiveSchemaVersion', 'kind', 'identity', 'branch', 'candidate',
    'proofHeads'], 'V2 envelope');
  check(a.archiveSchemaVersion === 1 && a.kind === 'private-duel-v2-committed',
    'archive schema/kind mismatch (no V1 or downgrade)');
  const i = record(a.identity, ['roomId', 'matchId', 'rulesetId', 'dataVersion',
    'catalogDigest', 'rosterPlayerIds'], 'identity');
  check(i.rulesetId === 'riftbound-duel', 'rulesetId');
  for (const key of ['roomId', 'matchId', 'dataVersion', 'catalogDigest']) id(i[key], `identity ${key}`);
  const seats = list(i.rosterPlayerIds, 'ordered roster').map(v => id(v, 'roster player ID'));
  check(seats.length === 2, 'ordered roster must have two seats');
  unique(seats, 'ordered roster');
  const b = record(a.branch, ['commitSeq', 'parentCommitSeq', 'parentNonce', 'commitNonce',
    'stateVersion', 'eventSeq'], 'branch');
  const seq = count(b.commitSeq, 'commitSeq'), parent = count(b.parentCommitSeq, 'parentCommitSeq');
  check(seq > 0 && parent === seq - 1, 'branch parent/child sequence');
  check(id(b.parentNonce, 'parentNonce') !== id(b.commitNonce, 'commitNonce'),
    'parent/child nonce reuse');
  check(count(b.stateVersion, 'branch stateVersion') === count(b.eventSeq, 'branch eventSeq'),
    'branch state/event clock drift');
  const h = record(a.proofHeads, ['creation', 'physical', 'token', 'resourceAndReadiness',
    'sourceAndCost', 'commandLedger', 'cursor', 'programRegistry'], 'proofHeads');
  for (const [key, value] of Object.entries(h)) count(value, `proofHeads ${key}`);
  const candidate = record(a.candidate, ['match', 'receipts', 'requiredTasks', 'priorityPayments',
    'turnCursorV2'], 'candidate');
  const match = matchData(candidate.match, i as unknown as DuelV2CommittedArchiveData['identity'],
    b as unknown as DuelV2CommittedArchiveData['branch']);
  const rs = receipts(candidate.receipts, match, seats);
  const ledgers = ledger(candidate, match, seats, rs);
  const turn = cursor(candidate.turnCursorV2, match, seats);
  if (turn !== null && (ledgers.requiredTasks.some(task => task.status !== 'completed') ||
    ledgers.priorityPayments.some(payment => payment.status === 'active'))) {
    check(turn.step === 'main' && (match.frame as Record<string, unknown>).phase === 'main' &&
      turn.pendingTaskID === null && turn.handlerSettledIDs.length === 0,
    'outstanding cost cannot coexist with pending turn/handler continuation');
  }
  return data as DuelV2CommittedArchiveData;
}
/** Detached canonical JSON data only. NOT an admitted session, proof, restore, or CAS. */
export function exportDuelV2CommittedArchiveData(input: unknown): DuelV2CommittedArchiveData {
  try { return decode(input); }
  catch (error) {
    if (error instanceof DuelV2ArchiveDataError) throw error;
    throw new DuelV2ArchiveDataError(error instanceof Error ? error.message : 'invalid input');
  }
}
/** Validate parsed private archive DATA only; raw JSON never acquires V2 authority. */
export function decodeDuelV2CommittedArchiveData(raw: unknown): DuelV2CommittedArchiveData {
  return exportDuelV2CommittedArchiveData(raw);
}
