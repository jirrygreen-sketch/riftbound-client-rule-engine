import type { GameEvent } from "@riftbound/protocol";
import type { Condition, Expr, Instruction, ObjectFilter, ObjectRef, Value } from "@riftbound/card-dsl";
import {
  AwaitChoice,
  type ActionOutcome,
  type ChoiceRequest,
  type ContinuousEffectSpec,
  type Domain,
  type Duration,
  type GameAction,
  type HistoryQuery,
  type InstructionResult,
  type LocationRef,
  type ObjectSnapshot,
  type PlayerId,
  type PlayerSnapshot,
  type ResolveContext,
  type TokenSpec,
  type TriggerSpec,
  type ZoneDestination,
  type ZoneId
} from "../contract.js";
import { isTimingPointId, type TimingPointId } from "../../events/timing-points.js";

export { AwaitChoice } from "../contract.js";

export type TestEvent = GameEvent & { readonly timingPoint: TimingPointId; readonly action: GameAction["type"] };
export type ReplacementHook = (action: GameAction, world: TestWorld) => "replaced" | "prevented" | "impossible" | null;

type MutableObject = { -readonly [Key in keyof ObjectSnapshot]: ObjectSnapshot[Key] } & {
  counters: Map<string, number>;
  empowered: number;
  copiedFrom?: ObjectRef;
};
interface MutablePlayer {
  id: PlayerId;
  energy: number;
  power: Domain[];
  runes: string[];
  xp: number;
  score: number;
  zones: Record<ZoneId, string[]>;
}
interface WorldState {
  objects: Map<string, MutableObject>;
  players: Map<PlayerId, MutablePlayer>;
  lastKnown: Map<string, ObjectSnapshot>;
  events: TestEvent[];
  history: Array<{ action: GameAction; timingPoint: TimingPointId; turn: number; combat: number }>;
  continuous: Array<{ effect: ContinuousEffectSpec; duration: Duration }>;
  delayed: Array<{ at: TriggerSpec; body: readonly Instruction[] }>;
  replacements: ReplacementHook[];
  sequence: number;
  nextToken: number;
  randomState: number;
}

const ZONES: readonly ZoneId[] = ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"];
function emptyZones(): Record<ZoneId, string[]> { return { hand: [], deck: [], "rune-deck": [], trash: [], banishment: [], board: [], "rune-zone": [], chain: [] }; }
const cloneRef = (ref: ObjectRef): ObjectRef => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });
const refKey = (ref: ObjectRef): string => `${ref.id}:${ref.zoneEntryId}`;
const copySnapshot = (snapshot: ObjectSnapshot): ObjectSnapshot => structuredClone(snapshot);
const asValue = (value: unknown): Value => value as Value;

function makeEvent(state: WorldState, action: GameAction["type"], timingPoint: TimingPointId, details: Record<string, unknown> = {}): TestEvent {
  const event = {
    type: "task-resolved",
    seq: ++state.sequence,
    turnNumber: 1,
    activePlayerId: "A",
    taskId: `effect:${action}:${state.sequence}`,
    sourceCardId: "test-kernel",
    reason: action,
    autoResolved: true,
    timingPoint,
    action,
    ...details
  } as TestEvent;
  state.events.push(event);
  return event;
}

function defaultObject(id: string, owner: PlayerId, values: Partial<ObjectSnapshot> = {}): MutableObject {
  const ref = values.ref ?? { id, zoneEntryId: 1 };
  return {
    ref,
    cardId: values.cardId === undefined ? `card:${id}` : values.cardId,
    name: values.name ?? id,
    types: values.types ?? ["unit"],
    tags: values.tags ?? [],
    keywords: values.keywords ?? [],
    owner: values.owner ?? owner,
    controller: values.controller ?? owner,
    zone: values.zone ?? "deck",
    location: values.location === undefined ? null : values.location,
    might: values.might ?? 1,
    energy: values.energy === undefined ? 1 : values.energy,
    power: values.power === undefined ? ["Fury"] : values.power,
    exhausted: values.exhausted ?? false,
    damage: values.damage ?? 0,
    stunned: values.stunned ?? false,
    buffs: values.buffs ?? 0,
    attachedTo: values.attachedTo ?? null,
    faceDown: values.faceDown ?? false,
    isToken: values.isToken ?? false,
    counters: new Map(),
    empowered: 0
  };
}

function freshState(seed: number): WorldState {
  const state: WorldState = {
    objects: new Map(),
    players: new Map(),
    lastKnown: new Map(),
    events: [],
    history: [],
    continuous: [],
    delayed: [],
    replacements: [],
    sequence: 0,
    nextToken: 1,
    randomState: seed >>> 0
  };
  for (const id of ["A", "B"]) state.players.set(id, { id, energy: 0, power: [], runes: [], xp: 0, score: 0, zones: emptyZones() });
  return state;
}

/** A deterministic in-memory ResolveContext implementation for primitive tests. */
export class TestWorld implements ResolveContext {
  private state: WorldState;
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly timingPoint: TimingPointId;
  private readonly targetSets: Map<string, ObjectRef[]>;
  private readonly pickSets: Map<string, readonly (ObjectRef | PlayerId | string)[]>;
  private answers: Map<string, unknown>;
  private readonly linkedValues: Map<string, Value>;

  constructor(options: { seed?: number; source?: ObjectRef; sourceSnapshot?: ObjectSnapshot; controller?: PlayerId; timingPoint?: TimingPointId; state?: WorldState; targets?: Map<string, ObjectRef[]>; picks?: Map<string, readonly (ObjectRef | PlayerId | string)[]>; answers?: Map<string, unknown>; linked?: Map<string, Value> } = {}) {
    this.state = options.state ?? freshState(options.seed ?? 0x52494654);
    this.controller = options.controller ?? "A";
    this.timingPoint = options.timingPoint ?? "main-start";
    this.targetSets = options.targets ?? new Map();
    this.pickSets = options.picks ?? new Map();
    this.answers = options.answers ?? new Map();
    this.linkedValues = options.linked ?? new Map();
    const source = options.sourceSnapshot ?? (options.source ? this.object(options.source) : this.listObjects()[0]);
    this.source = source ?? defaultObject("source", this.controller);
  }

  static create(seed?: number): TestWorld { return new TestWorld({ seed }); }
  get events(): readonly TestEvent[] { return this.state.events; }
  get objects(): readonly ObjectSnapshot[] { return this.listObjects(); }
  get continuousEffects(): readonly { effect: ContinuousEffectSpec; duration: Duration }[] { return this.state.continuous; }
  get delayedTriggers(): readonly { at: TriggerSpec; body: readonly Instruction[] }[] { return this.state.delayed; }
  get randomState(): number { return this.state.randomState; }
  ref(id: string): ObjectRef { const object = this.state.objects.get(id); if (!object) throw new Error(`Unknown object ${id}`); return cloneRef(object.ref); }
  setAnswers(answers: Record<string, unknown>): void { this.answers = new Map(Object.entries(answers)); }
  setTargets(id: string, refs: readonly ObjectRef[]): void { this.targetSets.set(id, refs.map(cloneRef)); }
  setPicks(id: string, picks: readonly (ObjectRef | PlayerId | string)[]): void { this.pickSets.set(id, picks.map(pick => typeof pick === "object" ? cloneRef(pick) : pick)); }
  addReplacement(hook: ReplacementHook): void { this.state.replacements.push(hook); }
  registerReplacement(hook: ReplacementHook): void { this.addReplacement(hook); }
  addObject(object: ObjectSnapshot, zone?: ZoneId): ObjectRef {
    const mutable = defaultObject(object.ref.id, object.owner, { ...object, zone: zone ?? object.zone });
    this.removeFromZones(mutable.ref.id);
    this.state.objects.set(mutable.ref.id, mutable);
    this.putInZone(mutable, mutable.zone);
    return cloneRef(mutable.ref);
  }
  addPlayer(id: PlayerId, values: Partial<Pick<MutablePlayer, "energy" | "power" | "xp" | "score">> = {}): void { if (!this.state.players.has(id)) this.state.players.set(id, { id, energy: 0, power: [], runes: [], xp: 0, score: 0, zones: emptyZones() }); const player = this.state.players.get(id)!; Object.assign(player, values); }
  playerIds(): readonly PlayerId[] { return [...this.state.players.keys()]; }
  objectsInZone(player: PlayerId, zone: ZoneId): ObjectRef[] { return (this.state.players.get(player)?.zones[zone] ?? []).map(id => cloneRef(this.state.objects.get(id)!.ref)); }
  zone(player: PlayerId, zone: ZoneId): readonly ObjectRef[] { return this.objectsInZone(player, zone); }
  getObject(id: string): ObjectSnapshot | null { const object = this.state.objects.get(id); return object ? copySnapshot(object) : null; }
  stateForTest(): unknown { return structuredClone({ objects: [...this.state.objects.values()].map(object => ({ ...object, counters: [...object.counters] })), players: [...this.state.players.values()].map(player => ({ ...player, zones: structuredClone(player.zones) })), events: this.state.events, history: this.state.history }); }

  object(ref: ObjectRef): ObjectSnapshot | null { const object = this.state.objects.get(ref.id); return object && object.ref.zoneEntryId === ref.zoneEntryId ? copySnapshot(object) : null; }
  lastKnown(ref: ObjectRef): ObjectSnapshot { const found = this.state.lastKnown.get(refKey(ref)); if (found) return copySnapshot(found); const current = this.state.objects.get(ref.id); if (current) return copySnapshot(current); return defaultObject(ref.id, this.controller, { ref }); }
  query(filter: ObjectFilter): ObjectSnapshot[] { return this.listObjects().filter(object => matchesFilter(object, filter)); }
  zoneSlice(player: PlayerId, zone: ZoneId, from: "top" | "bottom", count?: number): ObjectSnapshot[] {
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
      throw new RangeError("zoneSlice count must be a nonnegative safe integer");
    }
    const owner = this.state.players.get(player);
    if (!owner) throw new Error(`Unknown player ${player}`);
    const ordered = owner.zones[zone];
    const length = Math.min(count ?? ordered.length, ordered.length);
    const start = from === "top" ? 0 : ordered.length - length;
    return ordered.slice(start, start + length).map(id => copySnapshot(this.state.objects.get(id)!));
  }
  targets(specId: string): ObjectRef[] { return (this.targetSets.get(specId) ?? []).map(cloneRef); }
  picks(specId: string): readonly (ObjectRef | PlayerId | string)[] { return (this.pickSets.get(specId) ?? []).map(pick => typeof pick === "object" ? cloneRef(pick) : pick); }
  player(id: PlayerId): PlayerSnapshot { const player = this.state.players.get(id); if (!player) throw new Error(`Unknown player ${id}`); const runePool = this.objectsInZone(id, "rune-zone"); return { id, energy: player.energy, power: [...player.power], runePool, runes: runePool, xp: player.xp, score: player.score, handSize: player.zones.hand.length, handCount: player.zones.hand.length, deckSize: player.zones.deck.length, deckCount: player.zones.deck.length, runeDeckSize: player.zones["rune-deck"].length, runeDeckCount: player.zones["rune-deck"].length }; }
  evaluate(expr: Expr): Value { if (expr.kind === "constant" || expr.kind === "literal") return expr.value; if (expr.kind === "linked" || expr.kind === "linked-value") return this.linkedValues.get(expr.key ?? expr.instructionId) ?? null; if (expr.kind === "count") return this.query(expr.filter ?? {}).length; if (expr.kind === "object-property") return asValue(this.object(expr.object)?.[expr.property as keyof ObjectSnapshot] ?? null); if (expr.kind === "object-attribute") return asValue(this.object(expr.object)?.[expr.attribute as keyof ObjectSnapshot] ?? null); return null; }
  test(condition: Condition): boolean { switch (condition.kind) { case "always": return true; case "never": return false; case "expression": return Boolean(this.evaluate(condition.value)); case "not": return !this.test(condition.condition); case "all": return condition.conditions.every(item => this.test(item)); case "any": return condition.conditions.some(item => this.test(item)); case "compare": { const left = this.evaluate(condition.left) as any; const right = this.evaluate(condition.right) as any; switch (condition.operator) { case "eq": return left === right; case "ne": return left !== right; case "lt": return left < right; case "lte": return left <= right; case "gt": return left > right; case "gte": return left >= right; case "in": return Array.isArray(right) && right.includes(left); } } } }
  linked(key: string): Value | undefined { return this.linkedValues.get(key); }
  link(key: string, value: Value): void { this.linkedValues.set(key, value); }
  history(query: HistoryQuery): number { return this.state.history.filter(item => (!query.action || item.action.type === query.action) && (!query.timingPoint || item.timingPoint === query.timingPoint) && (!query.player || actionPlayer(item.action) === query.player) && (!query.object || actionObject(item.action) && refKey(actionObject(item.action)!) === refKey(query.object!))).length; }
  choose<T>(request: ChoiceRequest<T>): T { if (!this.answers.has(request.id)) throw new AwaitChoice(request); return this.answers.get(request.id) as T; }
  addContinuous(effect: ContinuousEffectSpec, duration: Duration): void { this.state.continuous.push({ effect, duration }); }
  registerDelayedTrigger(at: TriggerSpec, body: readonly Instruction[]): void { this.state.delayed.push({ at, body }); }

  perform(action: GameAction): ActionOutcome {
    const replacement = this.state.replacements.map(hook => hook(action, this)).find(result => result !== null);
    if (replacement) return { status: replacement, events: [makeEvent(this.state, action.type, this.timingPoint, { outcome: replacement })] };
    const outcome = this.apply(action);
    if (outcome.status === "done") this.state.history.push({ action, timingPoint: this.timingPoint, turn: 1, combat: 0 });
    return outcome;
  }

  private apply(action: GameAction): ActionOutcome {
    const fail = (status: "impossible" | "prevented" = "impossible"): ActionOutcome => ({ status, events: [makeEvent(this.state, action.type, this.timingPoint, { outcome: status })] });
    const done = (result?: Value, details?: Record<string, unknown>): ActionOutcome => ({ status: "done", events: [makeEvent(this.state, action.type, this.timingPoint, details)], ...(result === undefined ? {} : { result }) });
    switch (action.type) {
      case "draw": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); const count = Math.min(action.amount, player.zones.deck.length); for (let index = 0; index < count; index++) { const topId = player.zones.deck[0]; if (!topId) break; this.moveCurrent(this.state.objects.get(topId)!, "hand"); } return done(count as Value); }
      case "mill": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); const count = Math.min(action.amount, player.zones.deck.length); for (let index = 0; index < count; index++) { const topId = player.zones.deck[0]; if (!topId) break; this.moveCurrent(this.state.objects.get(topId)!, "trash"); } return done(count as Value); }
      case "shuffle": { const player = this.state.players.get(action.player); const zone: "deck" | "rune-deck" = action.zone ?? "deck"; if (!player) return fail(); const cards = player.zones[zone]; for (let index = cards.length - 1; index > 0; index--) { const random = this.nextRandom(); const swap = random % (index + 1); [cards[index], cards[swap]] = [cards[swap]!, cards[index]!]; } return done(); }
      case "order-top": {
        const player = this.state.players.get(action.player);
        const zone = action.zone ?? "deck";
        const selected = new Set(action.objects.map(ref => ref.id));
        if (!player || selected.size !== action.objects.length || action.objects.some(ref =>
          !this.valid(ref) || this.state.objects.get(ref.id)!.zone !== zone || !player.zones[zone].includes(ref.id)
        )) return fail();
        player.zones[zone] = [...action.objects.map(ref => ref.id), ...player.zones[zone].filter(id => !selected.has(id))];
        return done();
      }
      case "discard": return this.moveAction(action.object, "trash", done, fail);
      case "recycle": {
        const object = this.current(action.object);
        if (!object) return fail();
        return this.moveAction(action.object, object.types.includes("rune") ? "rune-deck" : "deck-bottom", done, fail, undefined, true);
      }
      case "banish": return this.moveAction(action.object, "banishment", done, fail);
      case "return-to-hand": return this.moveAction(action.object, "hand", done, fail);
      case "move-zone": return this.moveAction(action.object, action.to, done, fail, action.location);
      case "move-location": { const object = this.current(action.object); if (!object || object.zone !== "board") return fail(); object.location = action.to; return done(); }
      case "ready": case "exhaust": { const object = this.current(action.object); if (!object) return fail(); object.exhausted = action.type === "exhaust"; return done(); }
      case "stun": { const object = this.current(action.object); if (!object) return fail(); object.stunned = true; return done(); }
      case "kill": return this.moveAction(action.object, "trash", done, fail);
      case "attach": { const object = this.current(action.object); const host = this.current(action.host); if (!object || !host || object.types.includes("unit") || !host.types.includes("unit") || object.zone !== "board" || host.zone !== "board") return fail("prevented"); object.attachedTo = cloneRef(host.ref); return done(); }
      case "detach": { const object = this.current(action.object); if (!object) return fail(); object.attachedTo = null; return done(); }
      case "take-control": { const object = this.current(action.object); if (!object || !this.state.players.has(action.player)) return fail(); object.controller = action.player; return done(); }
      case "damage": { const target = this.current(action.target); if (!target || action.amount < 0) return fail(); target.damage += action.amount; return done(action.amount as Value); }
      case "heal": { const object = this.current(action.object); if (!object || action.amount < 0) return fail(); const healed = Math.min(action.amount, object.damage); object.damage -= healed; return done(healed as Value); }
      case "channel-rune": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); const count = Math.min(action.amount, player.zones["rune-deck"].length); for (let index = 0; index < count; index++) { const topId = player.zones["rune-deck"][0]; if (!topId) break; this.moveCurrent(this.state.objects.get(topId)!, "rune-zone"); } return done(count as Value); }
      case "gain-energy": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); player.energy += action.amount; return done(action.amount as Value); }
      case "gain-power": { const player = this.state.players.get(action.player); if (!player) return fail(); player.power.push(...action.power); return done(action.power as unknown as Value); }
      case "pay": { const player = this.state.players.get(action.player); if (!player || !action.plan.finalized) return fail(); const energy = action.plan.energy ?? 0; const xp = action.plan.xp ?? 0; if (player.energy < energy || player.xp < xp) return fail("prevented"); player.energy -= energy; player.xp -= xp; return done(); }
      case "gain-xp": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); player.xp += action.amount; return done(action.amount as Value); }
      case "spend-xp": { const player = this.state.players.get(action.player); if (!player || action.amount < 0 || player.xp < action.amount) return fail("prevented"); player.xp -= action.amount; return done(action.amount as Value); }
      case "buff": case "spend-buff": { const object = this.current(action.object); if (!object || action.amount < 0 || (action.type === "spend-buff" && object.buffs < action.amount)) return fail("prevented"); object.buffs += action.type === "buff" ? action.amount : -action.amount; return done(object.buffs as Value); }
      case "empower": { const object = this.current(action.object); if (!object) return fail(); const amount = action.amount ?? 1; object.empowered += amount; return done(object.empowered as Value); }
      case "disempower": { const object = this.current(action.object); if (!object) return fail(); object.empowered = 0; return done(); }
      case "add-counter": case "remove-counter": { const object = this.current(action.object); if (!object || action.amount < 0) return fail(); const prior = object.counters.get(action.counter) ?? 0; const next = action.type === "add-counter" ? prior + action.amount : Math.max(0, prior - action.amount); object.counters.set(action.counter, next); return done(next as Value); }
      case "create-token": { const player = this.state.players.get(action.player); if (!player) return fail(); const id = `token-${this.state.nextToken++}`; const ref = this.addObject(defaultObject(id, action.player, { ...action.token, ref: { id, zoneEntryId: 1 }, zone: "board", location: action.location, isToken: true }), "board"); return done(ref as unknown as Value, { objectId: id }); }
      case "copy": { const source = this.current(action.source); if (!source) return fail(); const id = `copy-${this.state.nextToken++}`; const ref = this.addObject({ ...source, ref: { id, zoneEntryId: 1 }, owner: action.player, controller: action.player, location: action.location, zone: "board", isToken: true }, "board"); return done(ref as unknown as Value, { objectId: id }); }
      case "play": { const object = this.current(action.object); if (!object) return fail(); if (action.cost) { const payment = this.apply({ type: "pay", player: action.player, plan: action.cost }); if (payment.status !== "done") return payment; } if (action.location) object.location = action.location; return this.moveAction(action.object, "board", done, fail, action.location); }
      case "reveal": case "look": case "show-off": { const ref = action.type === "look" ? action.objects[0] : action.object; return ref && this.current(ref) ? done() : fail(); }
      case "counter": return this.current(action.object) ? this.moveAction(action.object, "trash", done, fail) : fail("prevented");
      case "score": { const player = this.state.players.get(action.player); if (!player || action.amount < 0) return fail(); player.score += action.amount; return done(action.amount as Value); }
      case "win": return this.state.players.has(action.player) ? done(action.player) : fail();
    }
  }

  private moveAction(ref: ObjectRef, destination: ZoneDestination | "board", done: (result?: Value, details?: Record<string, unknown>) => ActionOutcome, fail: (status?: "impossible" | "prevented") => ActionOutcome, location?: LocationRef, bottom = destination === "deck-bottom"): ActionOutcome {
    const object = this.current(ref);
    if (!object) return fail();
    this.moveCurrent(object, destination, location, bottom);
    return done();
  }
  private moveCurrent(object: MutableObject, destination: ZoneDestination | "board", location?: LocationRef, bottom = destination === "deck-bottom"): void {
    const oldRef = cloneRef(object.ref);
    this.state.lastKnown.set(refKey(oldRef), copySnapshot(object));
    this.removeFromZones(object.ref.id);
    object.ref = { id: object.ref.id, zoneEntryId: object.ref.zoneEntryId + 1 };
    object.location = location ?? (destination === "base" ? { type: "base", player: object.controller } : destination === "battlefield" ? { type: "battlefield", id: "battlefield-1" } : null);
    object.zone = destination === "deck-top" || destination === "deck-bottom" ? "deck" : destination === "rune-deck" ? "rune-deck" : destination === "rune-zone" ? "rune-zone" : destination === "banishment" ? "banishment" : destination === "hand" ? "hand" : destination === "trash" ? "trash" : destination === "chain" ? "chain" : "board";
    this.putInZone(object, object.zone, bottom);
  }
  private putInZone(object: MutableObject, zone: ZoneId, bottom = false): void {
    const player = this.state.players.get(object.owner);
    if (!player) return;
    const list = player.zones[zone];
    if ((zone === "deck" || zone === "rune-deck") && !bottom) list.unshift(object.ref.id);
    else list.push(object.ref.id);
  }
  private removeFromZones(id: string): void { for (const player of this.state.players.values()) for (const zone of ZONES) player.zones[zone] = player.zones[zone].filter(item => item !== id); }
  private valid(ref: ObjectRef): boolean { return this.current(ref) !== null; }
  private current(ref: ObjectRef): MutableObject | null { const object = this.state.objects.get(ref.id); return object && object.ref.zoneEntryId === ref.zoneEntryId ? object : null; }
  private listObjects(): ObjectSnapshot[] { return [...this.state.objects.values()].map(copySnapshot); }
  private nextRandom(): number { this.state.randomState = (this.state.randomState * 1664525 + 1013904223) >>> 0; return this.state.randomState; }
  snapshot(): WorldState {
    return {
      ...this.state,
      objects: new Map([...this.state.objects].map(([id, object]) => [id, { ...object, ref: cloneRef(object.ref), counters: new Map(object.counters) }])),
      players: new Map([...this.state.players].map(([id, player]) => [id, { ...player, power: [...player.power], runes: [...player.runes], zones: Object.fromEntries(ZONES.map(zone => [zone, [...player.zones[zone]]])) as Record<ZoneId, string[]> }])),
      lastKnown: new Map([...this.state.lastKnown].map(([key, value]) => [key, copySnapshot(value)])),
      events: [...this.state.events],
      history: [...this.state.history],
      continuous: [...this.state.continuous],
      delayed: [...this.state.delayed],
      replacements: [...this.state.replacements]
    };
  }
  linkedSnapshot(): Readonly<Record<string, Value>> { return Object.fromEntries(this.linkedValues.entries()); }
  copyLinkedFrom(other: TestWorld): void { this.linkedValues.clear(); for (const [key, value] of other.linkedValues) this.linkedValues.set(key, value); }
  restore(state: WorldState): void { this.state = state; }
  clone(options: Partial<ConstructorParameters<typeof TestWorld>[0]> = {}): TestWorld { return new TestWorld({ state: this.snapshot(), sourceSnapshot: copySnapshot(this.source), controller: this.controller, timingPoint: this.timingPoint, targets: new Map([...this.targetSets].map(([key, value]) => [key, value.map(cloneRef)])), picks: new Map(this.pickSets), answers: new Map(this.answers), linked: new Map(this.linkedValues), ...options }); }
}

function actionPlayer(action: GameAction): PlayerId | undefined { return "player" in action ? action.player : undefined; }
function actionObject(action: GameAction): ObjectRef | undefined { return "object" in action ? action.object : undefined; }
function matchesFilter(object: ObjectSnapshot, filter: ObjectFilter): boolean { const candidate = filter as Record<string, unknown>; for (const [key, expected] of Object.entries(candidate)) { if (key === "type" && !object.types.includes(String(expected))) return false; if (key === "types" && Array.isArray(expected) && !expected.every(type => object.types.includes(String(type)))) return false; if (key === "tag" && !object.tags.includes(String(expected))) return false; if (key === "tags" && Array.isArray(expected) && !expected.every(tag => object.tags.includes(String(tag)))) return false; if (key === "controller" && object.controller !== expected) return false; if (key === "owner" && object.owner !== expected) return false; if (key === "zone" && object.zone !== expected) return false; if (key === "location" && JSON.stringify(object.location) !== JSON.stringify(expected)) return false; } return true; }

/** Start a deterministic two-player test world. */
export function createTestWorld(seed?: number): TestWorld { return TestWorld.create(seed); }

/** Fluent builder for concise primitive tests. */
export class WorldBuilder {
  readonly kernel: TestWorld;
  constructor(seed?: number) { this.kernel = createTestWorld(seed); }
  player(id: PlayerId, values: Partial<Pick<MutablePlayer, "energy" | "power" | "xp" | "score">> = {}): this { this.kernel.addPlayer(id, values); return this; }
  unit(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { const owner = values.owner ?? "A"; this.kernel.addObject(defaultObject(id, owner, { ...values, types: values.types ?? ["unit"], zone: values.zone ?? "board", location: values.location ?? { type: "battlefield", id: "battlefield-1" } }), values.zone ?? "board"); return this; }
  battlefield(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { return this.unit(id, { ...values, location: values.location ?? { type: "battlefield", id: "battlefield-1" } }); }
  base(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { const owner = values.owner ?? "A"; this.kernel.addObject(defaultObject(id, owner, { ...values, types: values.types ?? ["unit"], zone: "board", location: values.location ?? { type: "base", player: owner } }), "board"); return this; }
  card(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { const owner = values.owner ?? "A"; this.kernel.addObject(defaultObject(id, owner, values), values.zone ?? "deck"); return this; }
  object(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { return this.card(id, values); }
  hand(id: string, values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this { return this.card(id, { ...values, zone: "hand" }); }
  /** An array adds a top-to-bottom block; a single id stacks one card on top. */
  deck(idOrIds: string | readonly string[], values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this {
    const ordered = typeof idOrIds === "string" ? [idOrIds] : idOrIds;
    for (let index = ordered.length - 1; index >= 0; index--) this.card(ordered[index]!, { ...values, zone: "deck" });
    return this;
  }
  /** Build a Rune Deck with the same top-to-bottom array form as deck(). */
  rune(idOrIds: string | readonly string[], values: Partial<ObjectSnapshot> & { owner?: PlayerId } = {}): this {
    const ordered = typeof idOrIds === "string" ? [idOrIds] : idOrIds;
    for (let index = ordered.length - 1; index >= 0; index--) this.card(ordered[index]!, { ...values, types: values.types ?? ["rune"], zone: "rune-deck" });
    return this;
  }
  build(): TestWorld { return this.kernel; }
}

/** Builder entry point: `world().player("A").unit("u1").build()`. */
export function world(seed?: number): WorldBuilder { return new WorldBuilder(seed); }

export function isAwaitChoice(value: unknown): value is AwaitChoice { return value instanceof AwaitChoice; }
export { TestWorld as ReferenceTestKernel };
export { isTimingPointId };
