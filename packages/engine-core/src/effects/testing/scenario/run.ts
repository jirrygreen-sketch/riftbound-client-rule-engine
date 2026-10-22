import type { CardProgram } from "@riftbound/card-dsl";
import type { ChoiceRequest, Domain, GameAction, ObjectRef, ObjectSnapshot, PlayerId, Value, ZoneId } from "../../contract.js";
import { AwaitChoice } from "../../contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../events/action-adapter.js";
import type { PipelineEvent, TimingEmission } from "../../../events/pipeline-types.js";
import { ChainEngine } from "../../../chain/engine.js";
import { createProgramBinding } from "../../../programs/index.js";
import type { ProgramSource } from "../../../programs/registry.js";
import { TestWorld, world } from "../test-kernel.js";
import type {
  CardScenario,
  CardScenarioResult,
  CardScenarioTemplateCase,
  CardScenarioTemplateRow,
  EventPattern,
  ScenarioChoiceValue,
  ScenarioEventExpectation,
  ScenarioObject,
  ScenarioObjectExpectation,
  ScenarioObjectState,
  ScenarioOperation,
  ScenarioState,
} from "./types.js";

export type {
  CardScenario,
  CardScenarioResult,
  CardScenarioTemplateCase,
  CardScenarioTemplateRow,
  EventPattern,
  ScenarioEventExpectation,
  ScenarioObject,
  ScenarioObjectExpectation,
  ScenarioObjectState,
  ScenarioOperation,
  ScenarioState,
};

type RawStateObject = Omit<ScenarioObjectState, "counters"> & {
  readonly counters: readonly (readonly [string, number])[];
};
type RawWorldState = { readonly objects: readonly RawStateObject[]; readonly players: readonly { readonly id: PlayerId }[] };

const DEFAULT_PLAYER_IDS = ["A", "B"] as const;
const DEFAULT_LOCATION: Extract<ObjectSnapshot["location"], { type: "battlefield" }> = { type: "battlefield", id: "battlefield-1" };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectRefFor(kernel: TestWorld, id: string): ObjectRef {
  return kernel.ref(id);
}

function objectConfig(object: ScenarioObject, owner: PlayerId, zone: ZoneId): Partial<ObjectSnapshot> & { owner: PlayerId } {
  return {
    owner,
    controller: object.controller ?? owner,
    cardId: object.cardId === undefined ? object.program?.canonicalCardId ?? null : object.cardId,
    name: object.name ?? object.id,
    types: object.types ?? ["unit"],
    tags: object.tags ?? [],
    keywords: object.keywords ?? [],
    zone,
    location: object.location === undefined
      ? (zone === "board" ? DEFAULT_LOCATION : null)
      : object.location,
    combatRole: object.combatRole ?? null,
    might: object.might === undefined ? 1 : object.might,
    energy: object.energy === undefined ? 0 : object.energy,
    power: object.power === undefined ? [] : object.power,
    exhausted: object.exhausted ?? false,
    damage: object.damage ?? 0,
    stunned: object.stunned ?? false,
    buffs: object.buffs ?? 0,
    attachedTo: object.attachedTo ?? null,
    faceDown: object.faceDown ?? false,
    isToken: object.isToken ?? false,
  };
}

function scenarioZoneMap(scenario: CardScenario): Map<string, { owner: PlayerId; zone: ZoneId; index: number }> {
  const result = new Map<string, { owner: PlayerId; zone: ZoneId; index: number }>();
  for (const [player, setup] of Object.entries(scenario.players ?? {})) {
    for (const [zone, ids] of Object.entries(setup.zones ?? {})) {
      if (!ids) continue;
      for (const [index, id] of ids.entries()) result.set(id, { owner: player, zone: zone as ZoneId, index });
    }
  }
  return result;
}

function makeWorld(scenario: CardScenario, program: CardProgram): { kernel: TestWorld; boardProgramIds: string[] } {
  const zones = scenarioZoneMap(scenario);
  const objects = scenario.objects ?? [];
  const byId = new Map(objects.map(object => [object.id, object] as const));
  for (const [id, entry] of zones) {
    if (!byId.has(id)) throw new Error(`Scenario zone references unknown object ${id}`);
    const object = byId.get(id)!;
    if (object.owner !== undefined && object.owner !== entry.owner) throw new Error(`Object ${id} owner disagrees with its zone owner`);
  }
  const builder = world(scenario.seed);
  const playerIds = new Set<PlayerId>([...DEFAULT_PLAYER_IDS, ...Object.keys(scenario.players ?? {})]);
  for (const id of playerIds) {
    const setup = scenario.players?.[id];
    builder.player(id, {
      energy: setup?.energy ?? 0,
      power: (setup?.power ?? []) as Domain[],
      xp: setup?.xp ?? 0,
      score: setup?.score ?? 0,
    });
  }
  const zoneObjects = new Map<ZoneId, ScenarioObject[]>();
  const boardProgramIds: string[] = [];
  for (const object of objects) {
    const zoneInfo = zones.get(object.id);
    const owner = object.owner ?? zoneInfo?.owner ?? "A";
    const zone = zoneInfo?.zone ?? object.zone ?? "deck";
    (zoneObjects.get(zone) ?? zoneObjects.set(zone, []).get(zone)!).push(Object.assign({}, object, { owner, zone }));
    // Setup objects predate lifecycle attachment. Board permanents and the
    // public Legend Zone are both live program sources (CR 107.4.c,
    // 174.2.b), so install either before scenario actions run. Entering the
    // Chain is only legal for card zones; a Legend starts in its own zone.
    if ((zone === "board" || zone === "legend") && object.cardId !== null &&
        (object.program || object.cardId === program.canonicalCardId)) boardProgramIds.push(object.id);
  }
  for (const [zone, entries] of zoneObjects) {
    const ordered = zone === "deck" || zone === "rune-deck" ? [...entries].reverse() : entries;
    for (const object of ordered) builder.object(object.id, objectConfig(object, object.owner ?? "A", zone));
  }
  // WorldBuilder defaults null Might to 1. Seed the declared null into the
  // initial world before creating the chain or executing any lifecycle/actions.
  const initial = builder.build();
  const state = initial.snapshot();
  for (const object of objects) {
    if (object.might !== null) continue;
    const configured = state.objects.get(object.id)!;
    state.objects.set(object.id, { ...configured, might: null });
  }
  return { kernel: new TestWorld({ state, sourceSnapshot: initial.source }), boardProgramIds };
}

function normalizeChoice(request: ChoiceRequest<unknown>, value: ScenarioChoiceValue, kernel: TestWorld): unknown {
  if (request.type === "select-objects" || request.type === "order") {
    if (!Array.isArray(value)) throw new TypeError(`Choice ${request.id} expects an object-reference array`);
    return value.map(item => {
      if (typeof item === "string") return objectRefFor(kernel, item);
      if (item && typeof item === "object" && "id" in item && "zoneEntryId" in item) return item as ObjectRef;
      throw new TypeError(`Choice ${request.id} contains an invalid object id`);
    });
  }
  return value;
}

function buildState(kernel: TestWorld, engine: ChainEngine): ScenarioState {
  const raw = kernel.stateForTest() as RawWorldState;
  engine.layers.setObjects(kernel.objects);
  const derived = new Map(engine.layers.evaluateAll().map(object => [object.ref.id, object] as const));
  const objects = raw.objects.map(object => {
    const counters = Object.fromEntries(object.counters);
    return { ...object, ...(derived.get(object.ref.id) ?? {}), counters, empowered: object.empowered } as ScenarioObjectState;
  });
  const players = Object.fromEntries(kernel.playerIds().map(id => [id, kernel.player(id)]));
  return { objects, players, priority: engine.priority, chain: engine.items };
}

function refAwareMatch(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return true;
  if (typeof expected === "string" && actual && typeof actual === "object" && "id" in actual) {
    return (actual as { id?: unknown }).id === expected;
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => refAwareMatch(item, actual[index]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(asRecord(expected)).every(([key, value]) => refAwareMatch(value, (actual as Record<string, unknown>)[key]));
  }
  return Object.is(expected, actual);
}

function eventMatches(pattern: EventPattern, event: PipelineEvent): boolean {
  return refAwareMatch(pattern, event);
}

function assertEvents(events: readonly PipelineEvent[], expected: ScenarioEventExpectation | readonly EventPattern[]): void {
  const requirement: ScenarioEventExpectation = Array.isArray(expected)
    ? { sequence: [...(expected as readonly EventPattern[])] }
    : expected as ScenarioEventExpectation;
  if (requirement.exact && (events.length !== requirement.exact.length || requirement.exact.some((pattern, index) => !eventMatches(pattern, events[index]!)))) {
    throw new Error(`Scenario event exact match failed.\nActual: ${JSON.stringify(events)}\nExpected: ${JSON.stringify(requirement.exact)}`);
  }
  if (requirement.includes) for (const pattern of requirement.includes) {
    if (!events.some(event => eventMatches(pattern, event))) throw new Error(`Scenario event include failed: ${JSON.stringify(pattern)}`);
  }
  if (requirement.sequence) {
    let index = 0;
    for (const pattern of requirement.sequence) {
      const found = events.findIndex((event, candidate) => candidate >= index && eventMatches(pattern, event));
      if (found < 0) throw new Error(`Scenario event subsequence failed at ${JSON.stringify(pattern)}.\nActual: ${JSON.stringify(events)}`);
      index = found + 1;
    }
  }
}

function assertObjectExpectation(actual: ScenarioObjectState | undefined, expected: ScenarioObjectExpectation, id: string): void {
  if (!actual) throw new Error(`Scenario expected object ${id}, but it does not exist`);
  const { ref, counters, empowered, ...rest } = expected;
  if (ref !== undefined && !refAwareMatch(ref, actual.ref)) throw new Error(`Scenario object ${id} ref mismatch`);
  if (counters !== undefined) {
    const expectedCounters = Array.isArray(counters) ? Object.fromEntries(counters) : counters;
    if (!refAwareMatch(expectedCounters, actual.counters)) throw new Error(`Scenario object ${id} counters mismatch`);
  }
  if (empowered !== undefined && actual.empowered !== empowered) throw new Error(`Scenario object ${id} empowered mismatch`);
  if (!refAwareMatch(rest, actual)) throw new Error(`Scenario object ${id} state mismatch.\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(expected)}`);
}

function makeAssertions(result: Omit<CardScenarioResult, "asserts">, expected: CardScenario["expect"]): () => void {
  return () => {
    if (!expected) return;
    if (expected.events) assertEvents(result.events, expected.events);
    if (expected.objects) {
      const byId = new Map(result.state.objects.map(object => [object.ref.id, object] as const));
      for (const [id, object] of Object.entries(expected.objects)) assertObjectExpectation(byId.get(id), object, id);
    }
    if (expected.players) for (const [id, player] of Object.entries(expected.players)) {
      const actual = result.state.players[id];
      if (!actual || !refAwareMatch(player, actual)) throw new Error(`Scenario player ${id} state mismatch.\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(player)}`);
    }
    if (expected.links && !refAwareMatch(expected.links, result.links)) throw new Error(`Scenario links mismatch.\nActual: ${JSON.stringify(result.links)}\nExpected: ${JSON.stringify(expected.links)}`);
  };
}

function operationEmission(operation: Extract<ScenarioOperation, { type: "trigger" }>, kernel: TestWorld): TimingEmission {
  const object = operation.object ? kernel.getObject(operation.object) ?? undefined : undefined;
  const source = operation.source ? kernel.getObject(operation.source) ?? undefined : object;
  const target = operation.target ? kernel.getObject(operation.target) ?? undefined : undefined;
  return {
    timingPoint: operation.timingPoint,
    object,
    source,
    target,
    player: operation.player,
    details: operation.details,
  };
}

function settle(engine: ChainEngine): void {
  engine.advance();
}

function performOperation(operation: ScenarioOperation, kernel: TestWorld, engine: ChainEngine, binding: ReturnType<typeof createProgramBinding>, answers: Map<string, ScenarioChoiceValue>): void {
  switch (operation.type) {
    case "choose":
      answers.set(operation.id, operation.value);
      return;
    case "play": {
      const source = kernel.getObject(operation.object);
      if (!source) throw new Error(`Unknown play source ${operation.object}`);
      const action: Extract<GameAction, { type: "play" }> = {
        type: "play",
        object: objectRefFor(kernel, operation.object),
        player: operation.player ?? source.controller,
        ...(operation.location ? { location: operation.location } : {}),
        ...(operation.cost ? { cost: operation.cost } : {}),
      };
      const outcome = engine.commit(action);
      if (outcome.status !== "done" && outcome.status !== "replaced") {
        throw new Error(`Scenario play ${operation.object} was ${outcome.status}`);
      }
      settle(engine);
      return;
    }
    case "activate": {
      const source = kernel.getObject(operation.object);
      if (!source) throw new Error(`Unknown activation source ${operation.object}`);
      engine.execute(binding.describeActivate(source, operation.player ?? source.controller, operation.ability ?? 0));
      return;
    }
    case "pass": {
      const player = operation.player ?? engine.priority;
      if (!player) throw new Error("Scenario pass has no current priority holder");
      engine.pass(player);
      return;
    }
    case "trigger":
      engine.emit(operationEmission(operation, kernel));
      settle(engine);
      return;
  }
}

function addInitialProgramObjects(kernel: TestWorld, engine: ChainEngine, ids: readonly string[]): void {
  for (const id of ids) {
    const object = kernel.getObject(id);
    if (object?.zone === "legend") continue;
    if (!object || object.zone !== "board") continue;
    const to = object.location?.type === "base" ? "base" : "battlefield";
    const location = object.location ?? DEFAULT_LOCATION;
    engine.commit({ type: "move-zone", object: object.ref, to: "chain" });
    const chainObject = kernel.getObject(id);
    if (!chainObject) throw new Error(`Initial program object ${id} disappeared while entering the Chain`);
    engine.commit({ type: "move-zone", object: chainObject.ref, to, location });
    settle(engine);
  }
}

/** Run a declarative card scenario through program binding, ChainEngine and EventPipeline. */
export function runCardScenario(program: CardProgram, scenario: CardScenario): CardScenarioResult {
  if (program.status !== "executable") throw new Error(`Scenario program ${program.canonicalCardId} is ${program.status}`);
  const { kernel, boardProgramIds } = makeWorld(scenario, program);
  const answerValues = new Map<string, ScenarioChoiceValue>(Object.entries(scenario.answers ?? {}));
  const decide = <T>(request: ChoiceRequest<T>): T => {
    const alias = request.type === "optional" ? "optional" : request.type === "order" ? "order" : request.type === "mode" && request.id.startsWith("mode:") ? "mode" : undefined;
    const suffix = request.id.includes("/") ? request.id.slice(request.id.lastIndexOf("/") + 1) : undefined;
    const answerKey = answerValues.has(request.id)
      ? request.id
      : suffix && answerValues.has(suffix)
        ? suffix
        : alias && answerValues.has(alias)
          ? alias
          : undefined;
    if (answerKey !== undefined) return normalizeChoice(request, answerValues.get(answerKey), kernel) as T;
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return request.options as unknown as T;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      const saved = checkpoint as { readonly state: ReturnType<TestWorld["snapshot"]>; readonly links: TestWorld };
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition! as never),
  });
  const programs: CardProgram[] = [program, ...(scenario.objects ?? []).flatMap(object => object.program ? [object.program] : [])];
  const programSource: ProgramSource = [...new Map(programs.map(entry => [entry.canonicalCardId, entry] as const)).values()];
  const binding = createProgramBinding({ cardPrograms: programSource });
  const turnOrder = [...(scenario.turnOrder ?? ["A", "B"])] as PlayerId[];
  const turnPlayer = scenario.turnPlayer ?? scenario.priority ?? turnOrder[0] ?? "A";
  const engine = new ChainEngine({
    turnOrder,
    turnPlayer,
    phase: scenario.phase ?? "main",
    host,
    cleanup: current => {
      let changed = false;
      current.layers.setObjects(kernel.objects);
      for (const object of current.layers.evaluateAll()) {
        if (object.zone !== "board" || !object.types.includes("unit") || object.might === null || (object.might > 0 && object.damage < object.might)) continue;
        const before = kernel.ref(object.ref.id);
        current.commit({ type: "kill", object: object.ref });
        const after = kernel.ref(object.ref.id);
        changed ||= before.zoneEntryId !== after.zoneEntryId;
      }
      return changed;
    },
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  addInitialProgramObjects(kernel, engine, boardProgramIds);
  // Setup transitions clear combatRole through the kernel move path; restore the
  // declared role afterwards so static conditions can observe it. This only
  // restores declarative setup state and never touches post-operation state.
  const postSetup = kernel.snapshot();
  for (const object of scenario.objects ?? []) {
    if (object.combatRole === undefined) continue;
    const restored = postSetup.objects.get(object.id);
    if (restored) postSetup.objects.set(object.id, { ...restored, combatRole: object.combatRole });
  }
  kernel.restore(postSetup);
  // Setup transitions establish lifecycle registrations; they are not scenario actions.
  const initialEventCount = engine.pipeline.events.length;
  if (scenario.priority && scenario.turnPlayer && scenario.priority !== engine.priority) {
    throw new Error(`Scenario priority ${scenario.priority} cannot be installed while ChainEngine priority is ${engine.priority}`);
  }
  let pending: { readonly operation: ScenarioOperation; readonly retry: () => void } | null = null;
  for (const operation of scenario.operations ?? []) {
    if (pending !== null) {
      if (operation.type !== "choose") throw new Error(`Scenario choice ${operation.type} arrived before answering ${pending.operation.type}`);
      performOperation(operation, kernel, engine, binding, answerValues);
      try {
        pending.retry();
        pending = null;
      } catch (error) {
        if (!(error instanceof AwaitChoice)) throw error;
      }
      continue;
    }
    try {
      performOperation(operation, kernel, engine, binding, answerValues);
    } catch (error) {
      if (!(error instanceof AwaitChoice)) throw error;
      const retry = operation.type === "play" && engine.items.some(item => item.status === "pending")
        ? () => settle(engine)
        : () => performOperation(operation, kernel, engine, binding, answerValues);
      pending = { operation, retry };
    }
  }
  if (pending !== null) throw new Error(`Scenario ended while waiting for choice in ${pending.operation.type}`);
  const events = engine.pipeline.events.slice(initialEventCount);
  const state = buildState(kernel, engine);
  const links = kernel.linkedSnapshot();
  const result = { events, state, links };
  return { ...result, asserts: makeAssertions(result, scenario.expect) };
}

/**
 * Turn template rows into independently runnable test cases. The caller can
 * register each `name`/`run` pair with node:test or another test runner.
 */
export function defineTemplateSuite(templateName: string, rows: readonly CardScenarioTemplateRow[]): readonly CardScenarioTemplateCase[] {
  return rows.map(row => ({
    name: `${templateName}: ${row.name ?? row.canonicalCardId} [${row.canonicalCardId}]`,
    canonicalCardId: row.canonicalCardId,
    run: () => {
      if (row.program.canonicalCardId !== row.canonicalCardId) throw new Error(`Template row identity mismatch for ${row.canonicalCardId}`);
      const scenario = row.expect === undefined ? row.scenario : { ...row.scenario, expect: row.expect };
      const result = runCardScenario(row.program, scenario);
      result.asserts();
      return result;
    },
  }));
}
