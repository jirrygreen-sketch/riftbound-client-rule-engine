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
  ZoneDestination,
  ZoneId,
} from "../../../../packages/engine-core/dist/effects/contract.js";

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
}

type MutableObject = {
  -readonly [K in keyof ObjectSnapshot]: ObjectSnapshot[K];
} & { counters: Record<string, number> };

type RuntimeZone = ZoneId | "base" | "battlefield" | "champion" | "legend";

type MutablePlayer = {
  id: PlayerId;
  name: string;
  energy: number;
  power: Domain[];
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

const clone = <T>(value: T): T => structuredClone(value);
const refKey = (ref: ObjectRef): string => `${ref.id}:${ref.zoneEntryId ?? 0}`;

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
  private readonly lastKnown = new Map<string, ObjectSnapshot>();
  private nextToken = 1;
  private readonly grants: RuntimeVisibilityGrant[] = [];

  constructor(
    readonly seatNames: Readonly<Record<PlayerId, string>> = { A: "Player A", B: "Player B" },
    readonly choose: <T>(request: ChoiceRequest<T>) => T,
  ) {
    for (const id of Object.keys(seatNames)) {
      this.players.set(id, { id, name: seatNames[id]!, energy: 0, power: [], xp: 0, score: 0, zones: emptyZones() });
    }
  }

  addPlayer(id: PlayerId, name = id): void {
    if (!this.players.has(id)) this.players.set(id, { id, name, energy: 0, power: [], xp: 0, score: 0, zones: emptyZones() });
  }

  addCard(player: PlayerId, card: RuntimeCard, zone: ZoneId): ObjectRef {
    if (!this.players.has(player)) throw new Error(`Unknown player ${player}`);
    const id = card.id;
    if (this.objectMap.has(id)) throw new Error(`Duplicate card instance ${id}`);
    const object: MutableObject = {
      ref: { id, zoneEntryId: 1 }, cardId: card.cardId ?? card.id, name: card.name ?? card.id,
      types: [...(card.types ?? [zone === "rune-deck" ? "rune" : "unit"])], tags: [...(card.tags ?? [])],
      keywords: [...(card.keywords ?? [])], owner: player, controller: player, zone, location: null,
      combatRole: null, might: card.might === undefined ? 1 : card.might,
      energy: card.energy === undefined ? null : card.energy,
      power: card.power == null ? null : [...card.power], exhausted: false, damage: 0,
      stunned: false, buffs: 0, attachedTo: null, faceDown: zone === "deck" || zone === "rune-deck", isToken: false,
      counters: {},
    };
    this.objectMap.set(id, object);
    this.players.get(player)!.zones[zone].push(id);
    return objectRef(object);
  }

  checkpoint(): RuntimeHostCheckpoint {
    return {
      objects: clone([...this.objectMap.values()]), players: clone([...this.players.values()]),
      lastKnown: clone([...this.lastKnown.entries()]), nextToken: this.nextToken, visibility: clone(this.grants),
    };
  }

  restore(checkpoint: unknown): void {
    const saved = checkpoint as RuntimeHostCheckpoint;
    this.objectMap.clear(); this.players.clear(); this.lastKnown.clear(); this.grants.splice(0);
    for (const object of clone(saved.objects)) this.objectMap.set(object.ref.id, object);
    for (const player of clone(saved.players)) this.players.set(player.id, player);
    for (const [key, object] of clone(saved.lastKnown)) this.lastKnown.set(key, object);
    this.nextToken = saved.nextToken;
    this.grants.push(...clone(saved.visibility));
  }

  objects(): readonly ObjectSnapshot[] {
    return clone([...this.objectMap.values()]).map(object => ({ ...object, counters: clone(object.counters) }));
  }

  object(ref: ObjectRef): ObjectSnapshot | null {
    const object = this.objectMap.get(ref.id);
    return object && object.ref.zoneEntryId === ref.zoneEntryId ? clone(object) : null;
  }

  lastKnownObject(ref: ObjectRef): ObjectSnapshot {
    return clone(this.lastKnown.get(refKey(ref)) ?? this.objectMap.get(ref.id) ?? {
      ref, cardId: null, name: "Unknown", types: [], tags: [], keywords: [], owner: "unknown",
      controller: "unknown", zone: "chain", location: null, combatRole: null, might: null, energy: null,
      power: null, exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: true, isToken: true,
    });
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

  zoneObjects(player: PlayerId, zone: ZoneId | string): readonly ObjectSnapshot[] {
    if (Object.hasOwn(emptyZones(), zone)) {
      const ids = this.players.get(player)?.zones[zone as ZoneId] ?? [];
      return ids.map(id => this.objectMap.get(id)).filter((object): object is MutableObject => object !== undefined).map(clone);
    }
    return [...this.objectMap.values()].filter(object => object.owner === player && object.zone === zone).map(clone);
  }

  visibility(): readonly RuntimeVisibilityGrant[] { return clone(this.grants); }

  perform(action: GameAction): ActionOutcome {
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
        case "channel-rune": return this.channel(action.player, action.amount, action.exhausted ?? true);
        case "gain-energy": { const player = this.requirePlayer(action.player); player.energy += action.amount; return this.done(action.amount); }
        case "gain-power": { const player = this.requirePlayer(action.player); player.power.push(...action.power); return this.done(action.power); }
        case "pay": return this.pay(action.player, action.plan);
        case "gain-xp": { const player = this.requirePlayer(action.player); player.xp += action.amount; return this.done(action.amount); }
        case "spend-xp": { const player = this.requirePlayer(action.player); if (player.xp < action.amount) return this.prevented(); player.xp -= action.amount; return this.done(action.amount); }
        case "buff": { const object = this.requireObject(action.object); object.buffs += action.amount; return this.done(object.buffs); }
        case "spend-buff": { const object = this.requireObject(action.object); if (object.buffs < action.amount) return this.prevented(); object.buffs -= action.amount; return this.done(object.buffs); }
        case "empower": { const object = this.requireObject(action.object); object.buffs += action.amount ?? 1; return this.done(object.buffs); }
        case "disempower": this.requireObject(action.object).buffs = 0; return this.done();
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
        case "play": return this.impossible();
        case "counter": return this.impossible();
      }
      return this.impossible();
    } catch {
      return this.impossible();
    }
  }

  context(source: ObjectSnapshot, controller: PlayerId, timingPoint: ResolveContext["timingPoint"]): ResolveContext {
    const links = new Map<string, unknown>();
    return {
      source, controller, timingPoint,
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
    this.removeFromZone(object); this.lastKnown.set(refKey(object.ref), clone(object));
    object.zone = target.zone; object.location = location ?? null; object.ref = { id: object.ref.id, zoneEntryId: (object.ref.zoneEntryId ?? 0) + 1 };
    object.faceDown = target.zone === "deck" || target.zone === "rune-deck";
    const zone = player.zones[target.zone] ?? (player.zones[target.zone] = []);
    if (target.bottom) zone.push(object.ref.id); else zone.unshift(object.ref.id);
    return this.done(objectRef(object));
  }

  private moveLocation(ref: ObjectRef, location: LocationRef): ActionOutcome { const object = this.requireObject(ref); object.location = location; return this.done(objectRef(object)); }
  private setExhausted(ref: ObjectRef, exhausted: boolean): ActionOutcome { const object = this.requireObject(ref); object.exhausted = exhausted; return this.done(); }

  private createToken(player: PlayerId, token: TokenSpec, to: "board" | "chain", location?: LocationRef): ActionOutcome {
    const id = `token:${this.nextToken++}`;
    const ref = this.addCard(player, { id, cardId: token.cardId, name: token.name, types: token.types, tags: token.tags, keywords: token.keywords, might: token.might, energy: token.energy, power: token.power }, to === "chain" ? "chain" : "board");
    const object = this.objectMap.get(id)!; object.isToken = true; object.faceDown = false; object.location = location ?? null;
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

  private pay(playerId: PlayerId, plan: { readonly finalized: true; readonly energy?: number; readonly xp?: number; readonly exhaust?: readonly ObjectRef[]; readonly recycle?: readonly ObjectRef[] }): ActionOutcome {
    const player = this.requirePlayer(playerId), energy = plan.energy ?? 0, xp = plan.xp ?? 0;
    if (player.energy < energy || player.xp < xp) return this.prevented();
    player.energy -= energy; player.xp -= xp;
    for (const ref of plan.exhaust ?? []) this.setExhausted(ref, true);
    for (const ref of plan.recycle ?? []) this.move(ref, "deck-bottom");
    return this.done();
  }
}

function matchesFilter(object: ObjectSnapshot, filter: ObjectFilter): boolean {
  const candidate = filter as Record<string, unknown>;
  for (const key of ["zone", "type", "owner", "controller"] as const) {
    const value = candidate[key]; if (value === undefined || value === "any") continue;
    const actual = key === "type" ? object.types : object[key];
    if (Array.isArray(actual) ? !actual.includes(value as never) : actual !== value) return false;
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
