/**
 * Create or play a fixed token from the CR v1.5 187 catalog.
 *
 * The catalog lives under `effects/tokens` so type, tags, Might, printed costs,
 * keywords, default entry state, and intrinsic-ability support are reviewed in
 * one place. `energy` and `power` stay null because tokens have no printed
 * cost (185.3.a); null is never rewritten to zero.
 *
 * A destination may be a concrete LocationRef, a LocationSelector/LocationExpr,
 * a query descriptor, a target/pick object's live location, or a set of legal
 * locations. Omitting every destination means the normal Play locations from
 * 355.2.a: the ability controller's Base and Battlefields they control. A
 * multi-option set is selected deterministically through `ctx.choose`.
 *
 * Units default to exhausted entry (143.4); Gear defaults to ready (359.2.d).
 * A creating effect may override that state under 184.1/185.2.d through
 * `entersReady` or `entersExhausted`. The override is attached to the runtime
 * TokenSpec so hosts that carry the additive field observe it. The frozen
 * shared TokenSpec/create-token type has no field yet, so the final response
 * records the exact contract change request.
 *
 * `mode: "play"` creates each token on the Chain and hands that actual
 * ObjectRef to Play one at a time (440.2.c / 185.2.a / 350.2 / 354). `mode:
 * "create"` creates directly on the Board (440.2). The primitive does not
 * advance priority or pretend a follow-up Exhaust/Ready action is an entry
 * stipulation.
 */
import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  LocationRef,
  ObjectRef,
  ResolveContext,
  TokenSpec,
  Value
} from "../contract.js";
import {
  queryLocationCandidates,
  resolveLocationSelector,
  sameLocation
} from "../../target/location/index.js";
import { getTokenDefinition, type TokenEntryState } from "../tokens/definitions.js";

export interface TokenArgs {
  readonly token: Expr;
  readonly amount?: Expr;
  readonly mode?: Expr;
  readonly location?: Expr;
  readonly target?: Expr;
  readonly pick?: Expr;
  readonly locations?: Expr;
  readonly choiceId?: Expr;
  readonly entersReady?: Expr;
  readonly entersExhausted?: Expr;
  readonly linkKey?: Expr;
}

type RuntimeTokenSpec = TokenSpec & { readonly exhausted: boolean };

const ARGUMENTS = new Set([
  "token", "amount", "mode", "location", "target", "pick", "locations",
  "choiceId", "entersReady", "entersExhausted", "linkKey"
]);
const DESTINATIONS = ["location", "target", "pick", "locations"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isString(value.id) && Number.isSafeInteger(value.zoneEntryId) && Number(value.zoneEntryId) >= 0;
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant":
    case "literal":
      return Object.hasOwn(value, "value") && isValue(value.value);
    case "location":
      return Object.hasOwn(value, "value") && isValue(value.value);
    case "object-property":
      return isObjectRef(value.object) && isString(value.property);
    case "object-attribute":
      return isObjectRef(value.object) && isString(value.attribute);
    case "linked":
    case "linked-value":
      return isString(value.instructionId) && (value.key === undefined || isString(value.key));
    case "count":
      return isString(value.subject) && (value.filter === undefined || isRecord(value.filter) && isValue(value.filter));
    case "arithmetic": {
      if (!isValue(value) || !Array.isArray(value.operands) || !value.operands.every(operand => isExpr(operand))) return false;
      switch (value.operator) {
        case "add": case "mul": case "multiply": case "min": case "max":
          return value.operands.length >= 1;
        case "sub": case "subtract": case "div": case "divide":
          return value.operands.length === 2;
        case "neg":
          return value.operands.length === 1;
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

function parseArgs(value: unknown): TokenArgs {
  if (!isRecord(value) || !Object.hasOwn(value, "token")) throw new TypeError("effect.token requires a token expression");
  for (const [key, expression] of Object.entries(value)) {
    if (!ARGUMENTS.has(key) || !isExpr(expression)) throw new TypeError(`Invalid effect.token argument: ${key}`);
  }
  if (DESTINATIONS.filter(key => Object.hasOwn(value, key)).length > 1) {
    throw new TypeError("effect.token accepts at most one destination argument");
  }
  if (!DESTINATIONS.some(key => Object.hasOwn(value, key)) &&
      !Object.hasOwn(value, "amount") && !Object.hasOwn(value, "mode")) {
    throw new TypeError("effect.token requires a destination argument");
  }
  if (Object.hasOwn(value, "choiceId") && !Object.hasOwn(value, "locations")) {
    throw new TypeError("effect.token choiceId is used only with locations");
  }
  if (Object.hasOwn(value, "locations") && !Object.hasOwn(value, "choiceId")) {
    throw new TypeError("effect.token locations requires a choiceId");
  }
  return { ...value } as unknown as TokenArgs;
}

function isLocation(value: unknown): value is LocationRef {
  return isRecord(value) && (value.type === "base" && isString(value.player) || value.type === "battlefield" && isString(value.id));
}

function isConcreteLocation(value: unknown): value is LocationRef {
  return isLocation(value) && !(value.type === "base" && ["self", "controller", "opponent", "uncontrolled"].includes(value.player));
}

function addUnique(target: LocationRef[], candidates: readonly LocationRef[]): void {
  for (const candidate of candidates) {
    if (!target.some(existing => sameLocation(existing, candidate))) target.push(candidate);
  }
}

function locationOptions(ctx: ResolveContext, value: Value): LocationRef[] | null {
  const source = Array.isArray(value) ? value : [value];
  const result: LocationRef[] = [];
  for (const item of source) {
    if (Array.isArray(item)) {
      const nested = locationOptions(ctx, item);
      if (nested === null) return null;
      addUnique(result, nested);
      continue;
    }
    if (isRecord(item) && item.kind === "query") {
      if (!isRecord(item.filter)) return null;
      addUnique(result, queryLocationCandidates(ctx, item.filter as never));
      continue;
    }
    if (isRecord(item) && item.type === "battlefield" && Object.hasOwn(item, "id") && !isString(item.id)) {
      return null;
    }
    if (isRecord(item) && item.type === "base" && Object.hasOwn(item, "player") && !isString(item.player)) {
      return null;
    }
    try {
      const resolved = resolveLocationSelector(item, {
        context: ctx,
        host: ctx.source.ref,
        linked: id => ctx.linked(id)
      });
      addUnique(result, [resolved]);
      continue;
    } catch {
      // A LocationFilter is a candidate query, not a concrete LocationRef.
    }
    if (isRecord(item) && ("kind" in item || "controller" in item || "open" in item || "occupied" in item)) {
      try {
        addUnique(result, queryLocationCandidates(ctx, item as never));
        continue;
      } catch {
        // A concrete Base with a symbolic player reaches the explicit
        // controller-relative resolution above; a malformed concrete shape
        // remains invalid rather than being reinterpreted as a query.
        return null;
      }
    }
    if (isConcreteLocation(item)) {
      addUnique(result, [item]);
      continue;
    }
    return null;
  }
  return result;
}

function defaultLocations(ctx: ResolveContext, gear: boolean): LocationRef[] {
  if (gear) return [{ type: "base", player: ctx.controller }];
  return [
    { type: "base", player: ctx.controller },
    ...queryLocationCandidates(ctx, { type: "battlefield", controller: "controller" })
  ];
}

function chooseLocation(
  ctx: ResolveContext,
  options: readonly LocationRef[],
  choiceId: string
): LocationRef | null {
  if (options.length === 1) return options[0]!;
  const answer = ctx.choose<LocationRef>({
    id: choiceId,
    type: "mode",
    chooser: ctx.controller,
    visibility: "public",
    options
  });
  return isLocation(answer) && options.some(option => sameLocation(option, answer))
    ? options.find(option => sameLocation(option, answer))!
    : null;
}

function entryState(ctx: ResolveContext, args: TokenArgs, definitionDefault: TokenEntryState): TokenEntryState | null {
  const ready = args.entersReady === undefined ? undefined : ctx.evaluate(args.entersReady);
  const exhausted = args.entersExhausted === undefined ? undefined : ctx.evaluate(args.entersExhausted);
  if (ready !== undefined && typeof ready !== "boolean") return null;
  if (exhausted !== undefined && typeof exhausted !== "boolean") return null;
  const requested: TokenEntryState | undefined = ready !== undefined
    ? (ready ? "ready" : "exhausted")
    : exhausted !== undefined
      ? (exhausted ? "exhausted" : "ready")
      : undefined;
  if (ready !== undefined && exhausted !== undefined && requested !== (exhausted ? "exhausted" : "ready")) return null;
  return requested ?? definitionDefault;
}

function currentObject(ctx: ResolveContext, ref: ObjectRef): ReturnType<ResolveContext["object"]> {
  return ctx.object(ref) ?? ctx.query({}).find(object => object.ref.id === ref.id) ?? null;
}

function run(ctx: ResolveContext, args: TokenArgs): InstructionResult {
  const linkKey = args.linkKey === undefined ? "token" : ctx.evaluate(args.linkKey);
  if (!isString(linkKey)) return { status: "negated", reason: "impossible", events: [] };

  const events: GameEvent[] = [];
  const objects: ObjectRef[] = [];
  const createdObjects: ObjectRef[] = [];
  let created = 0;
  let completed = 0;
  let playing = false;
  const linkReceipt = (blockedReason?: string): Record<string, Value> => {
    const references = objects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
    const receipt: Value = {
      amount: completed,
      objects: references,
      objectsComplete: objects.length === completed,
      ...(playing ? { createdAmount: created, createdObjects: createdObjects.map(ref => ({ ...ref })) } : {}),
      ...(blockedReason === undefined ? {} : { blockedReason })
    };
    const linkedValues: Record<string, Value> = { [linkKey]: receipt, [`${linkKey}.amount`]: completed, [`${linkKey}.objects`]: references };
    if (playing) {
      linkedValues[`${linkKey}.createdAmount`] = created;
      linkedValues[`${linkKey}.createdObjects`] = createdObjects.map(ref => ({ ...ref }));
    }
    for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
    return linkedValues;
  };
  const negate = (reason: "replaced" | "impossible" = "impossible", blockedReason?: string): InstructionResult => {
    linkReceipt(blockedReason);
    return { status: "negated", reason, events };
  };

  let locations: LocationRef[] = [];
  let choiceId: string | undefined;
  let dynamicLocations = false;
  let explicitConcreteLocations = false;
  if (args.target !== undefined || args.pick !== undefined) {
    const specId = ctx.evaluate((args.target ?? args.pick)!);
    if (!isString(specId)) return negate();
    const refs = args.target === undefined ? ctx.picks(specId) : ctx.targets(specId);
    for (const ref of refs) {
      if (!isObjectRef(ref)) continue;
      const object = ctx.object(ref);
      const objectLocation = object?.zone === "board" ? object.location : null;
      if (objectLocation === null) continue;
      addUnique(locations, [objectLocation]);
    }
    if (locations.length === 0 && args.target !== undefined) return { status: "ignored", reason: "mistargeted" };
    if (locations.length !== 1) return negate();
  } else if (args.location !== undefined || args.locations !== undefined) {
    const value = ctx.evaluate((args.location ?? args.locations)!);
    const options = locationOptions(ctx, value);
    if (options === null || options.length === 0) return negate();
    locations = options;
    const values = Array.isArray(value) ? value : [value];
    explicitConcreteLocations = values.length > 0 && values.every(isConcreteLocation);
    dynamicLocations = !explicitConcreteLocations;
    if (args.locations !== undefined) {
      const selectedChoiceId = ctx.evaluate(args.choiceId!);
      if (!isString(selectedChoiceId)) return negate();
      choiceId = selectedChoiceId;
    }
  } else {
    locations = [];
  }

  const amount = args.amount === undefined ? 1 : ctx.evaluate(args.amount);
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return negate();
  const mode = args.mode === undefined ? "create" : ctx.evaluate(args.mode);
  if (mode !== "create" && mode !== "play") return negate();
  playing = mode === "play";
  const definitionId = ctx.evaluate(args.token);
  const definition = typeof definitionId === "string" ? getTokenDefinition(definitionId) : undefined;
  if (definition === undefined) return negate("impossible", "token-definition-or-abilities-judge-required");
  if (definition.abilityBinding === "blocked") {
    return negate("impossible", definition.blockedReason ?? "token-definition-or-abilities-judge-required");
  }
  choiceId ??= `token-location:${ctx.source.ref.id}:${definition.id}`;
  const entry = entryState(ctx, args, definition.defaultEntry);
  if (entry === null) return negate("impossible", "token-entry-state-undefined");

  if (amount === 0) return { status: "executed", events, linkedValues: linkReceipt() };

  const isGear = definition.spec.types.includes("gear");
  if (locations.length === 0) {
    locations = defaultLocations(ctx, isGear);
    if (locations.length === 0) return negate();
    dynamicLocations = true;
  }
  if (locations.some(location => location.type === "base" && location.player !== ctx.controller)) return negate();
  if (playing && definition.spec.types.includes("unit") && dynamicLocations) {
    const legal: LocationRef[] = [
      { type: "base", player: ctx.controller },
      ...queryLocationCandidates(ctx, { type: "battlefield", controller: "controller" })
    ];
    if (locations.some(location => !legal.some(candidate => sameLocation(candidate, location)))) {
      return negate("impossible", "token-play-location-not-legal");
    }
  }
  const location = locations.length === 1 ? locations[0]! : null;

  const isUnit = definition.spec.types.includes("unit");
  const hasDeploy = definition.spec.keywords?.some(keyword => keyword.id.toLowerCase() === "deploy") === true;
  if (location !== null && isGear && !hasDeploy && location.type !== "base") return negate("impossible", "token-gear-requires-base");
  if (location !== null && isUnit && location.type === "base" && location.player !== ctx.controller) return negate();

  const token: RuntimeTokenSpec = { ...definition.spec, exhausted: entry === "exhausted" };
  for (let index = 0; index < amount; index++) {
    const requestId = dynamicLocations && amount > 1 ? `${choiceId}:${index}` : choiceId;
    const currentLocation = chooseLocation(ctx, locations, requestId);
    if (currentLocation === null) return negate();
    if (isGear && !hasDeploy && currentLocation.type !== "base") {
      return negate("impossible", "token-gear-requires-base");
    }
    const outcome = ctx.perform(playing
      ? { type: "create-token", player: ctx.controller, token, to: "chain", location: currentLocation }
      : { type: "create-token", player: ctx.controller, token, to: "board", location: currentLocation });
    events.push(...outcome.events);
    if (outcome.status !== "done") return negate(outcome.status === "replaced" ? "replaced" : "impossible");
    created++;
    if (!isObjectRef(outcome.result)) return negate("impossible", "token-creation-missing-object-ref");
    createdObjects.push(outcome.result);
    if (playing) {
      const createdRef = outcome.result;
      const played = ctx.perform({ type: "play", object: createdRef, player: ctx.controller, location: currentLocation });
      events.push(...played.events);
      if (played.status !== "done") return negate(played.status === "replaced" ? "replaced" : "impossible");
      const current = currentObject(ctx, createdRef);
      if (current === null) return negate("impossible", "token-entry-state-not-carried-by-play");
      objects.push(current.ref);
      if (current.exhausted !== (entry === "exhausted")) {
        // The shared create-token/play actions do not carry entry readiness yet.
        // Keep the state on the action receipt, then fail closed rather than
        // silently presenting a different state than the creating effect
        // stipulated. This branch is reached only by a host that dropped the
        // additive `exhausted` field during Play.
        return negate("impossible", "token-entry-state-not-carried-by-play");
      }
    } else {
      const current = currentObject(ctx, outcome.result);
      if (current === null) return negate("impossible", "token-entry-state-not-carried-by-create");
      objects.push(current.ref);
      if (current.exhausted !== (entry === "exhausted")) {
        return negate("impossible", "token-entry-state-not-carried-by-create");
      }
    }
    completed++;
  }
  return { status: "executed", events, linkedValues: linkReceipt() };
}

export default {
  op: "effect.token",
  argsSchema: { parse: parseArgs },
  execute(ctx, args) {
    return ctx.transaction === undefined ? run(ctx, args) : ctx.transaction(() => run(ctx, args));
  }
} satisfies InstructionDef<TokenArgs>;
