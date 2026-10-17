import type {
  Condition, Expr, GameAction, GameEvent, Instruction, InstructionDef, InstructionResult,
  LegacyBoardTokenAction, ObjectRef, ResolveContext, Value
} from "./contract.js";
import type { LocationRef, PlayerId } from "./contract.js";
import type { LocationFilter, LocationSelector } from "@riftbound/card-dsl";
import { instructionDefinitionsById } from "./instructions/registry.generated.js";
import { choiceMetadata, modeBodies, modeChoices, optionalChoice, orderedObjects } from "./interpreter/choice.js";
import { evaluateCondition } from "./interpreter/condition.js";
import { evaluateExpression, type ExpressionContext } from "./interpreter/expr.js";
import { historyCount, objectRef } from "./interpreter/history.js";
import { queryObjects } from "./interpreter/selectors.js";
import { arithmetic, asValue, compareValues, integer, MissingInformation, record, string } from "./interpreter/values.js";
import { chooseLocations, normalizeMoveArguments } from "./interpreter/locations.js";
import { isLegalLocation, resolveLocationSelector, sameLocation } from "../target/location/index.js";

export type InstructionRegistry = ReadonlyMap<string, InstructionDef<unknown>>;

export interface InterpreterOptions {
  /** Current zone-bound host identity; omitted when host and source coincide. */
  readonly host?: ObjectRef;
}

export interface InstructionExecution {
  readonly id: string;
  readonly op: string;
  readonly path: readonly string[];
  readonly result: InstructionResult;
}

export interface ExecutionOutcome {
  readonly status: "executed" | "partial";
  readonly results: readonly InstructionExecution[];
  readonly linkedValues: Readonly<Record<string, Value>>;
  readonly events: readonly GameEvent[];
}

interface Scope {
  readonly parent?: Scope;
  readonly results: Map<string, InstructionResult>;
  readonly values: Map<string, Readonly<Record<string, Value>>>;
  readonly aliases: Map<string, Value>;
  readonly ignoredTargets: Map<string, ReadonlySet<string>>;
  readonly targets: Map<string, ObjectRef[]>;
  readonly locations: Map<string, LocationRef[]>;
}

function scope(parent?: Scope): Scope {
  return { parent, results: new Map(), values: new Map(), aliases: new Map(), ignoredTargets: new Map(), targets: new Map(), locations: new Map() };
}

function findScope(current: Scope, id: string): Scope | undefined {
  if (current.results.has(id)) return current;
  return current.parent && findScope(current.parent, id);
}

function pathId(path: readonly string[]): string {
  return path.map(segment => encodeURIComponent(segment)).join("/");
}

function refKey(ref: ObjectRef): string { return JSON.stringify([ref.id, ref.zoneEntryId]); }

function isLocationSelector(value: unknown): value is LocationSelector {
  if (typeof value === "string") return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "base") return typeof record.player === "string" && !["controller", "opponent"].includes(String(record.player));
  if (record.type === "battlefield") return typeof record.id === "string";
  return [
    "relative", "location-of", "location-selector", "target-location",
    "target-controller-base", "target-owner-base", "source-location",
    "linked-location", "choose"
  ].includes(String(record.kind));
}

function locationsFor(current: Scope, local: ReadonlyMap<string, LocationRef[]>, id: string): readonly LocationRef[] {
  const selected = local.get(id);
  if (selected) return selected;
  for (let owner: Scope | undefined = current; owner; owner = owner.parent) {
    const scoped = owner.locations.get(id);
    if (scoped) return scoped;
  }
  return [];
}

function knownPlayers(context: ResolveContext): readonly PlayerId[] {
  const ids = new Set<PlayerId>([context.controller]);
  for (const object of context.query({})) {
    ids.add(object.owner);
    ids.add(object.controller);
  }
  return [...ids];
}

function readBody(value: unknown): readonly Instruction[] {
  if (!Array.isArray(value)) throw new Error("Instruction body must be an array");
  for (const item of value) {
    const instruction = record(item, "Instruction");
    string(instruction.id, "Instruction id");
    string(instruction.op, "Instruction opcode");
    record(instruction.args, "Instruction arguments");
  }
  return value as Instruction[];
}

function skipped(): InstructionResult { return { status: "negated", reason: "skipped", events: [] }; }

function aggregate(results: readonly InstructionResult[], events: GameEvent[], linkedValues?: Record<string, Value>): InstructionResult {
  if (results.length === 0 || results.some(result => result.status === "executed")) {
    return { status: "executed", events, ...(linkedValues ? { linkedValues } : {}) };
  }
  if (results.every(result => result.status === "ignored")) return { status: "ignored", reason: "mistargeted" };
  const negated = results.find(result => result.status === "negated");
  return { status: "negated", reason: negated?.reason ?? "impossible", events };
}

class AbilityExecution {
  readonly results: InstructionExecution[] = [];
  readonly events: GameEvent[] = [];
  readonly linkedValues: Record<string, Value> = Object.create(null) as Record<string, Value>;
  private readonly lookBack = new Set<string>();
  private partial = false;

  constructor(private readonly context: ResolveContext, private readonly registry: InstructionRegistry, private readonly options: InterpreterOptions) {}

  run(body: readonly Instruction[]): ExecutionOutcome {
    this.block(body, [], scope(), false);
    return {
      status: this.partial ? "partial" : "executed",
      results: this.results,
      linkedValues: { ...this.linkedValues },
      events: this.events
    };
  }

  private block(
    body: readonly Instruction[], path: readonly string[], current: Scope,
    reselect: boolean, ignoredTargets = new Set<string>()
  ): InstructionResult[] {
    const ids = new Set<string>();
    for (const instruction of readBody(body)) {
      if (ids.has(instruction.id)) throw new Error(`Duplicate instruction id: ${instruction.id}`);
      ids.add(instruction.id);
    }
    const inherited = new Set(ignoredTargets);
    const results = body.map(instruction => this.instruction(instruction, [...path, instruction.id], current, reselect, inherited));
    for (const instruction of body) {
      for (const key of current.ignoredTargets.get(instruction.id) ?? []) ignoredTargets.add(key);
    }
    return results;
  }

  private expressionContext(
    current: Scope,
    ignoredTargets: ReadonlySet<string>,
    context = this.context,
    localLocations?: ReadonlyMap<string, LocationRef[]>
  ): ExpressionContext {
    return {
      context,
      ...this.options,
      query: filter => this.context.query(filter),
      linked: (id, key) => {
        const owner = findScope(current, id);
        if (owner) {
          const values = owner.values.get(id);
          return key === undefined ? values && asValue(values) : values && Object.hasOwn(values, key) ? values[key] : undefined;
        }
        return this.context.linked(key === undefined ? id : `${id}.${key}`);
      },
      canLookBack: ref => this.lookBack.has(refKey(ref)),
      isIgnored: ref => ignoredTargets.has(refKey(ref)),
      locations: id => {
        const local = localLocations?.get(id);
        if (local) return local;
        for (let owner: Scope | undefined = current; owner; owner = owner.parent) {
          const selected = owner.locations.get(id);
          if (selected) return selected;
        }
        return [];
      }
    };
  }

  private instruction(
    instruction: Instruction, path: readonly string[], current: Scope,
    reselect: boolean, inheritedIgnoredTargets: ReadonlySet<string>
  ): InstructionResult {
    const writes: Record<string, Value> = Object.create(null) as Record<string, Value>;
    const targets = new Map<string, ObjectRef[]>();
    const locations = new Map<string, LocationRef[]>();
    const ignoredTargets = new Set(inheritedIgnoredTargets);
    const context = this.instructionContext(path, current, writes, targets, locations, ignoredTargets);
    let result: InstructionResult;
    try {
      const previous = instruction.linkedTo === undefined ? undefined : findScope(current, instruction.linkedTo);
      if (instruction.linkedTo !== undefined && previous === undefined) {
        throw new Error(`Unknown or forward instruction link: ${instruction.linkedTo}`);
      }
      for (const key of instruction.linkedTo === undefined ? [] : previous?.ignoredTargets.get(instruction.linkedTo) ?? []) {
        ignoredTargets.add(key);
      }
      if (instruction.linkedTo !== undefined && previous?.results.get(instruction.linkedTo)?.status === "ignored") {
        result = { status: "ignored", reason: "linked-ignored" };
      } else if (!this.prepareLocations(instruction, context, current, locations)) {
        result = { status: "ignored", reason: "mistargeted" };
      } else if (!this.prepareTargets(instruction, context, current, targets, locations, ignoredTargets, reselect)) {
        result = { status: "ignored", reason: "mistargeted" };
      } else if (instruction.condition && !context.test(instruction.condition)) {
        result = skipped();
      } else {
        const args = Object.fromEntries(Object.entries(instruction.args).map(([key, expression]) => [key, context.evaluate(expression)]));
        result = this.dispatch(instruction, args, context, path, current, locations, reselect, ignoredTargets);
      }
    } catch (error) {
      if (!(error instanceof MissingInformation)) throw error;
      result = { status: "ignored", reason: "mistargeted" };
    }
    if (result.status === "executed") {
      for (const [key, value] of Object.entries(result.linkedValues ?? {})) context.link(key, value);
    } else {
      this.partial = true;
    }
    for (const [id, refs] of targets) current.targets.set(id, refs);
    for (const [id, refs] of locations) current.locations.set(id, refs);
    current.results.set(instruction.id, result);
    current.ignoredTargets.set(instruction.id, ignoredTargets);
    if (Object.keys(writes).length > 0) current.values.set(instruction.id, { ...writes });
    this.results.push({ id: instruction.id, op: instruction.op, path, result });
    return result;
  }

  private instructionContext(
    path: readonly string[], current: Scope,
    writes: Record<string, Value>, targets: Map<string, ObjectRef[]>, locations: Map<string, LocationRef[]>,
    ignoredTargets: ReadonlySet<string>
  ): ResolveContext {
    const base = this.context;
    const context: ResolveContext = {
      source: base.source,
      controller: base.controller,
      timingPoint: base.timingPoint,
      object: ref => base.object(ref),
      lastKnown: ref => base.lastKnown(ref),
      query: filter => queryObjects(filter, this.expressionContext(current, ignoredTargets, context, locations)),
      zoneSlice: (player, zone, from, count) => base.zoneSlice(player, zone, from, count),
      targets: id => {
        let refs = targets.get(id);
        for (let owner: Scope | undefined = current; refs === undefined && owner; owner = owner.parent) refs = owner.targets.get(id);
        return [...(refs ?? base.targets(id))].filter(ref => !ignoredTargets.has(refKey(ref)));
      },
      // Location selections are interpreter-local bindings; the frozen ResolveContext
      // contract remains object-target based.
      picks: id => base.picks(id),
      player: id => base.player(id),
      evaluate: expr => evaluateExpression(expr, this.expressionContext(current, ignoredTargets, context, locations)),
      test: condition => evaluateCondition(condition, this.expressionContext(current, ignoredTargets, context, locations)),
      linked: key => {
        if (Object.hasOwn(writes, key)) return writes[key];
        for (let owner: Scope | undefined = current; owner; owner = owner.parent) {
          if (owner.aliases.has(key)) return owner.aliases.get(key);
        }
        return base.linked(key);
      },
      history: query => base.history(query),
      choose: request => base.choose({ ...request, id: pathId([...path, request.id]) }),
      perform: action => this.perform(action),
      link: (key, value) => {
        const captured = asValue(value);
        writes[key] = captured;
        current.aliases.set(key, captured);
        const qualified = `${pathId(path)}.${key}`;
        this.linkedValues[qualified] = captured;
        base.link(qualified, captured);
      },
      addContinuous: (effect, duration) => base.addContinuous(effect, duration),
      registerDelayedTrigger: (at, body) => base.registerDelayedTrigger(at, body)
    };
    return context;
  }

  private perform(input: GameAction | LegacyBoardTokenAction) {
    const action: GameAction = input.type === "create-token" && input.to === undefined ? { ...input, to: "board" } : input;
    const candidates: ObjectRef[] = [];
    if ("object" in action) candidates.push(action.object);
    if ("objects" in action) candidates.push(...action.objects);
    if (action.type === "draw" || action.type === "mill" || action.type === "channel-rune") {
      candidates.push(...this.context.query({ owner: action.player, zone: action.type === "channel-rune" ? "rune-deck" : "deck" }).map(object => object.ref));
    }
    const before = candidates.filter(ref => this.context.object(ref) !== null);
    const result = this.context.perform(action);
    for (const ref of before) {
      if (this.context.object(ref) === null) this.lookBack.add(refKey(ref));
    }
    return result;
  }

  private prepareLocations(
    instruction: Instruction,
    context: ResolveContext,
    current: Scope,
    locations: Map<string, LocationRef[]>
  ): boolean {
    const specs = instruction.locations ?? [];
    if (specs.length === 0) return true;
    try {
      const bindings = chooseLocations(context, specs, {
        host: this.options.host,
        players: knownPlayers(context),
        opponent: knownPlayers(context).find(player => player !== context.controller),
        linked: id => context.linked(id),
        locationBindings: id => {
          for (let owner: Scope | undefined = current; owner; owner = owner.parent) {
            const selected = owner.locations.get(id);
            if (selected) return selected;
          }
          return [];
        }
      });
      for (const binding of bindings) locations.set(binding.id, [...binding.selected]);
      return true;
    } catch (error) {
      if (error instanceof MissingInformation) return false;
      throw error;
    }
  }

  private prepareTargets(
    instruction: Instruction, context: ResolveContext, current: Scope,
    targets: Map<string, ObjectRef[]>, locations: Map<string, LocationRef[]>, ignoredTargets: Set<string>, reselect: boolean
  ): boolean {
    for (const spec of instruction.targets ?? []) {
      let resolvedLocation: LocationRef | null = null;
      let locationResolutionFailed = false;
      const locationRequirement = spec.location;
      const symbolicLocation = isLocationSelector(locationRequirement);
      if (symbolicLocation) {
        try {
          resolvedLocation = resolveLocationSelector(locationRequirement, {
            context,
            host: this.options.host,
            locationBindings: id => locationsFor(current, locations, id)
          });
        } catch {
          locationResolutionFailed = true;
        }
      }
      const options = context.query(spec.filter).map(object => object.ref).filter(ref => {
        if (ignoredTargets.has(refKey(ref))) return false;
        const snapshot = context.object(ref);
        if (!snapshot || locationRequirement === undefined) return true;
        if (locationRequirement === null) return snapshot.location === null;
        if (locationResolutionFailed) return false;
        if (resolvedLocation !== null) return sameLocation(snapshot.location, resolvedLocation);
        return isLegalLocation(context, snapshot.location!, locationRequirement as LocationFilter, {
          players: knownPlayers(context)
        });
      });
      const valid = new Set(options.map(refKey));
      const min = integer(spec.min ?? (spec.selection === "up-to" || spec.selection === "any" || spec.selection === "all" ? 0 : 1), "Target minimum");
      let selected: ObjectRef[];
      if (reselect) {
        const limit = integer(spec.max ?? (spec.selection === "one" || spec.selection === undefined ? 1 : Number.MAX_SAFE_INTEGER), "Target maximum");
        if (limit < min) throw new Error("Target maximum must not be less than its minimum");
        const max = Math.min(limit, options.length);
        if (max === 0 && min > 0) return false;
        if (spec.selection === "all") selected = options;
        else {
          const answer: unknown = context.choose<ObjectRef[]>({
            id: `target:${spec.id}`, type: "select-objects", options, min: Math.min(min, max), max,
            ...choiceMetadata({}, context)
          });
          if (!Array.isArray(answer)) throw new Error("Target answer must be an array");
          selected = answer.map(objectRef);
          if (selected.length < min || selected.length > limit || new Set(selected.map(refKey)).size !== selected.length) {
            throw new Error("Invalid target choice answer");
          }
          const legal = selected.filter(ref => valid.has(refKey(ref)) && context.object(ref) !== null);
          for (const ref of selected) {
            if (!legal.some(candidate => refKey(candidate) === refKey(ref))) ignoredTargets.add(refKey(ref));
          }
          if (legal.length !== selected.length) this.partial = true;
          selected = legal;
        }
      } else {
        const locked = this.context.targets(spec.id);
        selected = locked.filter(ref => valid.has(refKey(ref)) && context.object(ref) !== null && !ignoredTargets.has(refKey(ref)));
        for (const ref of locked) {
          if (!selected.some(candidate => refKey(candidate) === refKey(ref))) ignoredTargets.add(refKey(ref));
        }
        if (selected.length !== locked.length) this.partial = true;
      }
      targets.set(spec.id, selected);
      if (min > 0 && selected.length === 0) return false;
    }
    return true;
  }

  private dispatch(
    instruction: Instruction, args: Readonly<Record<string, Value>>, context: ResolveContext,
    path: readonly string[], current: Scope, locations: Map<string, LocationRef[]>, reselect: boolean, ignoredTargets: Set<string>
  ): InstructionResult {
    const start = this.events.length;
    switch (instruction.op) {
      case "sequence": {
        const children = this.block(readBody(args.body), path, current, reselect, ignoredTargets);
        return aggregate(children, this.events.slice(start));
      }
      case "repeat": {
        const count = integer(args.count, "Repeat count");
        const reselectTargets = args.reselectTargets === undefined ? true : args.reselectTargets;
        if (typeof reselectTargets !== "boolean") throw new Error("Repeat reselectTargets must be a boolean");
        const body = readBody(args.body);
        const children: InstructionResult[] = [];
        const inherited = new Set(ignoredTargets);
        for (let index = 0; index < count; index++) {
          const iterationIgnored = new Set(inherited);
          children.push(...this.block(body, [...path, String(index)], scope(current), reselectTargets, iterationIgnored));
          for (const key of iterationIgnored) ignoredTargets.add(key);
        }
        return aggregate(children, this.events.slice(start), { count });
      }
      case "choice.optional": {
        if (!optionalChoice(args, context)) return skipped();
        const children = this.block(readBody(args.body), path, current, reselect, ignoredTargets);
        return aggregate(children, this.events.slice(start), { value: true });
      }
      case "choice.mode": {
        const modes = modeBodies(args.modes);
        const selected = modeChoices(modes.map(mode => mode.id), args, context);
        const children: InstructionResult[] = [];
        const inherited = new Set(ignoredTargets);
        for (const mode of modes) {
          const copies = selected.filter(id => id === mode.id).length;
          for (let index = 0; index < copies; index++) {
            const modeIgnored = new Set(inherited);
            children.push(...this.block(readBody(mode.body), [...path, mode.id, String(index)], scope(current), reselect, modeIgnored));
            for (const key of modeIgnored) ignoredTargets.add(key);
          }
        }
        return aggregate(children, this.events.slice(start), { value: selected });
      }
      case "choice.order": {
        const ordered = orderedObjects(args.objects, args, context);
        return { status: "executed", events: [], linkedValues: { value: asValue(ordered) } };
      }
      case "condition.predicate": {
        const condition = record(args.condition, "Predicate condition") as unknown as Condition;
        return { status: "executed", events: [], linkedValues: { value: context.test(condition) } };
      }
      case "condition.history": {
        const count = historyCount(args.query, context);
        const value = args.operator === undefined ? count : compareValues(count, args.operator, args.right ?? null);
        return { status: "executed", events: [], linkedValues: { count, value } };
      }
      case "condition.value": {
        let value: Value;
        if (args.operands !== undefined) {
          if (!Array.isArray(args.operands)) throw new Error("Arithmetic operands must be an expression array");
          const operands = args.operands.map(value => context.evaluate(record(value, "Operand expression") as unknown as Expr));
          value = arithmetic(args.operator, operands);
        } else {
          if (!Object.hasOwn(args, "value")) throw new Error("condition.value requires value or operands");
          value = args.operator === undefined ? args.value! : compareValues(args.value!, args.operator, args.right ?? null);
        }
        const key = args.key === undefined ? "value" : string(args.key, "Value binding key");
        return { status: "executed", events: [], linkedValues: { value, [key]: value } };
      }
      default: {
        const definition = this.registry.get(instruction.op);
        if (!definition || definition.op !== instruction.op) throw new Error(`Unregistered instruction opcode: ${instruction.op}`);
        const parsedArgs = instruction.op === "effect.move"
          ? normalizeMoveArguments(args, context, {
            host: this.options.host,
            players: knownPlayers(context),
            opponent: knownPlayers(context).find(player => player !== context.controller),
            linked: (id, key) => context.linked(key === undefined ? id : `${id}.${key}`),
            locationBindings: id => locationsFor(current, locations, id)
          })
          : args;
        const result = definition.execute(context, definition.argsSchema.parse(parsedArgs));
        if (result.status !== "ignored") this.events.push(...result.events);
        return result;
      }
    }
  }
}

export function runAbilityBody(
  body: readonly Instruction[], context: ResolveContext,
  registry: InstructionRegistry = instructionDefinitionsById, options: InterpreterOptions = {}
): ExecutionOutcome {
  return new AbilityExecution(context, registry, options).run(body);
}
