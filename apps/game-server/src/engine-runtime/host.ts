import type {
  ActionOutcome,
  ChoiceRequest,
  ContinuousEffectSpec,
  Domain,
  Duration,
  GameAction,
  HistoryQuery,
  LocationRef,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  PlayerSnapshot,
  ResolveContext,
  TokenSpec,
  FinalizedCostPlan,
  PowerPaymentSource,
  ContractGameAction,
  ZoneDestination,
  ZoneId,
} from "../../../../packages/engine-core/dist/effects/contract.js";
import { executeContractAction as executeTypedContractAction }
  from "../../../../packages/engine-core/dist/events/contract-actions/bridge.js";
import { disempowerTransition, empoweredState, empowerTransition, readEmpowered }
  from "../../../../packages/engine-core/dist/zones/empower-state.js";
import {
  bindBurnOutInstructionCapability,
  type BurnOutInstructionCapability,
} from "../../../../packages/engine-core/dist/turn/burn-out.js";

export interface RuntimeCard {
  readonly id: string;
  readonly cardId?: string | null;
  readonly name?: string;
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly keywords?: readonly { readonly id: string; readonly value?: number }[];
  readonly might?: number | null;
  readonly energy?: number | null;
  readonly power?: readonly Domain[] | null;
  /** Deck-building Domains from the trusted catalog, independent of Power. */
  readonly domains?: readonly Domain[];
}

type MutableObject = {
  -readonly [K in keyof ObjectSnapshot]: ObjectSnapshot[K];
} & { counters: Record<string, number>; empowered: number; championLegend?: true };

type RuntimeZone = ZoneId | "base" | "battlefield" | "champion" | "legend";

type MutablePlayer = {
  id: PlayerId;
  name: string;
  energy: number;
  power: PowerPaymentSource[];
  xp: number;
  score: number;
  /** The engine primitive contract names a subset of zones; the runtime also
   * tracks the v2 board/setup zones so move commands remain reversible. */
  zones: Record<RuntimeZone, string[]>;
};

export interface RuntimeHostCheckpoint {
  readonly objects: readonly MutableObject[];
  readonly players: readonly MutablePlayer[];
  readonly lastKnown: readonly [string, ObjectSnapshot][];
  readonly nextToken: number;
  readonly visibility: readonly RuntimeVisibilityGrant[];
  readonly runeDomains?: readonly [string, readonly Domain[]][];
  readonly hidden?: HiddenRuntimeCheckpoint;
  readonly championLegends?: readonly string[];
  readonly burnOutWinner?: PlayerId | null;
}

interface HiddenRuntimeCard {
  readonly ref: ObjectRef;
  readonly battlefieldId: string;
  readonly hiddenTurn: number;
}
interface HiddenRuntimeZone {
  readonly battlefieldId: string;
  readonly controller: PlayerId;
  readonly capacity: number;
  readonly cards: ReadonlyMap<string, HiddenRuntimeCard>;
}
interface HiddenRuntimeState {
  turn: number;
  zones: Map<string, HiddenRuntimeZone>;
  played: Map<string, { readonly battlefieldId: string; readonly location: LocationRef }>;
}
interface HiddenRuntimeCheckpoint {
  readonly turn: number;
  readonly zones: readonly [string, HiddenRuntimeZone][];
  readonly played: readonly [string, { readonly battlefieldId: string; readonly location: LocationRef }][];
}

export interface RuntimeVisibilityGrant {
  readonly kind: "reveal" | "look" | "show-off";
  readonly object: ObjectRef;
  readonly viewers: readonly PlayerId[];
  readonly properties?: readonly (keyof ObjectSnapshot)[];
  readonly active: boolean;
}

const emptyZones = (): Record<RuntimeZone, string[]> => ({
  hand: [], deck: [], "rune-deck": [], trash: [], banishment: [], board: [], "rune-zone": [], chain: [],
  base: [], battlefield: [], champion: [], legend: [],
});

/**
 * Checkpoints contain only the runtime's plain JSON records, arrays, maps and
 * sets. Clone those containers directly so nested transactions do not route
 * the same player/object graph through generic structured cloning.
 */
const clone = <T>(value: T): T => {
  const seen = new Map<object, unknown>();
  const copyValue = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object") return entry;
    const prior = seen.get(entry);
    if (prior !== undefined) return prior;
    if (entry instanceof Map) {
      const copy = new Map<unknown, unknown>(); seen.set(entry, copy);
      for (const [key, item] of entry) copy.set(copyValue(key), copyValue(item));
      return copy;
    }
    if (entry instanceof Set) {
      const copy = new Set<unknown>(); seen.set(entry, copy);
      for (const item of entry) copy.add(copyValue(item));
      return copy;
    }
    if (Array.isArray(entry)) {
      const copy: unknown[] = new Array(entry.length); seen.set(entry, copy);
      for (let index = 0; index < entry.length; index += 1) copy[index] = copyValue(entry[index]);
      return copy;
    }
    const copy: Record<string, unknown> = {}; seen.set(entry, copy);
    for (const [key, item] of Object.entries(entry)) copy[key] = copyValue(item);
    return copy;
  };
  return copyValue(value) as T;
};
const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
  return Object.freeze(value);
};
const CHECKPOINT_VERSION = Symbol("RIFT-1093 runtime checkpoint version");
const CHECKPOINT_PUBLIC = Symbol("RIFT-1093 runtime checkpoint public state");
interface CheckpointPublicState { materialized: boolean; }
interface RuntimeAuthorityVersion {
  readonly objects: readonly MutableObject[];
  readonly players: readonly MutablePlayer[];
  readonly lastKnown: readonly [string, ObjectSnapshot][];
  readonly visibility: readonly RuntimeVisibilityGrant[];
  readonly runeDomains: readonly [string, readonly Domain[]][];
  readonly hidden: HiddenRuntimeCheckpoint;
  readonly championLegends: readonly string[];
  readonly nextToken: number;
  readonly burnOutWinner: PlayerId | null;
}
/**
 * Checkpoints are snapshots of authority, not a second mutable state owner.
 * Reuse the deeply frozen generation until a write rotates it. This keeps
 * nested rollback checkpoints proportional to the number of mutations rather
 * than repeatedly copying the complete room graph.
 */
const authorityVersion = (version: RuntimeAuthorityVersion): RuntimeAuthorityVersion => Object.freeze(version);
const checkpointVersionOf = (checkpoint: unknown): RuntimeAuthorityVersion | undefined =>
  checkpoint !== null && typeof checkpoint === "object"
    ? (() => {
      const state = (checkpoint as Record<symbol, CheckpointPublicState | undefined>)[CHECKPOINT_PUBLIC];
      const shared = (checkpoint as Record<symbol, RuntimeAuthorityVersion | undefined>)[CHECKPOINT_VERSION];
      if (shared === undefined) return undefined;
      if (state?.materialized === true) return undefined;
      return shared;
    })()
    : undefined;
const refKey = (ref: ObjectRef): string => `${ref.id}:${ref.zoneEntryId ?? 0}`;
const KNOWN_DOMAINS = new Set<Domain>(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);

function normalizedDomains(card: RuntimeCard, values: readonly Domain[]): readonly Domain[] {
  const normalized: Domain[] = [];
  for (const [index, domain] of values.entries()) {
    if (!KNOWN_DOMAINS.has(domain)) throw new TypeError(`Runtime card ${card.id} has an invalid Domain at index ${index}`);
    if (!normalized.includes(domain)) normalized.push(domain);
  }
  return normalized;
}

function sameDomains(left: readonly Domain[], right: readonly Domain[]): boolean {
  return left.length === right.length && left.every(domain => right.includes(domain));
}

function objectRef(object: ObjectSnapshot): ObjectRef {
  return { id: object.ref.id, zoneEntryId: object.ref.zoneEntryId };
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function asZone(destination: ZoneDestination): { zone: ZoneId; bottom: boolean } {
  switch (destination) {
    case "deck-top": return { zone: "deck", bottom: false };
    case "deck-bottom": return { zone: "deck", bottom: true };
    default: return { zone: destination as ZoneId, bottom: false };
  }
}

/**
 * A small authoritative state owner for the new engine layers. It deliberately
 * exposes only engine snapshots; the runtime never treats a client projection
 * as mutable state.
 */
export class EngineRuntimeHost {
  private readonly objectMap = new Map<string, MutableObject>();
  private readonly players = new Map<PlayerId, MutablePlayer>();
  private publicWinner: PlayerId | null = null;
  private readonly lastKnown = new Map<string, ObjectSnapshot>();
  /** A choice may be raised after an uncommitted move; retain only those exact
   * option incarnations until the caller answers and replays the transaction. */
  private readonly choiceObjects = new Map<string, ObjectSnapshot>();
  private nextToken = 1;
  private readonly grants: RuntimeVisibilityGrant[] = [];
  private readonly runeDomainsByObject = new Map<string, readonly Domain[]>();
  private readonly catalogDomainsByCardId = new Map<string, readonly Domain[]>();
  private readonly championLegends = new Set<string>();
  private hidden: HiddenRuntimeState = { turn: 1, zones: new Map(), played: new Map() };
  /** One immutable public view per host write generation. */
  private objectsSnapshot: readonly ObjectSnapshot[] | null = null;
  private authority: RuntimeAuthorityVersion | null = null;
  private previousAuthority: RuntimeAuthorityVersion | null = null;

  constructor(
    readonly seatNames: Readonly<Record<PlayerId, string>> = { A: "Player A", B: "Player B" },
    private readonly chooseDelegate: <T>(request: ChoiceRequest<T>) => T,
    catalogDomains: ReadonlyMap<string, readonly Domain[]> = new Map(),
  ) {
    for (const [cardId, values] of catalogDomains) {
      this.catalogDomainsByCardId.set(cardId, normalizedDomains({ id: cardId, domains: values }, values));
    }
    for (const id of Object.keys(seatNames)) {
      this.players.set(id, { id, name: seatNames[id]!, energy: 0, power: [], xp: 0, score: 0, zones: emptyZones() });
    }
  }

  addPlayer(id: PlayerId, name = id): void {
    if (!this.players.has(id)) {
      this.players.set(id, { id, name, energy: 0, power: [], xp: 0, score: 0, zones: emptyZones() });
      this.invalidateObjectCache();
    }
  }

  addCard(player: PlayerId, card: RuntimeCard, zone: ZoneId): ObjectRef {
    if (!this.players.has(player)) throw new Error(`Unknown player ${player}`);
    const id = card.id;
    if (this.objectMap.has(id)) throw new Error(`Duplicate card instance ${id}`);
    const cardId = card.cardId ?? card.id;
    const catalogDomains = this.catalogDomainsByCardId.get(cardId);
    const cardDomains = card.domains === undefined
      ? catalogDomains
      : normalizedDomains(card, card.domains);
    if (cardDomains !== undefined && catalogDomains !== undefined && !sameDomains(cardDomains, catalogDomains)) {
      throw new TypeError(`Runtime card ${id} has Domains inconsistent with trusted catalog metadata`);
    }
    const object: MutableObject = {
      ref: { id, zoneEntryId: 1 }, cardId, name: card.name ?? card.id,
      types: [...(card.types ?? [zone === "rune-deck" ? "rune" : "unit"])], tags: [...(card.tags ?? [])],
      keywords: [...(card.keywords ?? [])], owner: player, controller: player, zone, location: null,
      combatRole: null, might: card.might === undefined ? 1 : card.might,
      energy: card.energy === undefined ? null : card.energy,
      power: card.power == null ? null : [...card.power], exhausted: false, damage: 0,
      stunned: false, buffs: 0, attachedTo: null, faceDown: zone === "deck" || zone === "rune-deck", isToken: false,
      counters: {}, empowered: 0,
    };
    this.objectMap.set(id, object);
    if (cardDomains !== undefined) this.runeDomainsByObject.set(id, cardDomains);
    this.players.get(player)!.zones[zone].push(id);
    this.invalidateObjectCache();
    return objectRef(object);
  }

  checkpoint(): RuntimeHostCheckpoint {
    const version = this.authority ?? this.captureAuthority();
    const state: CheckpointPublicState = { materialized: false };
    const values = new Map<PropertyKey, unknown>();
    const get = <T>(key: keyof RuntimeAuthorityVersion): T => {
      state.materialized = true;
      if (!values.has(key)) values.set(key, clone(version[key]));
      return values.get(key) as T;
    };
    const saved = {};
    for (const key of ["objects", "players", "lastKnown", "nextToken", "visibility", "runeDomains",
      "hidden", "championLegends", "burnOutWinner"] as const) {
      Object.defineProperty(saved, key, { enumerable: true, get: () => get<RuntimeAuthorityVersion[typeof key]>(key) });
    }
    Object.defineProperty(saved, CHECKPOINT_VERSION, { value: version });
    Object.defineProperty(saved, CHECKPOINT_PUBLIC, { value: state });
    return saved as RuntimeHostCheckpoint;
  }

  restore(checkpoint: unknown): void {
    const saved = checkpoint as RuntimeHostCheckpoint;
    const shared = checkpointVersionOf(checkpoint);
    this.objectMap.clear(); this.players.clear(); this.lastKnown.clear(); this.grants.splice(0); this.runeDomainsByObject.clear(); this.championLegends.clear();
    if (shared !== undefined) {
      for (const object of shared.objects) this.objectMap.set(object.ref.id, clone(object));
      for (const player of shared.players) this.players.set(player.id, clone(player));
      for (const entry of shared.lastKnown) this.lastKnown.set(entry[0], clone(entry[1]));
    } else {
      for (const object of clone(saved.objects)) this.objectMap.set(object.ref.id, object);
      for (const player of clone(saved.players)) this.players.set(player.id, player);
      for (const [key, object] of clone(saved.lastKnown)) this.lastKnown.set(key, object);
    }
    this.nextToken = saved.nextToken;
    this.grants.push(...clone(shared?.visibility ?? saved.visibility));
    const savedDomains = shared?.runeDomains ?? saved.runeDomains;
    for (const entry of savedDomains ?? []) this.runeDomainsByObject.set(entry[0], clone(entry[1]));
    for (const key of shared?.championLegends ?? saved.championLegends ?? []) this.championLegends.add(key);
    this.publicWinner = saved.burnOutWinner ?? null;
    if (saved.runeDomains === undefined) {
      for (const object of this.objectMap.values()) {
        const value = object.cardId === null ? undefined : this.catalogDomainsByCardId.get(object.cardId);
        if (value !== undefined) this.runeDomainsByObject.set(object.ref.id, value);
      }
    }
    const hidden = shared?.hidden ?? saved.hidden;
    this.hidden = hidden === undefined
      ? { turn: 1, zones: new Map(), played: new Map() }
      : { turn: hidden.turn, zones: new Map(clone(hidden.zones)), played: new Map(clone(hidden.played)) };
    this.authority = shared ?? this.captureAuthority();
    this.invalidateObjectCache();
  }

  objects(): readonly ObjectSnapshot[] {
    if (this.objectsSnapshot !== null) return this.objectsSnapshot;
    const authority = this.authority ?? this.captureAuthority();
    this.objectsSnapshot = Object.freeze([...authority.objects]);
    return this.objectsSnapshot;
  }

  /** Subclasses that adapt authoritative zones must retire the public view. */
  protected invalidateObjectCache(): void {
    this.objectsSnapshot = null;
    if (this.authority !== null) this.previousAuthority = this.authority;
    this.authority = null;
  }

  /** Capture an immutable generation; active containers remain private maps. */
  private captureAuthority(): RuntimeAuthorityVersion {
    const previous = this.previousAuthority;
    const previousObjects = new Map(previous?.objects.map(object => [object.ref.id, object]));
    const previousPlayers = new Map(previous?.players.map(player => [player.id, player]));
    const previousDomains = new Map<string, readonly Domain[]>();
    for (const entry of previous?.runeDomains ?? []) previousDomains.set(entry[0], entry[1]);
    const objectChanged = (value: MutableObject, prior: ObjectSnapshot): boolean => {
      const next = value as unknown as Record<string, unknown>;
      const old = prior as unknown as Record<string, unknown>;
      for (const key of Object.keys(next)) {
        if (key === "counters") continue;
        if (!Object.is(next[key], old[key])) return true;
      }
      const counters = value.counters;
      const priorCounters = prior as MutableObject;
      if (Object.keys(counters).length !== Object.keys(priorCounters.counters).length) return true;
      return Object.entries(counters).some(([key, count]) => priorCounters.counters[key] !== count);
    };
    const playerChanged = (value: MutablePlayer, prior: MutablePlayer): boolean => {
      if (value.id !== prior.id || value.name !== prior.name || value.energy !== prior.energy ||
          value.xp !== prior.xp || value.score !== prior.score || value.power.length !== prior.power.length) return true;
      return value.power.some((source, index) => prior.power[index] !== source) ||
        (Object.keys(value.zones) as RuntimeZone[]).some(zone =>
          value.zones[zone].length !== prior.zones[zone].length ||
          value.zones[zone].some((id, index) => prior.zones[zone][index] !== id));
    };
    const objects = [...this.objectMap.values()].map(object => {
      const prior = previousObjects.get(object.ref.id);
      return prior !== undefined && object.ref.zoneEntryId === prior.ref.zoneEntryId && !objectChanged(object, prior)
        ? prior
        : deepFreeze(clone(object));
    });
    const players = [...this.players.values()].map(player => {
      const prior = previousPlayers.get(player.id);
      return prior !== undefined && !playerChanged(player, prior) ? prior : deepFreeze(clone(player));
    });
    const lastKnown = [...this.lastKnown.entries()].map(([key, object]) => {
      const prior = previous?.lastKnown.find(entry => entry[0] === key)?.[1];
      const current = deepFreeze(clone(object));
      return [key, prior !== undefined && Object.is(object, prior) ? prior : current] as [string, ObjectSnapshot];
    });
    const version = authorityVersion({
      objects: deepFreeze(objects),
      players: deepFreeze(players),
      lastKnown: deepFreeze(lastKnown),
      visibility: deepFreeze(this.grants.map(grant => clone(grant))),
      runeDomains: deepFreeze([...this.runeDomainsByObject.entries()].map(([key, domains]) =>
        [key, previousDomains.get(key) ?? deepFreeze(clone(domains))] as [string, readonly Domain[]])),
      hidden: deepFreeze(clone({ turn: this.hidden.turn, zones: [...this.hidden.zones.entries()], played: [...this.hidden.played.entries()] })),
      championLegends: deepFreeze([...this.championLegends]),
      nextToken: this.nextToken,
      burnOutWinner: this.publicWinner,
    });
    this.authority = version;
    this.previousAuthority = version;
    return version;
  }

  object(ref: ObjectRef): ObjectSnapshot | null {
    const object = this.objectMap.get(ref.id);
    if (object && object.ref.zoneEntryId === ref.zoneEntryId) return clone(object);
    return clone(this.choiceObjects.get(refKey(ref)) ?? null);
  }

  /** Resolve one staged object without cloning the complete authority view. */
  protected stagedObject(ref: ObjectRef): ObjectSnapshot | null {
    const object = this.objectMap.get(ref.id);
    if (object && object.ref.zoneEntryId === ref.zoneEntryId) return object;
    const choice = this.choiceObjects.get(refKey(ref));
    return choice === undefined ? null : choice;
  }

  /** Ask for exactly one decision. Object options retain the transaction's
   * precise snapshots across the rollback that suspends the decision. */
  choose<T>(request: ChoiceRequest<T>): T {
    const prior = new Map(this.choiceObjects);
    this.choiceObjects.clear();
    if (request.type === "select-objects" || request.type === "order") {
      for (const ref of request.options) {
        const object = this.objectMap.get(ref.id);
        if (object?.ref.zoneEntryId === ref.zoneEntryId) this.choiceObjects.set(refKey(ref), clone(object));
      }
    }
    try {
      const answer = this.chooseDelegate(request);
      for (const [key, object] of prior) if (!this.choiceObjects.has(key)) this.choiceObjects.set(key, object);
      this.choiceObjects.clear();
      return answer;
    } catch (error) {
      // The outer transaction owns whether this is a pending choice or a
      // rejected command. Restore its exact set while the error unwinds; the
      // next actual state action retires any choice-only view.
      for (const [key, object] of prior) if (!this.choiceObjects.has(key)) this.choiceObjects.set(key, object);
      throw error;
    }
  }

  lastKnownObject(ref: ObjectRef): ObjectSnapshot {
    return clone(this.lastKnown.get(refKey(ref)) ?? this.objectMap.get(ref.id) ?? {
      ref, cardId: null, name: "Unknown", types: [], tags: [], keywords: [], owner: "unknown",
      controller: "unknown", zone: "chain", location: null, combatRole: null, might: null, energy: null,
      power: null, exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: true, isToken: true,
    });
  }

  /** Catalog Domains for one current incarnation; stale and unknown refs fail closed. */
  runeDomains(ref: ObjectRef): readonly Domain[] {
    this.requireObject(ref);
    const value = this.runeDomainsByObject.get(ref.id);
    if (value === undefined) throw new Error(`Missing catalog Domains for ${ref.id}`);
    return [...value];
  }

  player(id: PlayerId): PlayerSnapshot {
    const player = this.players.get(id);
    if (!player) throw new Error(`Unknown player ${id}`);
    const runePool = player.zones["rune-zone"].map(objectId => objectRef(this.objectMap.get(objectId)!));
    return {
      id, energy: player.energy, power: [...player.power], runePool, runes: runePool, xp: player.xp, score: player.score,
      handSize: player.zones.hand.length, handCount: player.zones.hand.length,
      deckSize: player.zones.deck.length, deckCount: player.zones.deck.length,
      runeDeckSize: player.zones["rune-deck"].length, runeDeckCount: player.zones["rune-deck"].length,
    };
  }

  playerNames(): Readonly<Record<PlayerId, string>> {
    return Object.fromEntries([...this.players].map(([id, player]) => [id, player.name]));
  }

  /** Winner committed by a state-owner Burn Out continuation, if any. */
  burnOutWinner(): PlayerId | null { return this.publicWinner; }

  zoneObjects(player: PlayerId, zone: ZoneId | string): readonly ObjectSnapshot[] {
    if (Object.hasOwn(emptyZones(), zone)) {
      const ids = this.players.get(player)?.zones[zone as ZoneId] ?? [];
      return ids.map(id => this.objectMap.get(id)).filter((object): object is MutableObject => object !== undefined).map(object => clone(object));
    }
    return [...this.objectMap.values()].filter(object => object.owner === player && object.zone === zone).map(object => clone(object));
  }

  visibility(): readonly RuntimeVisibilityGrant[] { return clone(this.grants); }

  /** Current Hidden cards only; deck/rune cards are not Facedown Zone cards. */
  hiddenObjects(): readonly ObjectSnapshot[] {
    return [...this.hidden.zones.values()].flatMap(zone => [...zone.cards.values()].flatMap(card => {
      const object = this.objectMap.get(card.ref.id);
      return object?.ref.zoneEntryId === card.ref.zoneEntryId && object.faceDown ? [clone(object)] : [];
    }));
  }

  registerBattlefield(player: PlayerId, id: string, capacity = 1): void {
    if (!this.players.has(player) || !validCount(capacity)) throw new Error("Invalid Facedown Zone registration");
    const battlefield = this.objectMap.get(id);
    if (!battlefield || !battlefield.types.some(type => type.toLowerCase() === "battlefield")) {
      throw new Error(`Unknown Battlefield ${id}`);
    }
    if (!this.hidden.zones.has(id)) this.hidden.zones.set(id, { battlefieldId: id, controller: player, capacity, cards: new Map() });
  }

  advanceTurn(turn: number): void {
    if (!validCount(turn) || turn < this.hidden.turn) throw new Error("Hidden turn cannot move backwards");
    this.hidden.turn = turn;
  }

  perform(action: GameAction): ActionOutcome {
    // A suspended choice is the only reader allowed to observe the rolled-back
    // option incarnations. Any new state action retires that narrow view.
    this.choiceObjects.clear();
    this.invalidateObjectCache();
    try {
      switch (action.type) {
        case "create-token": return this.createToken(action.player, action.token, action.to, action.location);
        case "move-zone": return this.move(action.object, action.to, action.location);
        case "recycle": {
          const object = this.requireObject(action.object);
          return this.move(action.object, object.types.some(type => type.toLowerCase() === "rune") ? "rune-deck" : "deck-bottom");
        }
        case "draw": return this.draw(action.player, action.amount);
        case "mill": return this.mill(action.player, action.amount);
        case "shuffle": return this.shuffle(action.player, action.zone ?? "deck");
        case "order-top": return this.orderTop(action.player, action.objects, action.zone ?? "deck");
        case "discard": return this.move(action.object, "trash");
        case "banish": return this.move(action.object, "banishment");
        case "return-to-hand": return this.move(action.object, "hand");
        case "move-location": return this.moveLocation(action.object, action.to);
        case "ready": return this.setExhausted(action.object, false);
        case "exhaust": return this.setExhausted(action.object, true);
        case "stun": { this.requireObject(action.object).stunned = true; return this.done(); }
        case "kill": return this.move(action.object, "trash");
        case "attach": {
          const object = this.requireObject(action.object), host = this.requireObject(action.host);
          if (object.types.some(type => type.toLowerCase() === "unit") || !host.types.some(type => type.toLowerCase() === "unit")) return this.prevented();
          object.attachedTo = objectRef(host); return this.done();
        }
        case "detach": this.requireObject(action.object).attachedTo = null; return this.done();
        case "take-control": this.requireObject(action.object).controller = action.player; return this.done();
        case "damage": { const target = this.requireObject(action.target); target.damage += action.amount; return this.done(action.amount); }
        case "heal": { const target = this.requireObject(action.object); const amount = Math.min(target.damage, action.amount); target.damage -= amount; return this.done(amount); }
        // CR 431.2.a: runes are channeled readied unless the effect stipulates otherwise.
        case "channel-rune": return this.channel(action.player, action.amount, action.exhausted ?? false);
        case "gain-energy": { const player = this.requirePlayer(action.player); player.energy += action.amount; return this.done(action.amount); }
        case "gain-power": {
          const player = this.requirePlayer(action.player);
          if (!Array.isArray(action.power) || action.power.some(source =>
            !KNOWN_DOMAINS.has(source as Domain) && !["universal", "any", "universal-power"].includes(source))) return this.impossible();
          player.power.push(...action.power); return this.done(action.power);
        }
        case "pay": return this.pay(action.player, action.plan);
        case "gain-xp": { const player = this.requirePlayer(action.player); player.xp += action.amount; return this.done(action.amount); }
        case "spend-xp": { const player = this.requirePlayer(action.player); if (player.xp < action.amount) return this.prevented(); player.xp -= action.amount; return this.done(action.amount); }
        case "buff": { const object = this.requireObject(action.object); object.buffs += action.amount; return this.done(object.buffs); }
        case "spend-buff": { const object = this.requireObject(action.object); if (object.buffs < action.amount) return this.prevented(); object.buffs -= action.amount; return this.done(object.buffs); }
        case "empower": {
          const object = this.requireObject(action.object);
          const transition = empowerTransition(readEmpowered(object), {
            amount: action.amount ?? 1, multiple: action.multiple, limit: action.limit });
          if (!transition.changed) return this.prevented();
          Object.assign(object, empoweredState(transition.currentCount));
          return this.done(object.empowered);
        }
        case "disempower": {
          const object = this.requireObject(action.object);
          const transition = disempowerTransition(readEmpowered(object));
          if (!transition.changed) return this.prevented();
          Object.assign(object, empoweredState(transition.currentCount));
          return this.done();
        }
        case "add-counter": {
          const object = this.requireObject(action.object); object.counters[action.counter] = (object.counters[action.counter] ?? 0) + action.amount; return this.done(object.counters[action.counter]);
        }
        case "remove-counter": {
          const object = this.requireObject(action.object); object.counters[action.counter] = Math.max(0, (object.counters[action.counter] ?? 0) - action.amount); return this.done(object.counters[action.counter]);
        }
        case "reveal": {
          const object = this.requireObject(action.object); this.grants.push({ kind: "reveal", object: objectRef(object), viewers: [...(action.viewers ?? [...this.players.keys()])], active: true }); return this.done(objectRef(object));
        }
        case "look": for (const ref of action.objects) this.grants.push({ kind: "look", object: ref, viewers: [action.player], active: true }); return this.done(action.objects);
        case "show-off": {
          const object = this.requireObject(action.object); this.grants.push({ kind: "show-off", object: objectRef(object), viewers: [...(action.viewers ?? [...this.players.keys()])], properties: [...action.properties], active: true }); return this.done(objectRef(object));
        }
        case "score": { const player = this.requirePlayer(action.player); player.score += action.amount; return this.done(player.score); }
        case "win": this.requirePlayer(action.player); return this.done(action.player);
        case "play": return this.play(action);
        case "counter": return this.counter(action);
      }
      return this.impossible();
    } catch {
      return this.impossible();
    } finally {
      this.invalidateObjectCache();
    }
  }

  /** Versioned direct consumer for actions outside the closed GameAction union. */
  performContract(action: ContractGameAction): ActionOutcome {
    this.choiceObjects.clear();
    const checkpoint = this.checkpoint();
    this.invalidateObjectCache();
    try {
      const outcome = this.performContractInternal(action);
      if (outcome.status !== "done") this.restore(checkpoint);
      return outcome;
    } finally {
      this.invalidateObjectCache();
    }
  }

  /** Install the authoritative Facedown Zone capacity/controller for one Battlefield. */
  configureFacedownZone(battlefieldId: string, controller: PlayerId, capacity: number): void {
    const battlefield = this.objectMap.get(battlefieldId);
    if (!battlefield || !battlefield.types.some(type => type.toLowerCase() === "battlefield") ||
        !this.players.has(controller) || !validCount(capacity)) throw new Error("Invalid Facedown Zone configuration");
    const existing = this.hidden.zones.get(battlefieldId);
    if (existing !== undefined && existing.cards.size > capacity) throw new Error("Facedown Zone capacity is below occupancy");
    this.hidden.zones.set(battlefieldId, {
      battlefieldId,
      controller,
      capacity,
      cards: existing?.cards ?? new Map(),
    });
  }

  private performContractInternal(action: ContractGameAction): ActionOutcome {
    if (action.type === "recall") return this.recall(action);
    if (action.type === "hide") return this.hide(action);
    if (action.type === "batch") {
      return executeTypedContractAction(action, {
        checkpoint: () => this.checkpoint(),
        restore: value => this.restore(value),
        objects: () => this.objects(),
        perform: leaf => this.perform(leaf),
        performContract: leaf => this.performContractInternal(leaf),
        performBatchLeaf: (leaf, batchId) => this.performKillBatchWithDeathBoundary([leaf as Extract<GameAction, { type: "kill" }>], batchId, () => {}).outcome,
      }).outcome;
    }
    return this.perform(action);
  }

  /** Confirmed Kill seam: validate the exact Board incarnation before notifying. */
  performWithDeathBoundary(
    action: GameAction,
    boundary: (before: readonly ObjectSnapshot[]) => void,
  ): ActionOutcome {
    if (action.type !== "kill") return this.perform(action);
    const object = this.object(action.object);
    if (object === null || object.zone !== "board") return this.impossible();
    const checkpoint = this.checkpoint();
    this.invalidateObjectCache();
    try {
      boundary([object]);
      return this.move(action.object, "trash");
    } catch (error) {
      this.restore(checkpoint);
      throw error;
    } finally {
      this.invalidateObjectCache();
    }
  }

  /** Validate every typed leaf, scan once, then commit the complete Kill wave. */
  performKillBatchWithDeathBoundary(
    actions: readonly Extract<GameAction, { type: "kill" }>[],
    batchId: string,
    boundary: (before: readonly ObjectSnapshot[]) => void,
  ): import("../../../../packages/engine-core/dist/events/contract-actions/bridge.js").ContractActionExecution {
    if (typeof batchId !== "string" || batchId.length === 0) {
      return { outcome: this.impossible(), steps: [] };
    }
    const keys = actions.map(action => refKey(action.object));
    if (actions.length === 0 || new Set(keys).size !== keys.length) {
      return { outcome: this.impossible(), steps: [] };
    }
    const checkpoint = this.checkpoint();
    this.invalidateObjectCache();
    const confirmed: ObjectSnapshot[] = [];
    try {
      for (const action of actions) {
        const object = this.object(action.object);
        if (object === null || object.zone !== "board") {
          this.restore(checkpoint);
          return { outcome: this.impossible(), steps: [] };
        }
        confirmed.push(object);
      }
      boundary(confirmed);
      const steps = [];
      for (const action of actions) {
        const before = this.objects();
        const outcome = this.move(action.object, "trash");
        if (outcome.status !== "done") throw new Error(`Confirmed Kill could not enter Trash: ${action.object.id}`);
        steps.push({ action, before, after: this.objects(), outcome });
      }
      return {
        outcome: {
          status: "done" as const,
          events: [],
          receipt: {
            transactionId: batchId,
            status: "committed" as const,
            actions: actions.map(() => ({ type: "kill" as const, status: "done" as const })),
          },
        },
        steps,
      };
    } catch (error) {
      this.restore(checkpoint);
      throw error;
    } finally {
      this.invalidateObjectCache();
    }
  }

  context(source: ObjectSnapshot, controller: PlayerId, timingPoint: ResolveContext["timingPoint"]): ResolveContext {
    const links = new Map<string, unknown>();
    const effectSource = bindBurnOutInstructionCapability(source, this.burnOutCapability());
    return {
      source: effectSource, controller, timingPoint,
      object: ref => this.object(ref), lastKnown: ref => this.lastKnownObject(ref),
      query: filter => this.objects().filter(object => matchesFilter(object, filter)),
      zoneSlice: (player, zone, from, count) => {
        const values = this.zoneObjects(player, zone);
        const length = Math.min(count ?? values.length, values.length);
        return from === "top" ? values.slice(0, length) : values.slice(values.length - length);
      },
      targets: () => [], picks: () => [], player: id => this.player(id), evaluate: expression => evaluateExpression(expression, source, links),
      test: condition => condition.kind === "always" ? true : condition.kind === "never" ? false : true,
      linked: key => links.get(key), history: () => 0, choose: request => this.choose(request),
      perform: action => this.perform(action as GameAction), link: (key, value) => links.set(key, value),
      addContinuous: (_effect: ContinuousEffectSpec, _duration: Duration) => { throw new Error("Continuous program binding is not available in server runtime"); },
      registerDelayedTrigger: () => { throw new Error("Delayed trigger binding is not available in server runtime"); },
    } as ResolveContext;
  }

  private requirePlayer(id: PlayerId): MutablePlayer {
    const player = this.players.get(id); if (!player) throw new Error(`Unknown player ${id}`); return player;
  }

  private burnOutCapability(): BurnOutInstructionCapability {
    return {
      participants: () => [...this.players.values()].map(player => ({
        id: player.id,
        deckCount: player.zones.deck.length,
        trashCount: player.zones.trash.length,
      })),
      trash: owner => this.zoneObjects(owner, "trash").map(objectRef),
      // A later Burn Out point is unreplaceable by CR 432.3.b, so this direct
      // state-owner seam intentionally does not re-enter replacement matching.
      performPoint: action => this.perform(action),
      afterBurnOut: sequence => {
        if (sequence === 0) return true;
        const players = [...this.players.values()];
        const winner = players.find(player => player.score >= 8 &&
          players.every(other => other === player || player.score > other.score));
        if (winner === undefined) return true;
        this.publicWinner = winner.id;
        return false;
      },
    };
  }

  private requireObject(ref: ObjectRef): MutableObject {
    const object = this.objectMap.get(ref.id);
    if (!object || object.ref.zoneEntryId !== ref.zoneEntryId) throw new Error(`Stale object reference ${ref.id}`);
    return object;
  }

  private done(result?: unknown): ActionOutcome { return { status: "done", events: [], ...(result === undefined ? {} : { result }) } as ActionOutcome; }
  private impossible(): ActionOutcome { return { status: "impossible", events: [] }; }
  private prevented(): ActionOutcome { return { status: "prevented", events: [] }; }

  private removeFromZone(object: MutableObject): void {
    for (const player of this.players.values()) {
      for (const zone of Object.values(player.zones)) {
        const index = zone.indexOf(object.ref.id);
        if (index >= 0) zone.splice(index, 1);
      }
    }
  }

  private move(ref: ObjectRef, destination: ZoneDestination, location?: LocationRef): ActionOutcome {
    const object = this.requireObject(ref), player = this.requirePlayer(object.owner), target = asZone(destination);
    // A Champion Legend is established once in its public Legend Zone and
    // cannot be removed, moved, or displaced (CR v1.5 107.4.d / 174.4). The
    // token identity is exactly the setup-created Champion Legend here.
    if (object.zone === "legend" && this.championLegends.has(refKey(object.ref))) {
      return this.prevented();
    }
    // Non-Champion Legends may leave only into Banishment (107.4.d.2).
    if (object.types.some(type => type.toLowerCase() === "legend") && target.zone !== "banishment") {
      return this.prevented();
    }
    const hiddenSource = object.faceDown ? this.hiddenEntry(object) : null;
    this.removeFromZone(object); this.lastKnown.set(refKey(object.ref), clone(object));
    object.zone = target.zone; object.location = location ?? null; object.ref = { id: object.ref.id, zoneEntryId: (object.ref.zoneEntryId ?? 0) + 1 };
    object.faceDown = target.zone === "deck" || target.zone === "rune-deck";
    object.facedownLocation = null;
    const zone = player.zones[target.zone] ?? (player.zones[target.zone] = []);
    if (target.bottom) zone.push(object.ref.id); else zone.unshift(object.ref.id);
    if (hiddenSource !== null) {
      const hiddenZone = this.hidden.zones.get(hiddenSource.battlefieldId)!;
      this.hidden.zones.set(hiddenSource.battlefieldId, {
        ...hiddenZone,
        cards: new Map([...hiddenZone.cards].filter(([key, card]) => key !== refKey(card.ref))),
      });
      if (target.zone === "chain") {
        this.hidden.played.set(refKey(object.ref), {
          battlefieldId: hiddenSource.battlefieldId,
          location: hiddenSource.location,
        });
      }
    }
    return this.done(objectRef(object));
  }

  /**
   * The state half of Play. Cost selection, Finalize and card-program binding
   * stay with ChainEngine; this primitive validates the authoritative current
   * incarnation, pays a supplied finalized plan as one unit, and enters Chain.
   */
  private play(action: Extract<GameAction, { type: "play" }>): ActionOutcome {
    const checkpoint = this.checkpoint();
    let outcome: ActionOutcome;
    try {
      outcome = this.playChecked(action);
    } catch {
      this.restore(checkpoint);
      return this.impossible();
    }
    if (outcome.status !== "done") this.restore(checkpoint);
    return outcome;
  }

  private playChecked(action: Extract<GameAction, { type: "play" }>): ActionOutcome {
    const object = this.requireObject(action.object);
    if (!this.players.has(action.player)) return this.impossible();
    const suppliedCost = Object.hasOwn(action, "cost") ? action.cost as FinalizedCostPlan : undefined;
    if (action.cost !== undefined && action.cost.finalized !== true) return this.impossible();
    const hiddenSource = this.hiddenEntry(object);
    if (object.types.some(type => type.toLowerCase() === "spell") && hiddenSource === null && action.location !== undefined) return this.impossible();
    if (hiddenSource === null && object.zone !== "hand" && object.zone !== "banishment" && object.zone !== "chain") return this.impossible();
    if (hiddenSource !== null && object.zone !== "board" && (object.zone as string) !== "battlefield") return this.impossible();
    if (object.controller !== action.player) return this.impossible();
    if (action.location?.type === "base" && action.location.player !== action.player) return this.impossible();
    if (!object.types.some(type => ["unit", "spell", "gear"].includes(type.toLowerCase()))) return this.impossible();
    if (hiddenSource !== null) {
      // A Hidden permanent remains tied to its Facedown Zone Battlefield for
      // Finalize, even after the card itself enters the public Chain.
      const destination = action.location ?? hiddenSource.location;
      if (destination.type !== "battlefield" || destination.id !== hiddenSource.battlefieldId) return this.impossible();
    }
    const fields = this.battlefieldIds();
    if (action.location?.type === "battlefield" && !fields.includes(action.location.id)) return this.impossible();
    if (fields.length > 0 && action.location !== undefined && !this.battlefieldChoiceLegal(action, object)) return this.impossible();
    // CR 811.1.c.3: Hidden play is unlocked on a later turn. Check this
    // before payment so a same-turn attempt cannot consume resources.
    if (hiddenSource !== null && !(this.hidden.turn > hiddenSource.hiddenTurn)) return this.impossible();
    if (suppliedCost !== undefined) {
      const payment = this.pay(action.player, suppliedCost);
      if (payment.status !== "done") return payment;
    }
    if (object.zone === "chain") return this.done(objectRef(object));
    return this.move(object.ref, "chain");
  }

  private battlefieldChoiceLegal(action: Extract<GameAction, { type: "play" }>, object: ObjectSnapshot): boolean {
    if (object.types.some(type => type.toLowerCase() === "spell")) return action.location === undefined;
    if (action.location?.type === "battlefield") return object.types.some(type => type.toLowerCase() === "unit");
    return object.types.some(type => type.toLowerCase() === "unit" || type.toLowerCase() === "gear");
  }

  private battlefieldIds(): readonly string[] {
    const fields = new Set<string>();
    for (const object of this.objectMap.values()) {
      if (object.zone !== "board" || !object.types.some(type => type.toLowerCase() === "battlefield")) continue;
      fields.add(object.ref.id);
      if (object.location?.type === "battlefield") fields.add(object.location.id);
    }
    return [...fields];
  }

  /** CR 426.1: only a current Chain item can be countered; its owner receives Trash. */
  private counter(action: Extract<GameAction, { type: "counter" }>): ActionOutcome {
    const checkpoint = this.checkpoint();
    const object = this.objectMap.get(action.object.id);
    const outcome = !object || object.ref.zoneEntryId !== action.object.zoneEntryId || object.zone !== "chain"
      ? this.impossible()
      : this.move(action.object, "trash");
    if (outcome.status !== "done") this.restore(checkpoint);
    return outcome;
  }

  /** CR 457-460: independent relocation that preserves the exact incarnation. */
  private recall(action: import("../../../../packages/engine-core/dist/effects/contract.js").RecallAction): ActionOutcome {
    const object = this.object(action.object);
    if (!object || object.zone !== "board" || object.location === null || object.controller !== action.player ||
        !object.types.some(type => type === "unit" || type === "gear")) return this.impossible();
    const before = this.checkpoint();
    this.objectMap.get(object.ref.id)!.location = { type: "base", player: object.controller };
    const after = this.object(object.ref);
    if (!after) {
      this.restore(before);
      return this.impossible();
    }
    return {
      ...this.done(action.object),
      receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] },
      events: [{
        type: "task-resolved", seq: 0, turnNumber: this.hidden.turn, activePlayerId: action.player,
        taskId: `recall:${refKey(action.object)}`, sourceCardId: object.cardId ?? "",
        reason: "recall", autoResolved: true, action: "recall",
        details: { recall: true, from: object.location, to: after.location },
      } as never],
    };
  }

  private hide(action: import("../../../../packages/engine-core/dist/effects/contract.js").HideAction): ActionOutcome {
    const object = this.object(action.object);
    if (!object || object.zone !== "hand" || object.controller !== action.player || !object.keywords.some(keyword =>
      keyword.id.toLowerCase().replace(/[\s_-]+/g, "") === "hidden")) return this.impossible();
    if (!object.types.some(type => ["unit", "spell", "gear"].includes(type.toLowerCase()))) return this.impossible();
    const battlefield = this.objectMap.get(action.location.id);
    if (!battlefield || battlefield.controller !== action.player ||
        !battlefield.types.some(type => type.toLowerCase() === "battlefield")) return this.impossible();
    const checkpoint = this.checkpoint();
    const zone = this.hidden.zones.get(action.location.id) ?? {
      battlefieldId: action.location.id, controller: action.player, capacity: 1, cards: new Map(),
    };
    if (zone.controller !== action.player || zone.cards.size >= zone.capacity) return this.impossible();
    if (action.cost !== undefined && this.pay(action.player, action.cost).status !== "done") {
      this.restore(checkpoint);
      return this.impossible();
    }
    const transition = this.move(action.object, "battlefield", action.location);
    if (transition.status !== "done") {
      this.restore(checkpoint);
      return transition;
    }
    const current = this.objectMap.get(action.object.id)!;
    const hiddenZone = this.hidden.zones.get(action.location.id)!;
    this.hidden.zones.set(action.location.id, {
      ...hiddenZone,
      cards: new Map([...hiddenZone.cards, [refKey(current.ref), {
        ref: current.ref, battlefieldId: action.location.id, hiddenTurn: this.hidden.turn,
      }]]),
    });
    current.faceDown = true;
    current.facedownLocation = action.location;
    return this.done(objectRef(current));
  }

  private hasBattlefield(id: string): boolean {
    const current = this.objectMap.get(id);
    if (current?.zone === "board" && current.types.some(type => type.toLowerCase() === "battlefield")) return true;
    return this.objects().some(object => object.zone === "board" && object.types.some(type => type.toLowerCase() === "battlefield") &&
      (object.ref.id === id || object.location?.type === "battlefield" && object.location.id === id));
  }

  private hiddenEntry(object: ObjectSnapshot): {
    readonly battlefieldId: string;
    readonly location: LocationRef;
    readonly hiddenTurn: number;
  } | null {
    if (!object.faceDown || object.facedownLocation?.type !== "battlefield") return null;
    const battlefieldId = object.facedownLocation.id;
    const zone = this.hidden.zones.get(battlefieldId);
    const card = zone?.cards.get(refKey(object.ref));
    if (card === undefined) return null;
    return { battlefieldId, location: object.facedownLocation, hiddenTurn: card.hiddenTurn };
  }

  private moveLocation(ref: ObjectRef, location: LocationRef): ActionOutcome { const object = this.requireObject(ref); object.location = location; return this.done(objectRef(object)); }
  private setExhausted(ref: ObjectRef, exhausted: boolean): ActionOutcome { const object = this.requireObject(ref); object.exhausted = exhausted; return this.done(); }

  private createToken(player: PlayerId, token: TokenSpec, to: "board" | "chain" | "legend", location?: LocationRef): ActionOutcome {
    if (to !== "legend" && token.championLegend === true) return this.prevented();
    if ((to === "legend") !== token.types.some(type => type.toLowerCase() === "legend")) return this.prevented();
    const id = `token:${this.nextToken++}`;
    const ref = this.addCard(player, { id, cardId: token.cardId, name: token.name, types: token.types, tags: token.tags, keywords: token.keywords, might: token.might, energy: token.energy, power: token.power }, to);
    const object = this.objectMap.get(id)!; object.isToken = true; object.faceDown = false; object.location = to === "legend" || to === "chain" ? null : location ?? null;
    if (to === "legend" && token.championLegend === true) {
      object.championLegend = true;
      this.championLegends.add(refKey(ref));
    }
    return this.done(ref);
  }

  private draw(playerId: PlayerId, amount: number): ActionOutcome {
    if (!validCount(amount)) return this.impossible(); const player = this.requirePlayer(playerId); let drawn = 0;
    while (drawn < amount && player.zones.deck.length) { this.move({ id: player.zones.deck[0]!, zoneEntryId: this.objectMap.get(player.zones.deck[0]!)!.ref.zoneEntryId }, "hand"); drawn++; }
    return this.done(drawn);
  }

  private mill(playerId: PlayerId, amount: number): ActionOutcome {
    if (!validCount(amount)) return this.impossible(); const player = this.requirePlayer(playerId); let moved = 0;
    while (moved < amount && player.zones.deck.length) { const id = player.zones.deck[0]!; this.move({ id, zoneEntryId: this.objectMap.get(id)!.ref.zoneEntryId }, "trash"); moved++; }
    return this.done(moved);
  }

  private shuffle(playerId: PlayerId, zone: "deck" | "rune-deck"): ActionOutcome {
    const values = this.requirePlayer(playerId).zones[zone];
    for (let index = values.length - 1; index > 0; index--) { const swap = (index * 1103515245 + 12345) % (index + 1); [values[index], values[swap]] = [values[swap]!, values[index]!]; }
    return this.done();
  }

  private orderTop(playerId: PlayerId, refs: readonly ObjectRef[], zone: "deck" | "rune-deck"): ActionOutcome {
    const player = this.requirePlayer(playerId), selected = refs.map(ref => this.requireObject(ref).ref.id);
    if (selected.some(id => !player.zones[zone].includes(id))) return this.impossible();
    player.zones[zone] = [...selected, ...player.zones[zone].filter(id => !selected.includes(id))]; return this.done();
  }

  private channel(playerId: PlayerId, amount: number, exhausted: boolean): ActionOutcome {
    if (!validCount(amount)) return this.impossible(); const player = this.requirePlayer(playerId); let moved = 0;
    while (moved < amount && player.zones["rune-deck"].length) { const id = player.zones["rune-deck"][0]!; this.move({ id, zoneEntryId: this.objectMap.get(id)!.ref.zoneEntryId }, "rune-zone"); this.objectMap.get(id)!.exhausted = exhausted; moved++; }
    return this.done(moved);
  }

  private pay(playerId: PlayerId, plan: FinalizedCostPlan): ActionOutcome {
    const player = this.requirePlayer(playerId);
    if (plan.finalized !== true) return this.prevented();
    const energy = plan.energy ?? 0;
    const xp = plan.xp ?? 0;
    if (!validCount(energy) || !validCount(xp) || player.energy < energy || player.xp < xp) return this.prevented();

    const power = plan.power ?? [];
    if (!Array.isArray(power) || power.some(domain => !KNOWN_DOMAINS.has(domain))) return this.prevented();
    const universalPower = plan.universalPower ?? 0;
    if (!validCount(universalPower)) return this.prevented();
    const powerRequired = new Map<Domain, number>();
    for (const domain of power) powerRequired.set(domain, (powerRequired.get(domain) ?? 0) + 1);
    // `power` is the concrete named-Domain debit emitted by the payment
    // allocator; `universalPower` is the separate Universal debit. The host
    // checks both inventories against the final chosen source mix.
    const powerSources = plan.powerSources ?? [];
    if (!Array.isArray(powerSources)) return this.prevented();
    const explicitPowerSources = plan.powerSources !== undefined;
    const assigned = new Map<PowerPaymentSource, number>();
    for (const entry of powerSources) {
      if (entry === null || typeof entry !== "object" ||
          (!KNOWN_DOMAINS.has(entry.source as Domain) && !["universal", "any", "universal-power"].includes(entry.source)) ||
          !validCount(entry.amount) || entry.amount === 0) return this.prevented();
      assigned.set(entry.source, (assigned.get(entry.source) ?? 0) + entry.amount);
    }
    if (explicitPowerSources && (assigned.get("universal") ?? 0) + (assigned.get("any") ?? 0) +
        (assigned.get("universal-power") ?? 0) !== universalPower) return this.prevented();
    for (const [domain, amount] of powerRequired) {
      if (explicitPowerSources && (assigned.get(domain) ?? 0) !== amount) return this.prevented();
      if (player.power.filter(value => value === domain).length < amount) return this.prevented();
    }
    const universalAvailable = player.power.filter(value =>
      value === "universal" || value === "any" || value === "universal-power").length;
    if (universalAvailable < universalPower) return this.prevented();
    if (explicitPowerSources && [...assigned].some(([source, amount]) =>
      source === "universal" || source === "any" || source === "universal-power"
        ? false
        : (powerRequired.get(source as Domain) ?? 0) !== amount)) return this.prevented();

    const exhaust = plan.exhaust ?? [];
    const recycle = plan.recycle ?? [];
    if (!Array.isArray(exhaust) || !Array.isArray(recycle)) return this.prevented();
    const refs = [...exhaust, ...recycle];
    const seen = new Set<string>();
    for (const ref of refs) {
      if (ref === null || typeof ref !== "object" || typeof ref.id !== "string" || !validCount(ref.zoneEntryId) ||
          seen.has(refKey(ref))) return this.prevented();
      seen.add(refKey(ref));
      if (this.object(ref) === null) return this.prevented();
    }

    // Validation is complete before the first mutation. Keep the checkpoint
    // even though every checked operation below is deterministic, so a future
    // failure cannot leak an energy/XP or object transition.
    const checkpoint = this.checkpoint();
    try {
      player.energy -= energy;
      player.xp -= xp;
      let remainingUniversal = universalPower;
      for (let index = player.power.length - 1; index >= 0 && remainingUniversal > 0; index--) {
        const source = player.power[index];
        if (source !== "universal" && source !== "any" && source !== "universal-power") continue;
        player.power.splice(index, 1);
        remainingUniversal--;
      }
      if (remainingUniversal !== 0) throw new Error("Universal Power payment lost during commit");
      for (const [domain, amount] of powerRequired) {
        let remaining = amount;
        for (let index = player.power.length - 1; index >= 0 && remaining > 0; index--) {
          if (player.power[index] !== domain) continue;
          player.power.splice(index, 1);
          remaining--;
        }
        if (remaining !== 0) throw new Error(`Power payment lost ${domain} during commit`);
      }
      for (const ref of exhaust) this.setExhausted(ref, true);
      for (const ref of recycle) this.move(ref, "deck-bottom");
      return this.done();
    } catch (error) {
      this.restore(checkpoint);
      return this.prevented();
    }
  }
}

function matchesFilter(object: ObjectSnapshot, filter: ObjectFilter): boolean {
  const candidate = filter as Record<string, unknown>;
  for (const key of ["zone", "type", "owner", "controller"] as const) {
    const value = candidate[key]; if (value === undefined || value === "any") continue;
    const actual = key === "type" ? object.types : object[key];
    const wanted = Array.isArray(value) ? value : [value];
    if (Array.isArray(actual) ? !wanted.some(entry => actual.includes(entry as never)) : !wanted.includes(actual as never)) return false;
  }
  return true;
}

function evaluateExpression(expression: unknown, source: ObjectSnapshot, links: Map<string, unknown>): unknown {
  if (!expression || typeof expression !== "object") return expression;
  const value = expression as Record<string, unknown>;
  if (value.kind === "constant" || value.kind === "literal") return value.value;
  if ((value.kind === "linked" || value.kind === "linked-value") && typeof value.key === "string") return links.get(value.key);
  if (value.kind === "object-property" && value.object === "self" && typeof value.property === "string") return source[value.property as keyof ObjectSnapshot];
  return null;
}
