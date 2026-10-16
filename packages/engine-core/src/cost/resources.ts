// Internal duel resources, CR v1.4. No player command should expose these primitives directly.
export const DUEL_DOMAINS = Object.freeze(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const);
export type DuelDomain = (typeof DUEL_DOMAINS)[number];
export type DuelPowerSource = DuelDomain | 'any';
const POWER_SOURCES = Object.freeze([...DUEL_DOMAINS, 'any'] as const);

export interface DuelRunePool {
  readonly energy: number;
  readonly power: Readonly<Record<DuelPowerSource, number>>;
}
export interface DuelDeckRune {
  readonly uid: string;
  readonly cardId: string;
  readonly domain: DuelDomain;
}
export interface DuelBaseRune extends DuelDeckRune {
  readonly readied: boolean;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
}
export interface DuelGoldToken {
  readonly uid: string;
  readonly readied: boolean;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
}
export interface DuelResourcePlayer {
  readonly playerId: string;
  /** Private ordered top-first deck. Never send this field to the opponent. */
  readonly runeDeck: readonly DuelDeckRune[];
  readonly runePool: DuelRunePool;
}
export interface DuelResourceBase {
  readonly playerId: string;
  readonly locationId: string;
  readonly baseRunes: readonly DuelBaseRune[];
  readonly goldTokens: readonly DuelGoldToken[];
}
export interface DuelResources {
  readonly playerIds: readonly [string, string];
  readonly players: readonly [DuelResourcePlayer, DuelResourcePlayer];
  readonly bases: readonly [DuelResourceBase, DuelResourceBase];
  /** Permanently retired token identities, preventing reuse after Kill. Never projected. */
  readonly retiredGoldUids: readonly string[];
}
export interface DuelBaseLocation {
  readonly playerId: string;
  readonly locationId: string;
}
export interface DuelResourceTiming {
  /** Derived from canonical Open/Priority and the active Pay Costs transaction, never the client. */
  readonly stateOpen: boolean;
  readonly priorityPlayerId: string | null;
  readonly resourcePaymentPlayerId: string | null;
}
export interface DuelPowerRequirement {
  /** One or more of the six domains. [A] / domainless [C] = all six. */
  readonly allowedDomains: readonly DuelDomain[];
  readonly amount: number;
}
export interface DuelRuneCost {
  readonly energy: number;
  readonly power: readonly DuelPowerRequirement[];
}
export interface DuelPowerAllocation {
  readonly requirementIndex: number;
  readonly from: DuelPowerSource;
  readonly amount: number;
}
export interface DuelPaymentPlan {
  readonly power: readonly DuelPowerAllocation[];
}
export interface DuelPaymentResult {
  readonly resources: DuelResources;
  readonly plan: DuelPaymentPlan;
}
export interface PublicDuelResources {
  readonly players: readonly { readonly playerId: string; readonly runePool: DuelRunePool; readonly runeDeckCount: number }[];
  readonly bases: readonly DuelResourceBase[];
}

function fail(message: string): never { throw new TypeError(`Duel resources: ${message}`); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) fail(`${label} has missing or unknown keys`);
  for (const key of actual) {
    if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) fail(`${label} must not have accessors`);
  }
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(k => k !== 'length' &&
      (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= value.length))) fail(`${label} must be dense without extra keys`);
  for (let i = 0; i < value.length; i++) {
    if (!('value' in Object.getOwnPropertyDescriptor(value, String(i))!)) fail(`${label} must not have accessors`);
  }
  return value;
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a nonempty string`);
  return value;
}
function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative safe integer`);
  return value;
}
function checkedAdd(a: number, b: number, label: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail(`${label} overflows safe integers`);
  return sum;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
  return value;
}
function domain(value: unknown): DuelDomain {
  if (!DUEL_DOMAINS.some(d => d === value)) fail('invalid domain');
  return value as DuelDomain;
}
function powerSource(value: unknown): DuelPowerSource {
  if (!POWER_SOURCES.some(d => d === value)) fail('invalid Power source');
  return value as DuelPowerSource;
}
function idPair(raw: unknown): [string, string] {
  const a = array(raw, 'playerIds');
  if (a.length !== 2) fail('exactly two player IDs required');
  const first = id(a[0], 'first player ID'), second = id(a[1], 'second player ID');
  if (first === second) fail('player IDs must be distinct');
  return [first, second];
}
function locations(raw: unknown, ids: readonly [string, string]): readonly [DuelBaseLocation, DuelBaseLocation] {
  const values = array(raw, 'baseLocations');
  if (values.length !== 2) fail('exactly two bases required');
  const bases = values.map((value, index) => {
    const item = record(value, ['playerId', 'locationId'], 'base location');
    if (item.playerId !== ids[index]) fail('base location order/player mismatch');
    return { playerId: ids[index], locationId: id(item.locationId, 'base location ID') };
  }) as [DuelBaseLocation, DuelBaseLocation];
  if (bases[0].locationId === bases[1].locationId) fail('base locations must be distinct');
  return bases;
}
function emptyPool(): DuelRunePool {
  return { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };
}
function pool(raw: unknown): DuelRunePool {
  const p = record(raw, ['energy', 'power'], 'Rune Pool');
  const energy = count(p.energy, 'energy');
  const power = record(p.power, POWER_SOURCES, 'Power Pool');
  const out = {} as Record<DuelPowerSource, number>;
  let total = energy;
  for (const d of POWER_SOURCES) {
    out[d] = count(power[d], `${d} Power`);
    total = checkedAdd(total, out[d], 'Rune Pool total');
  }
  return { energy, power: out };
}
function deckRune(raw: unknown): DuelDeckRune {
  const rune = record(raw, ['uid', 'cardId', 'domain'], 'deck rune');
  return { uid: id(rune.uid, 'rune UID'), cardId: id(rune.cardId, 'rune card ID'), domain: domain(rune.domain) };
}
function baseRune(raw: unknown, owner: string, locationId: string): DuelBaseRune {
  const rune = record(raw, ['uid', 'cardId', 'domain', 'readied', 'ownerPlayerId', 'controllerPlayerId', 'locationId'], 'base rune');
  if (rune.ownerPlayerId !== owner || rune.controllerPlayerId !== owner || rune.locationId !== locationId) fail('base rune owner/controller/location mismatch');
  return { uid: id(rune.uid, 'rune UID'), cardId: id(rune.cardId, 'rune card ID'), domain: domain(rune.domain),
    readied: boolean(rune.readied, 'rune readiness'), ownerPlayerId: owner, controllerPlayerId: owner, locationId };
}
function goldToken(raw: unknown, playerIds: readonly [string, string]): DuelGoldToken {
  const token = record(raw, ['uid', 'readied', 'ownerPlayerId', 'controllerPlayerId', 'locationId'], 'Gold token');
  const ownerPlayerId = id(token.ownerPlayerId, 'Gold owner');
  const controllerPlayerId = id(token.controllerPlayerId, 'Gold controller');
  const locationId = id(token.locationId, 'Gold location');
  if (!playerIds.includes(ownerPlayerId) || !playerIds.includes(controllerPlayerId)) fail('Gold owner/controller mismatch');
  return { uid: id(token.uid, 'Gold UID'), readied: boolean(token.readied, 'Gold readiness'),
    ownerPlayerId, controllerPlayerId, locationId };
}
function readState(raw: unknown, expectedLocations?: unknown): DuelResources {
  const state = record(raw, ['playerIds', 'players', 'bases', 'retiredGoldUids'], 'state');
  const ids = idPair(state.playerIds);
  const ps = array(state.players, 'players'), bs = array(state.bases, 'bases');
  if (ps.length !== 2 || bs.length !== 2) fail('exactly two ordered players and bases required');
  const expected = expectedLocations === undefined ? undefined : locations(expectedLocations, ids);
  const used = new Set<string>();
  function reserve(value: string): void {
    if (used.has(value)) fail(`duplicate resource UID: ${value}`);
    used.add(value);
  }
  const players = ps.map((rawPlayer, index) => {
    const p = record(rawPlayer, ['playerId', 'runeDeck', 'runePool'], 'player');
    if (p.playerId !== ids[index]) fail('player order/ID mismatch');
    const runeDeck = array(p.runeDeck, 'Rune Deck').map(r => {
      const card = deckRune(r); reserve(card.uid); return card;
    });
    return { playerId: ids[index], runeDeck, runePool: pool(p.runePool) };
  }) as unknown as [DuelResourcePlayer, DuelResourcePlayer];
  const bases = bs.map((rawBase, index) => {
    const b = record(rawBase, ['playerId', 'locationId', 'baseRunes', 'goldTokens'], 'base');
    if (b.playerId !== ids[index]) fail('base order/player mismatch');
    const locationId = id(b.locationId, 'base location ID');
    if (expected && locationId !== expected[index]!.locationId) fail('base location differs from trusted board');
    const baseRunes = array(b.baseRunes, 'baseRunes').map(rawRune => {
      const rune = baseRune(rawRune, ids[index]!, locationId); reserve(rune.uid); return rune;
    });
    const goldTokens = array(b.goldTokens, 'goldTokens').map(rawGold => {
      const gold = goldToken(rawGold, ids);
      if (gold.ownerPlayerId !== ids[index] || gold.controllerPlayerId !== ids[index] || gold.locationId !== locationId) fail('Gold owner/controller/location mismatch');
      reserve(gold.uid); return gold;
    });
    return { playerId: ids[index], locationId, baseRunes, goldTokens };
  }) as unknown as [DuelResourceBase, DuelResourceBase];
  if (bases[0].locationId === bases[1].locationId) fail('duplicate base locations');
  const retiredGoldUids = array(state.retiredGoldUids, 'retired Gold UIDs').map(rawUid => {
    const uid = id(rawUid, 'retired Gold UID'); reserve(uid); return uid;
  });
  return { playerIds: ids, players, bases, retiredGoldUids };
}

/** Validate a trusted serialized engine snapshot and return a deep, detached copy; never trust client snapshots. */
export function restoreDuelResources(raw: unknown, baseLocations: readonly DuelBaseLocation[]): DuelResources {
  if (baseLocations === undefined) fail('trusted board base locations required on restore');
  return readState(raw, baseLocations);
}
export function assertDuelResources(raw: unknown, baseLocations?: readonly DuelBaseLocation[]): asserts raw is DuelResources {
  readState(raw, baseLocations);
}
export function createDuelResources(input: {
  readonly playerIds: readonly [string, string];
  readonly baseLocations: readonly DuelBaseLocation[];
  readonly runeDecks: readonly [readonly DuelDeckRune[], readonly DuelDeckRune[]];
}): DuelResources {
  const arg = record(input, ['playerIds', 'baseLocations', 'runeDecks'], 'setup');
  const ids = idPair(arg.playerIds);
  const base = locations(arg.baseLocations, ids);
  const decks = array(arg.runeDecks, 'runeDecks');
  if (decks.length !== 2) fail('exactly two Rune Decks required');
  return readState({ playerIds: ids, players: ids.map((playerId, index) => ({
    playerId, runeDeck: decks[index], runePool: emptyPool(),
  })), bases: base.map(b => ({ playerId: b.playerId, locationId: b.locationId, baseRunes: [], goldTokens: [] })), retiredGoldUids: [] }, base);
}
function playerIndex(state: DuelResources, actor: unknown): 0 | 1 {
  if (actor === state.playerIds[0]) return 0;
  if (actor === state.playerIds[1]) return 1;
  fail('unknown actor');
}
function reactionAllowed(state: DuelResources, actor: string, raw: DuelResourceTiming): void {
  const t = record(raw, ['stateOpen', 'priorityPlayerId', 'resourcePaymentPlayerId'], 'timing');
  boolean(t.stateOpen, 'stateOpen');
  for (const key of ['priorityPlayerId', 'resourcePaymentPlayerId'] as const) {
    if (t[key] !== null) playerIndex(state, t[key]);
  }
  // Reaction grants permission in Closed/Showdown too (813.1.c, 813.2), provided
  // the canonical Priority holder has an otherwise legal ability window. 429.3
  // separately permits bypass of ordinary timing while actor must pay resources.
  if (t.priorityPlayerId !== actor && t.resourcePaymentPlayerId !== actor) fail('Add Reaction timing not permitted');
}
function withPlayer(state: DuelResources, index: 0 | 1, runePool: DuelRunePool, runeDeck?: readonly DuelDeckRune[]): DuelResources {
  const players = state.players.map((player, i) => i === index ? { ...player, runeDeck: runeDeck ?? player.runeDeck, runePool } : player) as [DuelResourcePlayer, DuelResourcePlayer];
  return { ...state, players };
}
function addPool(state: DuelResources, index: 0 | 1, from: 'energy' | DuelPowerSource): DuelResources {
  const old = state.players[index].runePool;
  // Check both the affected slot and the total: all pools remain exactly representable.
  if (from === 'energy') {
    const next = checkedAdd(old.energy, 1, 'energy');
    checkedAdd(Object.values(old.power).reduce((a, b) => a + b, old.energy), 1, 'Rune Pool total');
    return withPlayer(state, index, { energy: next, power: old.power });
  }
  const next = checkedAdd(old.power[from], 1, 'Power');
  checkedAdd(Object.values(old.power).reduce((a, b) => a + b, old.energy), 1, 'Rune Pool total');
  return withPlayer(state, index, { energy: old.energy, power: { ...old.power, [from]: next } });
}
function stateCopy(state: DuelResources): DuelResources { return readState(state); }

/** Internal turn/effect-only primitive: caller decides authorized count and any exhausted entry. */
export function channelDuelRunes(state: DuelResources, playerId: string, requestedCount: number, readied = true): DuelResources {
  const out = stateCopy(state), index = playerIndex(out, playerId);
  count(requestedCount, 'channel count'); boolean(readied, 'channel readiness');
  const deck = out.players[index].runeDeck, base = out.bases[index];
  const taken = deck.slice(0, requestedCount);
  const runes = taken.map(rune => ({ uid: rune.uid, cardId: rune.cardId, domain: rune.domain, readied,
    ownerPlayerId: playerId, controllerPlayerId: playerId, locationId: base.locationId }));
  const players = out.players.map((p, i) => i === index ? { ...p, runeDeck: deck.slice(taken.length) } : p) as [DuelResourcePlayer, DuelResourcePlayer];
  const bases = out.bases.map((b, i) => i === index ? { ...b, baseRunes: [...b.baseRunes, ...runes] } : b) as [DuelResourceBase, DuelResourceBase];
  return { ...out, players, bases };
}
function ownRune(out: DuelResources, actor: string, uid: string): { index: 0 | 1; rune: DuelBaseRune; runeIndex: number } {
  const index = playerIndex(out, actor);
  id(uid, 'source UID');
  const runeIndex = out.bases[index].baseRunes.findIndex(r => r.uid === uid);
  if (runeIndex === -1) fail('actor has no such own on-base Basic Rune');
  return { index, runeIndex, rune: out.bases[index].baseRunes[runeIndex]! };
}
export function activateBasicRuneEnergy(state: DuelResources, actor: string, uid: string, timing: DuelResourceTiming): DuelResources {
  const out = stateCopy(state), { index, runeIndex, rune } = ownRune(out, actor, uid);
  reactionAllowed(out, actor, timing);
  if (!rune.readied) fail('cannot exhaust an exhausted Rune');
  const added = addPool(out, index, 'energy');
  const bases = added.bases.map((b, i) => i === index ? { ...b, baseRunes: b.baseRunes.map((r, n) => n === runeIndex ? { ...r, readied: false } : r) } : b) as [DuelResourceBase, DuelResourceBase];
  return { ...added, bases };
}
export function activateBasicRunePower(state: DuelResources, actor: string, uid: string, timing: DuelResourceTiming): DuelResources {
  const out = stateCopy(state), { index, runeIndex, rune } = ownRune(out, actor, uid);
  reactionAllowed(out, actor, timing);
  const added = addPool(out, index, rune.domain);
  const base = added.bases[index];
  const bases = added.bases.map((b, i) => i === index ? { ...b, baseRunes: base.baseRunes.filter((_, n) => n !== runeIndex) } : b) as [DuelResourceBase, DuelResourceBase];
  const deckRune: DuelDeckRune = { uid: rune.uid, cardId: rune.cardId, domain: rune.domain };
  const players = added.players.map((p, i) => i === index ? { ...p, runeDeck: [...p.runeDeck, deckRune] } : p) as [DuelResourcePlayer, DuelResourcePlayer];
  return { ...added, bases, players };
}
/** Caller must have resolved a real Create Gold effect, choose UID and explicitly specify entry readiness. */
export function createDuelGoldToken(state: DuelResources, token: {
  readonly uid: string; readonly playerId: string; readonly locationId: string; readonly readied: boolean;
}): DuelResources {
  const out = stateCopy(state);
  const arg = record(token, ['uid', 'playerId', 'locationId', 'readied'], 'Gold creation');
  const index = playerIndex(out, arg.playerId), uid = id(arg.uid, 'Gold UID');
  if (arg.locationId !== out.bases[index].locationId) fail('Gold is not entering own base');
  const readied = boolean(arg.readied, 'Gold entry readiness');
  if (out.retiredGoldUids.includes(uid) || out.players.some(p => p.runeDeck.some(r => r.uid === uid)) ||
      out.bases.some(b => b.baseRunes.some(r => r.uid === uid) || b.goldTokens.some(g => g.uid === uid))) fail('reused resource UID');
  const gold: DuelGoldToken = { uid, readied, ownerPlayerId: out.playerIds[index], controllerPlayerId: out.playerIds[index], locationId: out.bases[index].locationId };
  const bases = out.bases.map((b, i) => i === index ? { ...b, goldTokens: [...b.goldTokens, gold] } : b) as [DuelResourceBase, DuelResourceBase];
  return { ...out, bases };
}
export function activateDuelGoldPower(state: DuelResources, actor: string, uid: string, timing: DuelResourceTiming): DuelResources {
  const out = stateCopy(state), index = playerIndex(out, actor);
  id(uid, 'Gold UID'); reactionAllowed(out, actor, timing);
  const goldIndex = out.bases[index].goldTokens.findIndex(g => g.uid === uid);
  if (goldIndex < 0) fail('actor has no such own on-base Gold');
  if (!out.bases[index].goldTokens[goldIndex]!.readied) fail('cannot exhaust an exhausted Gold');
  const added = addPool(out, index, 'any');
  const bases = added.bases.map((b, i) => i === index ? { ...b, goldTokens: b.goldTokens.filter((_, n) => n !== goldIndex) } : b) as [DuelResourceBase, DuelResourceBase];
  return { ...added, bases, retiredGoldUids: [...added.retiredGoldUids, uid] };
}
export function clearAllDuelRunePools(state: DuelResources): DuelResources {
  const out = stateCopy(state);
  const players = out.players.map(p => ({ ...p, runePool: emptyPool() })) as [DuelResourcePlayer, DuelResourcePlayer];
  return { ...out, players };
}

function validatedCost(raw: DuelRuneCost): DuelRuneCost {
  const cost = record(raw, ['energy', 'power'], 'cost');
  const energy = count(cost.energy, 'cost energy');
  let total = energy;
  const power = array(cost.power, 'cost power').map(rawRequirement => {
    const r = record(rawRequirement, ['allowedDomains', 'amount'], 'Power requirement');
    const domains = array(r.allowedDomains, 'allowedDomains').map(domain);
    if (domains.length === 0 || domains.length > DUEL_DOMAINS.length || new Set(domains).size !== domains.length) fail('Power requirement must contain unique allowed domains');
    const amount = count(r.amount, 'Power requirement amount');
    if (amount === 0) fail('zero Power requirement; omit it instead');
    total = checkedAdd(total, amount, 'total cost');
    return { allowedDomains: domains, amount };
  });
  return { energy, power };
}
function explicitPlan(raw: DuelPaymentPlan, cost: DuelRuneCost, pool: DuelRunePool): DuelPaymentPlan {
  const data = record(raw, ['power'], 'payment plan');
  const paid = cost.power.map(() => 0);
  const spent = {} as Record<DuelPowerSource, number>;
  for (const from of POWER_SOURCES) spent[from] = 0;
  const seen = new Set<string>();
  const power = array(data.power, 'payment plan power').map(entry => {
    const p = record(entry, ['requirementIndex', 'from', 'amount'], 'allocation');
    const index = count(p.requirementIndex, 'requirement index'), from = powerSource(p.from), amount = count(p.amount, 'allocation amount');
    if (amount === 0 || index >= cost.power.length) fail('invalid allocation amount/index');
    const key = `${index}:${from}`;
    if (seen.has(key)) fail('duplicate allocation pair');
    seen.add(key);
    if (from !== 'any' && !cost.power[index]!.allowedDomains.includes(from)) fail('allocation uses wrong domain');
    paid[index] = checkedAdd(paid[index]!, amount, 'requirement payment');
    spent[from] = checkedAdd(spent[from], amount, 'source payment');
    if (spent[from] > pool.power[from] || paid[index]! > cost.power[index]!.amount) fail('allocation exceeds source or requirement');
    return { requirementIndex: index, from, amount };
  });
  if (paid.some((amount, index) => amount !== cost.power[index]!.amount)) fail('payment plan does not cover all requirements');
  return { power };
}
interface Edge { to: number; reverse: number; capacity: number }
/** Amount-capacity max flow, not a per-unit search: overlapping multi-domain requirements are exact. */
function suggestedPlan(cost: DuelRuneCost, pool: DuelRunePool): DuelPaymentPlan {
  const n = cost.power.length;
  if (!n) return { power: [] };
  const source = 0, poolStart = 1, reqStart = poolStart + POWER_SOURCES.length, sink = reqStart + n;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  function edge(from: number, to: number, capacity: number): Edge {
    const forward: Edge = { to, reverse: graph[to]!.length, capacity };
    const backward: Edge = { to: from, reverse: graph[from]!.length, capacity: 0 };
    graph[from]!.push(forward); graph[to]!.push(backward);
    return forward;
  }
  const links: { index: number; from: DuelPowerSource; edge: Edge; original: number }[] = [];
  for (let s = 0; s < POWER_SOURCES.length; s++) {
    const from = POWER_SOURCES[s]!; edge(source, poolStart + s, pool.power[from]);
    for (let i = 0; i < n; i++) {
      if (from === 'any' || cost.power[i]!.allowedDomains.includes(from)) {
        const original = cost.power[i]!.amount;
        links.push({ index: i, from, edge: edge(poolStart + s, reqStart + i, original), original });
      }
    }
  }
  let needed = 0;
  for (let i = 0; i < n; i++) {
    edge(reqStart + i, sink, cost.power[i]!.amount);
    needed = checkedAdd(needed, cost.power[i]!.amount, 'Power cost');
  }
  let flow = 0;
  while (flow < needed) {
    const level = Array<number>(sink + 1).fill(-1), queue = [source];
    level[source] = 0;
    for (let q = 0; q < queue.length; q++) for (const e of graph[queue[q]!]!) {
      if (e.capacity > 0 && level[e.to] === -1) { level[e.to] = level[queue[q]!]! + 1; queue.push(e.to); }
    }
    if (level[sink] === -1) fail('insufficient matching Power');
    const next = Array<number>(sink + 1).fill(0);
    // Layered paths do not recurse over cost *amount*: at most seven source nodes
    // and a constant number of traversals through requirement nodes.
    function send(node: number, amount: number): number {
      if (node === sink) return amount;
      while (next[node]! < graph[node]!.length) {
        const e = graph[node]![next[node]!]!;
        if (e.capacity > 0 && level[e.to] === level[node]! + 1) {
          const sent = send(e.to, Math.min(amount, e.capacity));
          if (sent > 0) { e.capacity -= sent; graph[e.to]![e.reverse]!.capacity += sent; return sent; }
        }
        next[node] = next[node]! + 1;
      }
      return 0;
    }
    let pushed: number;
    while ((pushed = send(source, needed - flow)) > 0) flow = checkedAdd(flow, pushed, 'Power flow');
  }
  return { power: links.flatMap(({ index, from, edge: e, original }) => {
    const amount = original - e.capacity;
    return amount > 0 ? [{ requirementIndex: index, from, amount }] : [];
  }) };
}
/** Cost and timing must originate from a trusted card/ability transaction, not a client request. */
export function payDuelRuneCost(state: DuelResources, actor: string, rawCost: DuelRuneCost,
  timing: DuelResourceTiming, rawPlan?: DuelPaymentPlan): DuelPaymentResult {
  const out = stateCopy(state), index = playerIndex(out, actor);
  const t = record(timing, ['stateOpen', 'priorityPlayerId', 'resourcePaymentPlayerId'], 'timing');
  boolean(t.stateOpen, 'stateOpen');
  for (const key of ['priorityPlayerId', 'resourcePaymentPlayerId'] as const) if (t[key] !== null) playerIndex(out, t[key]);
  if (t.resourcePaymentPlayerId !== actor) fail('actor has no active resource payment window');
  const cost = validatedCost(rawCost), pool = out.players[index].runePool;
  if (cost.energy > pool.energy) fail('insufficient Energy');
  const plan = rawPlan === undefined ? suggestedPlan(cost, pool) : explicitPlan(rawPlan, cost, pool);
  const spent = {} as Record<DuelPowerSource, number>;
  for (const from of POWER_SOURCES) spent[from] = 0;
  for (const allocation of plan.power) spent[allocation.from] += allocation.amount;
  const power = {} as Record<DuelPowerSource, number>;
  for (const from of POWER_SOURCES) power[from] = pool.power[from] - spent[from];
  return { resources: withPlayer(out, index, { energy: pool.energy - cost.energy, power }), plan };
}

/** Explicit projection: never spread private deck or retired token identities into the client view. */
export function projectPublicDuelResources(state: DuelResources): PublicDuelResources {
  const out = stateCopy(state);
  return {
    players: out.players.map(p => ({ playerId: p.playerId, runePool: pool(p.runePool), runeDeckCount: p.runeDeck.length })),
    bases: out.bases.map(b => ({ playerId: b.playerId, locationId: b.locationId,
      baseRunes: b.baseRunes.map(r => ({ uid: r.uid, cardId: r.cardId, domain: r.domain,
        readied: r.readied, ownerPlayerId: r.ownerPlayerId, controllerPlayerId: r.controllerPlayerId, locationId: r.locationId })),
      goldTokens: b.goldTokens.map(g => ({ uid: g.uid, readied: g.readied,
        ownerPlayerId: g.ownerPlayerId, controllerPlayerId: g.controllerPlayerId, locationId: g.locationId })) })),
  };
}

export function planDuelRunePayment(rawPool: DuelRunePool, rawCost: DuelRuneCost, rawPlan?: DuelPaymentPlan): DuelPaymentPlan {
  const checkedPool = pool(rawPool);
  const cost = validatedCost(rawCost);
  if (cost.energy > checkedPool.energy) fail('insufficient Energy');
  return rawPlan === undefined ? suggestedPlan(cost, checkedPool) : explicitPlan(rawPlan, cost, checkedPool);
}
