import type {
  Expr,
  FinalizedCostPlan,
  GameAction,
  Instruction,
  ObjectFilter,
  ObjectRef,
  ResolveContext,
  TokenSpec,
  Value,
  ZoneDestination
} from "../effects/contract.js";
import { BlockedReplacementError, REPLACED_EVENT_LINK, type ReplacementHostAdapter, type ReplacementPlanInput } from "./types.js";

/** The bound context this planner plans against (no pipeline execution). */
export interface PlannerContext {
  readonly host: ReplacementHostAdapter;
  readonly controller: string;
  readonly evaluate: (expr: Expr) => Value;
  /** Runtime bindings used by target/pick/query/choose and incarnation checks. */
  readonly context?: ResolveContext;
}

interface RefSelection {
  readonly allowEmpty?: boolean;
  readonly defaultMin?: number;
  readonly defaultMax?: number;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refKey = (ref: ObjectRef): string => JSON.stringify([ref.id, ref.zoneEntryId]);

const isSetSelector = (value: unknown): boolean =>
  isRecord(value) && (value.kind === "query" || value.kind === "choose");

const asObjectRef = (value: unknown): ObjectRef | null => {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 ||
      !Number.isSafeInteger(value.zoneEntryId) || (value.zoneEntryId as number) < 0) return null;
  return { id: value.id, zoneEntryId: value.zoneEntryId as number };
};

/** Permanents live at their controller's base unless the card names a spot. */
function locationFor(controller: string): Extract<GameAction, { type: "move-zone" }>["location"] {
  return { type: "base", player: controller };
}

function deferred(message: string): never {
  throw new BlockedReplacementError("plan-time selector binding is unavailable: " + message);
}

function currentRef(planner: PlannerContext, ref: ObjectRef): ObjectRef | null {
  return planner.host.object(ref) === null ? null : { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function refsFromLinked(value: Value | undefined): ObjectRef[] {
  if (value === undefined) return [];
  const refs: ObjectRef[] = [];
  const visit = (entry: unknown): void => {
    const direct = asObjectRef(entry);
    if (direct !== null) { refs.push(direct); return; }
    if (Array.isArray(entry)) { entry.forEach(visit); return; }
    if (!isRecord(entry)) return;
    if (Array.isArray(entry.objects)) { entry.objects.forEach(visit); return; }
    for (const candidate of Object.values(entry)) visit(candidate);
  };
  visit(value);
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function linkedValue(planner: PlannerContext, input: ReplacementPlanInput, key: string): Value | undefined {
  if (key === REPLACED_EVENT_LINK) return input.replacedObject as unknown as Value;
  return planner.context?.linked(key);
}

function sortRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  return [...refs].sort((left, right) =>
    left.id === right.id ? left.zoneEntryId - right.zoneEntryId : left.id < right.id ? -1 : 1
  );
}

function resolveObjectRefs(
  value: unknown,
  input: ReplacementPlanInput,
  planner: PlannerContext,
  selection: RefSelection = {}
): ObjectRef[] {
  const direct = asObjectRef(value);
  if (direct !== null) {
    const live = currentRef(planner, direct);
    if (live === null && !selection.allowEmpty) {
      throw new BlockedReplacementError("replacement body selected a stale object incarnation");
    }
    return live === null ? [] : [live];
  }

  if (value === "self" || value === "source") {
    const ref = currentRef(planner, input.hostRef);
    if (ref === null) throw new BlockedReplacementError("replacement host is no longer a current object");
    return [ref];
  }

  if (typeof value === "string") {
    const context = planner.context;
    if (context === undefined) deferred(`target ${value}`);
    const refs = context.targets(value).map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null);
    if (refs.length === 0 && !selection.allowEmpty) {
      throw new BlockedReplacementError("replacement body target has no current object");
    }
    return refs;
  }

  if (!isRecord(value)) {
    throw new BlockedReplacementError("Unsupported object selector in replacement body: " + JSON.stringify(value));
  }

  if ("linked" in value && Object.keys(value).length === 1) {
    const key = value.linked;
    if (typeof key !== "string" || key.length === 0) throw new BlockedReplacementError("replacement linked selector requires a non-empty key");
    if (key === REPLACED_EVENT_LINK && input.replacedObject === null) {
      throw new BlockedReplacementError("replacement body has no replaced-event object binding");
    }
    const refs = refsFromLinked(linkedValue(planner, input, key)).map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null);
    if (refs.length === 0 && !selection.allowEmpty) {
      throw new BlockedReplacementError("replacement body has no current linked object binding for " + key);
    }
    return refs;
  }

  if ("target" in value && Object.keys(value).length === 1) {
    const id = value.target;
    if (typeof id !== "string" || id.length === 0) throw new BlockedReplacementError("replacement target selector requires a non-empty id");
    return resolveObjectRefs(id, input, planner, selection);
  }

  if ("pick" in value && Object.keys(value).length === 1) {
    const id = value.pick;
    if (typeof id !== "string" || id.length === 0) throw new BlockedReplacementError("replacement pick selector requires a non-empty id");
    const context = planner.context;
    if (context === undefined) deferred(`pick ${id}`);
    const refs = context.picks(id).map(asObjectRef).filter((ref): ref is ObjectRef => ref !== null)
      .map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null);
    if (refs.length === 0 && !selection.allowEmpty) {
      throw new BlockedReplacementError("replacement body pick has no current object");
    }
    return refs;
  }

  const kind = value.kind;
  if (kind === "source" || kind === "self") return resolveObjectRefs("source", input, planner, selection);
  if (kind === "target" || kind === "pick" || kind === "linked") {
    const id = value.id ?? (kind === "linked" ? value.key ?? value.instructionId : undefined);
    if (typeof id !== "string" || id.length === 0) {
      throw new BlockedReplacementError(`replacement ${kind} selector requires a non-empty id`);
    }
    if (kind === "linked") return resolveObjectRefs({ linked: id }, input, planner, selection);
    return resolveObjectRefs({ [kind]: id }, input, planner, selection);
  }

  if (kind === "linked-value") {
    const key = value.key ?? value.instructionId;
    if (typeof key !== "string" || key.length === 0) throw new BlockedReplacementError("replacement linked-value selector requires a non-empty key");
    return resolveObjectRefs({ linked: key }, input, planner, selection);
  }

  const context = planner.context;
  if (context === undefined) deferred(String(kind ?? "object selector"));
  const players = new Set<string>([planner.controller]);
  for (const object of context.query({})) {
    players.add(object.owner);
    players.add(object.controller);
  }
  const normalizeQuery = (filter: ObjectFilter): ObjectFilter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"] as const) {
      if (normalized[key] === "self") normalized[key] = planner.controller;
      if (normalized[key] === "opponent") {
        const opponent = [...players].find(player => player !== planner.controller);
        if (opponent === undefined) throw new BlockedReplacementError("replacement relative opponent has no known player");
        normalized[key] = opponent;
      }
    }
    return normalized;
  };
  if (kind === "query") {
    if (!isRecord(value.filter)) throw new BlockedReplacementError("replacement query selector requires an object filter");
    const refs = sortRefs(context.query(normalizeQuery(value.filter as ObjectFilter)).map(object => object.ref)
      .map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null));
    if (refs.length === 0 && !selection.allowEmpty) {
      throw new BlockedReplacementError("replacement query selected no current objects");
    }
    return refs;
  }

  if (kind === "choose") {
    if (typeof value.id !== "string" || value.id.length === 0) throw new BlockedReplacementError("replacement choose selector requires a non-empty id");
    if (!isRecord(value.filter)) throw new BlockedReplacementError("replacement choose selector requires an object filter");
    const options = sortRefs(context.query(normalizeQuery(value.filter as ObjectFilter)).map(object => object.ref)
      .map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null));
    const requestedMin = value.min === undefined ? selection.defaultMin ?? 0 : value.min;
    const requestedMax = value.max === undefined ? selection.defaultMax ?? options.length : value.max;
    if (!Number.isSafeInteger(requestedMin) || !Number.isSafeInteger(requestedMax) ||
        (requestedMin as number) < 0 || (requestedMax as number) < (requestedMin as number)) {
      throw new BlockedReplacementError("replacement choose selector has invalid bounds");
    }
    const max = Math.min(requestedMax as number, options.length);
    const min = Math.min(requestedMin as number, max);
    if (requestedMin as number > max) throw new BlockedReplacementError("replacement choose selector has no completable selection");
    if (max === 0) return [];
    const chooser = typeof value.chooser === "string" ? value.chooser : planner.controller;
    const visibility = value.visibility === "chooser-only" || value.visibility === "public" || Array.isArray(value.visibility)
      ? value.visibility
      : "public";
    const answer = context.choose<readonly ObjectRef[]>({
      id: value.id,
      type: "select-objects",
      options,
      min,
      max,
      chooser,
      visibility: visibility as "public" | "chooser-only" | readonly string[],
      ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {})
    });
    if (!Array.isArray(answer) || answer.length < min || answer.length > max) {
      throw new BlockedReplacementError("replacement choose selector returned an invalid answer");
    }
    const legal = new Set(options.map(refKey));
    const refs = answer.map(asObjectRef).filter((ref): ref is ObjectRef => ref !== null && legal.has(refKey(ref)));
    if (refs.length !== answer.length || new Set(refs.map(refKey)).size !== refs.length) {
      throw new BlockedReplacementError("replacement choose selector returned an unavailable or duplicate object");
    }
    return refs;
  }

  throw new BlockedReplacementError("Unsupported object selector in replacement body: " + JSON.stringify(value));
}

function objectRef(value: Value, input: ReplacementPlanInput, planner: PlannerContext): ObjectRef {
  const refs = resolveObjectRefs(value, input, planner);
  if (refs.length !== 1) throw new BlockedReplacementError("replacement body requires exactly one current object");
  return refs[0]!;
}

function objectRefs(value: Value, input: ReplacementPlanInput, planner: PlannerContext, selection: RefSelection = {}): ObjectRef[] {
  return resolveObjectRefs(value, input, planner, selection);
}

function destinationOf(value: Value): ZoneDestination {
  if (typeof value === "string") return value as ZoneDestination;
  if (isRecord(value) && typeof value.type === "string") return value.type as ZoneDestination;
  throw new BlockedReplacementError("Unsupported zone destination in replacement body");
}

function relativePlayer(value: unknown, planner: PlannerContext): string | undefined {
  if (typeof value !== "string") return undefined;
  if (["self", "source", "controller", "you"].includes(value)) return planner.controller;
  if (value === "opponent") {
    const players = new Set<string>();
    for (const object of planner.context?.query({}) ?? []) {
      players.add(object.owner);
      players.add(object.controller);
    }
    return [...players].find(player => player !== planner.controller);
  }
  return value;
}

function locationOf(value: Value, planner: PlannerContext): Extract<GameAction, { type: "move-zone" }>["location"] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "base") {
    const player = relativePlayer(value.player, planner);
    return player === undefined ? undefined : { type: "base", player };
  }
  if (value.type === "battlefield" && typeof value.id === "string") return { type: "battlefield", id: value.id };
  return undefined;
}

function zoneAction(
  object: ObjectRef,
  destination: ZoneDestination,
  location: Extract<GameAction, { type: "move-zone" }>["location"] | undefined,
  planner: PlannerContext
): GameAction {
  if (destination === "hand") return { type: "return-to-hand", object };
  if (destination === "deck-bottom") return { type: "recycle", object };
  if (destination === "banishment") return { type: "banish", object };
  if (destination === "base" || destination === "battlefield") {
    const current = planner.host.object(object);
    if (current?.zone === "board") {
      const target = location ?? (destination === "base" ? { type: "base", player: current.controller } : undefined);
      if (target === undefined) throw new BlockedReplacementError("effect.zone battlefield movement requires a location");
      return { type: "move-location", object, to: target };
    }
  }
  return {
    type: "move-zone",
    object,
    to: destination,
    ...(location === undefined ? {} : { location })
  };
}

function paymentPlan(value: Value): FinalizedCostPlan {
  if (!isRecord(value)) throw new BlockedReplacementError("cost.pay requires a finalized or plain payment descriptor");
  // `payments` may be either the legacy nested { payments: {...} } descriptor
  // or the cost pipeline's array of payment components. Arrays cannot be a
  // plain finalized resource plan and stay blocked rather than being guessed.
  const raw = isRecord(value.payments) ? value.payments : value;
  if (raw.finalized === true) {
    const finalizedKeys = new Set([
      "finalized", "planId", "energy", "power", "universalPower", "powerSources",
      "xp", "exhaust", "recycle", "parameters", "receipt"
    ]);
    if (Object.keys(raw).some(key => !finalizedKeys.has(key))) {
      throw new BlockedReplacementError("cost.pay replacement requires a primitive finalized plan, not a full CostPlan");
    }
    if (raw.powerSources !== undefined || raw.universalPower !== undefined || raw.parameters !== undefined) {
      throw new BlockedReplacementError("cost.pay replacement cannot lower Universal Power or opaque payment parameters");
    }
    return raw as unknown as FinalizedCostPlan;
  }
  const keys = Object.keys(raw);
  if (keys.some(key => !["energy", "power", "xp", "domain"].includes(key))) {
    throw new BlockedReplacementError("cost.pay replacement requires a plain energy/power/xp descriptor or finalized plan");
  }
  const energy = raw.energy ?? 0;
  const xp = raw.xp ?? 0;
  if (!Number.isSafeInteger(energy) || (energy as number) < 0 || !Number.isSafeInteger(xp) || (xp as number) < 0) {
    throw new BlockedReplacementError("cost.pay replacement has an invalid resource amount");
  }
  const requestedPower = raw.power ?? [];
  let power: readonly ("Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order")[];
  if (typeof requestedPower === "number") {
    if (!Number.isSafeInteger(requestedPower) || requestedPower < 0) throw new BlockedReplacementError("cost.pay replacement has invalid Power");
    power = [];
    if (requestedPower > 0) throw new BlockedReplacementError("cost.pay replacement requires explicit domains for Power");
  } else if (Array.isArray(requestedPower) && requestedPower.every(domain =>
    ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"].includes(String(domain)))) {
    power = requestedPower as typeof power;
  } else {
    throw new BlockedReplacementError("cost.pay replacement has invalid Power domains");
  }
  return { finalized: true, energy: energy as number, power, xp: xp as number };
}

function planCostPay(args: Readonly<Record<string, Expr>>, planner: PlannerContext): GameAction[] {
  if (args.payments !== undefined && args.cost !== undefined) {
    throw new BlockedReplacementError("cost.pay replacement accepts either cost or payments");
  }
  const source = args.cost ?? args.payments;
  if (source === undefined) throw new BlockedReplacementError("cost.pay replacement requires cost or payments");
  if (args.nonstandardOrder !== undefined) {
    throw new BlockedReplacementError("cost.pay replacement cannot consume a caller payment-order override");
  }
  const evaluated = planner.evaluate(source);
  const payment = isRecord(evaluated) && isRecord(evaluated.payments) ? evaluated.payments : evaluated;
  if (!isRecord(payment)) throw new BlockedReplacementError("cost.pay replacement requires a payment descriptor");
  const normalized: Record<string, unknown> = { ...payment };
  if (args.power !== undefined) {
    if (normalized.power !== undefined) throw new BlockedReplacementError("cost.pay replacement received Power twice");
    const power = planner.evaluate(args.power);
    if (!Array.isArray(power) || power.length === 0 ||
        !power.every(domain => ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"].includes(String(domain)))) {
      throw new BlockedReplacementError("cost.pay replacement Power must name concrete Domains");
    }
    normalized.power = power;
  }
  return [{ type: "pay", player: planner.controller, plan: paymentPlan(normalized as Value) }];
}

/** Plan one instruction as closed GameActions without executing it. */
export function planInstruction(
  instruction: Instruction,
  input: ReplacementPlanInput,
  planner: PlannerContext
): readonly GameAction[] {
  const args = instruction.args as Readonly<Record<string, Expr>>;
  if (instruction.condition) {
    if (planner.context === undefined) {
      throw new BlockedReplacementError("plan-time selector binding is unavailable: instruction condition");
    }
    if (!planner.context.test(instruction.condition)) return [];
  }
  const evaluate = (expr: Expr | undefined, fallback: Value): Value => expr === undefined ? fallback : planner.evaluate(expr);
  switch (instruction.op) {
    case "effect.ready":
    case "effect.exhaust": {
      const selector = args.objects ?? args.target ?? args.choose ?? "source";
      const selected = typeof selector === "string" ? selector : evaluate(selector, null);
      return objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) }).map(object => ({
        type: instruction.op === "effect.ready" ? "ready" : "exhaust",
        object
      }));
    }
    case "effect.move": {
      const mode = evaluate(args.mode, "move");
      if (mode === "recall") throw new BlockedReplacementError("effect.move mode 'recall' is blocked (CR 457-460): no Recall action exists");
      if (mode !== "move") throw new BlockedReplacementError("effect.move mode must be move or recall");
      const objects = objectRefs(evaluate(args.objects, "source"), input, planner);
      const destination = evaluate(args.to, null);
      if (destination === "controller-base") {
        return objects.flatMap(object => {
          const current = planner.host.object(object);
          if (current === null || current.zone !== "board" || current.location === null) {
            throw new BlockedReplacementError("controller-base Move requires a current Board permanent");
          }
          const to = { type: "base" as const, player: current.controller };
          return current.location.type === to.type && current.location.player === to.player
            ? []
            : [{ type: "move-location" as const, object, to }];
        });
      }
      const to = locationOf(destination, planner);
      if (to === undefined) throw new BlockedReplacementError("effect.move requires a concrete location destination");
      return objects.flatMap((object): GameAction[] => {
        const current = planner.host.object(object);
        if (current === null) throw new BlockedReplacementError("effect.move selected a stale object");
        if (current.zone === "board") {
          if (current.location?.type === to.type && (to.type === "base"
            ? current.location.type === "base" && current.location.player === to.player
            : current.location.type === "battlefield" && current.location.id === to.id)) return [];
          return [{ type: "move-location" as const, object, to }];
        }
        return [{ type: "move-zone" as const, object, to: to.type, location: to }];
      });
    }
    case "effect.zone": {
      const selector = args.objects ?? args.target ?? args.pick;
      if (selector === undefined) throw new BlockedReplacementError("effect.zone requires an object selector");
      if (args.to === undefined) throw new BlockedReplacementError("effect.zone requires a to argument");
      const selected = evaluate(selector, null);
      const refs = objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) });
      const amountValue = args.amount === undefined ? refs.length : planner.evaluate(args.amount);
      if (typeof amountValue !== "number" || !Number.isSafeInteger(amountValue) || amountValue < 0) {
        throw new BlockedReplacementError("effect.zone amount must be a nonnegative integer");
      }
      let destination: ZoneDestination;
      if (args.to !== undefined) {
        destination = destinationOf(planner.evaluate(args.to));
      } else {
        const choice = args.choice === undefined ? undefined : planner.evaluate(args.choice);
        if (!isRecord(choice) || typeof choice.id !== "string" || !Array.isArray(choice.options) ||
            choice.options.length === 0 || !choice.options.every(option => typeof option === "string")) {
          throw new BlockedReplacementError("effect.zone destination choice requires id and options");
        }
        if (planner.context === undefined) deferred("effect.zone destination choice");
        const options = choice.options as readonly ZoneDestination[];
        destination = planner.context.choose<ZoneDestination>({
          id: choice.id,
          type: "mode",
          options,
          chooser: typeof choice.chooser === "string" ? choice.chooser : planner.controller,
          visibility: (choice.visibility === "chooser-only" || choice.visibility === "public" || Array.isArray(choice.visibility)
            ? choice.visibility
            : "public") as "public" | "chooser-only" | readonly string[],
          ...(typeof choice.prompt === "string" ? { prompt: choice.prompt } : {})
        });
        if (!options.includes(destination)) throw new BlockedReplacementError("effect.zone destination choice returned an unavailable option");
      }
      const location = args.location === undefined ? undefined : locationOf(planner.evaluate(args.location), planner);
      return refs.slice(0, amountValue).map(object => zoneAction(object, destination, location, planner));
    }
    case "effect.damage": {
      const target = args.target;
      if (target === undefined) throw new BlockedReplacementError("effect.damage target must be an object selector spelling");
      const amount = evaluate(args.amount, 0);
      if (amount === null || amount === "opponent" || typeof amount === "object" || Number(amount) <= 0) {
        throw new BlockedReplacementError("effect.damage amount must be a positive number");
      }
      return [{
        type: "damage",
        source: objectRef("source", input, planner),
        target: objectRef(planner.evaluate(target), input, planner),
        amount: Number(amount),
        combat: false
      }];
    }
    case "effect.draw": {
      const player = evaluate(args.player ?? args.target, planner.controller);
      if (typeof player !== "string") throw new BlockedReplacementError("effect.draw target must be a player id");
      const amount = evaluate(args.amount, 1);
      if (amount === null || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new BlockedReplacementError("effect.draw amount must be a nonnegative integer");
      }
      return [{ type: "draw", player, amount }];
    }
    case "effect.heal": {
      const selector = args.objects ?? args.target ?? args.pick ?? "source";
      const selected = typeof selector === "string" ? selector : evaluate(selector, null);
      const refs = objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) });
      const amountValue = args.amount === undefined ? undefined : planner.evaluate(args.amount);
      if (amountValue !== undefined && (typeof amountValue !== "number" || !Number.isSafeInteger(amountValue) || amountValue < 0)) {
        throw new BlockedReplacementError("effect.heal amount must be a nonnegative integer");
      }
      return refs.map(object => {
        if (amountValue !== undefined) return { type: "heal" as const, object, amount: amountValue };
        const current = planner.host.object(object);
        if (current === null) throw new BlockedReplacementError("effect.heal selected a stale object");
        return { type: "heal" as const, object, amount: current.damage };
      });
    }
    case "effect.resources": {
      const energy = evaluate(args.energy, 0);
      if (energy === null || typeof energy !== "number" || !Number.isSafeInteger(energy) || energy < 0) {
        throw new BlockedReplacementError("effect.resources energy must be a nonnegative integer");
      }
      return [{ type: "gain-energy", player: planner.controller, amount: energy }];
    }
    case "effect.buff": {
      const mode = evaluate(args.mode, "buff");
      if (mode !== "buff" && mode !== "spend") throw new BlockedReplacementError("effect.buff mode must be buff or spend");
      const selector = args.objects ?? args.target ?? args.pick;
      if (selector === undefined) throw new BlockedReplacementError("effect.buff requires an object selector");
      const amount = evaluate(args.amount, 1);
      if (amount === null || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new BlockedReplacementError("effect.buff amount must be a nonnegative integer");
      }
      const selected = evaluate(selector, null);
      return objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) }).map(object => mode === "spend"
        ? { type: "spend-buff", object, amount }
        : { type: "buff", object, amount });
    }
    case "effect.counter": {
      if (args.target === undefined || args.counter === undefined) {
        throw new BlockedReplacementError("effect.counter requires target and counter arguments");
      }
      const counter = planner.evaluate(args.counter);
      const amount = evaluate(args.amount, 1);
      if (typeof counter !== "string" || counter.length === 0 || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new BlockedReplacementError("effect.counter requires a counter name and nonnegative integer amount");
      }
      return [{ type: "add-counter", object: objectRef(planner.evaluate(args.target), input, planner), counter, amount }];
    }
    case "effect.kill": {
      const selector = args.objects ?? args.picks ?? args.target;
      const self = evaluate(args.self, false);
      if (selector === undefined && self !== true) throw new BlockedReplacementError("effect.kill requires an object selector");
      const refs = self === true
        ? objectRefs("source", input, planner, { defaultMin: 1, defaultMax: 1 })
        : objectRefs(evaluate(selector!, null), input, planner, {
          allowEmpty: isSetSelector(evaluate(selector!, null)),
          defaultMin: 1,
          defaultMax: 1
        });
      const count = args.count === undefined ? refs.length : planner.evaluate(args.count);
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new BlockedReplacementError("effect.kill count must be a nonnegative integer");
      }
      if (count === 0) return [];
      if (count > refs.length) throw new BlockedReplacementError("effect.kill count exceeds current candidates");
      if (count > 1) throw new BlockedReplacementError("effect.kill replacement requires the atomic Kill batch contract for more than one object");
      if (refs.length === 1) return [{ type: "kill", object: refs[0]! }];
      if (planner.context === undefined) deferred("effect.kill choice");
      const answer = planner.context.choose<readonly ObjectRef[]>({
        id: `effect.kill:${planner.context.source.ref.id}:${planner.context.timingPoint}`,
        type: "select-objects",
        chooser: planner.controller,
        visibility: "public",
        options: refs,
        min: count,
        max: count
      });
      const legal = new Set(refs.map(refKey));
      const chosen = answer.map(asObjectRef).filter((ref): ref is ObjectRef => ref !== null && legal.has(refKey(ref)));
      if (chosen.length !== count || new Set(chosen.map(refKey)).size !== count) {
        throw new BlockedReplacementError("effect.kill choice returned an unavailable or duplicate object");
      }
      return [{ type: "kill", object: chosen[0]! }];
    }
    case "effect.banish": {
      const selected = evaluate(args.objects, "source");
      const refs = objectRefs(selected, input, planner, {
        allowEmpty: isSetSelector(selected),
        defaultMin: 1,
        defaultMax: 1
      });
      const amountValue = args.amount === undefined ? refs.length : planner.evaluate(args.amount);
      if (typeof amountValue !== "number" || !Number.isSafeInteger(amountValue) || amountValue < 0) {
        throw new BlockedReplacementError("effect.banish amount must be a nonnegative integer");
      }
      return refs.slice(0, amountValue).map(object => ({ type: "banish", object }));
    }
    case "effect.discard": {
      const selector = args.objects ?? args.target ?? args.pick;
      if (selector === undefined) throw new BlockedReplacementError("effect.discard requires an object selector");
      const selected = evaluate(selector, null);
      return objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) }).map(object => ({ type: "discard", object }));
    }
    case "effect.recycle": {
      const selector = args.objects ?? args.target ?? args.pick;
      if (selector === undefined) throw new BlockedReplacementError("effect.recycle requires an object selector");
      const selected = evaluate(selector, null);
      return objectRefs(selected, input, planner, { allowEmpty: isSetSelector(selected) }).map(object => ({ type: "recycle", object }));
    }
    case "effect.inspect": {
      const scope = evaluate(args.scope, args.amount !== undefined ? "top" : args.picksSpecId === undefined ? "zone" : "picks");
      const choose = evaluate(args.choose, false);
      if ((scope !== "picks" && scope !== "top") || choose !== false) {
        throw new BlockedReplacementError("effect.inspect replacement planning requires ordered picks or top scope with no nested choice");
      }
      if (args.picksSpecId === undefined) throw new BlockedReplacementError("effect.inspect picks scope requires picksSpecId");
      if (args.player === undefined) throw new BlockedReplacementError("effect.inspect replacement requires a player");
      const player = planner.evaluate(args.player);
      const picksId = planner.evaluate(args.picksSpecId);
      if (typeof player !== "string" || typeof picksId !== "string" || planner.context === undefined) {
        throw new BlockedReplacementError("effect.inspect replacement requires a player and runtime ordered picks binding");
      }
      const amount = scope === "top"
        ? (args.amount === undefined ? null : planner.evaluate(args.amount))
        : null;
      if (amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
        throw new BlockedReplacementError("effect.inspect top amount must be a nonnegative integer");
      }
      const ordered = planner.context.picks(picksId).map(asObjectRef).filter((ref): ref is ObjectRef => ref !== null)
        .map(ref => currentRef(planner, ref)).filter((ref): ref is ObjectRef => ref !== null);
      const objects = scope === "top" ? ordered.slice(0, amount as number) : ordered;
      if (objects.length === 0) return [];
      return [{ type: "look", objects, player }];
    }
    case "effect.token": {
      const mode = evaluate(args.mode, "create");
      if (mode !== "create") throw new BlockedReplacementError("effect.token mode play needs a generated Chain reference and is not lowered by the replacement planner");
      if (args.token === undefined) throw new BlockedReplacementError("effect.token requires a token argument");
      const tokenValue = planner.evaluate(args.token);
      if (!isRecord(tokenValue) || typeof tokenValue.name !== "string" || !Array.isArray(tokenValue.types) ||
          !("might" in tokenValue) || !("energy" in tokenValue) || !("power" in tokenValue)) {
        throw new BlockedReplacementError("effect.token definition ids require a shared TokenSpec resolver before replacement planning");
      }
      const locationValue = evaluate(args.location, null);
      const location = locationOf(locationValue, planner);
      if (location === undefined) throw new BlockedReplacementError("effect.token replacement requires a concrete Base or Battlefield location");
      const amount = evaluate(args.amount, 1);
      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
        throw new BlockedReplacementError("effect.token amount must be a nonnegative integer");
      }
      return Array.from({ length: amount }, () => ({
        type: "create-token" as const,
        player: planner.controller,
        token: tokenValue as unknown as TokenSpec,
        to: "board" as const,
        location
      }));
    }
    case "cost.pay": return planCostPay(args, planner);
    case "choice.optional":
      throw new BlockedReplacementError("choice.optional must be represented by the replacement registration optional decision");
    case "replacement.prevent":
      throw new BlockedReplacementError("replacement.prevent is a registration declaration, not a replacement-body GameAction");
    case "replacement.play-with-additional-copy":
      throw new BlockedReplacementError("replacement.play-with-additional-copy needs an atomic Chain copy-and-play contract");
    default:
      throw new BlockedReplacementError("Unsupported replacement opcode: " + instruction.op);
  }
}

/** Plan an instruction body in order; sequencing inside a replacement is action order. */
export function planReplacementBody(
  body: readonly Instruction[],
  input: ReplacementPlanInput,
  planner: PlannerContext
): readonly GameAction[] {
  const actions: GameAction[] = [];
  for (const instruction of body) actions.push(...planInstruction(instruction, input, planner));
  return actions;
}
