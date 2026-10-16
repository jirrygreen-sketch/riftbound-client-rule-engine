/**
 * Create tokens through the frozen primitive action boundary (CR v1.5).
 *
 * All arguments are card-dsl Expr values. `token` evaluates to a definition id:
 * recruit (187.1), sand-soldier (187.3), mech (187.4), reflection (187.6), or
 * tentacle (187.10). These definitions have no additional abilities. Definitions
 * requiring other abilities, including Gold, remain blocked/judge-required.
 * `amount` is a nonnegative safe integer (default 1); tokens do not consume a
 * finite supply of cards or printed token markers (181). Costs stay null (185.3).
 *
 * Exactly one destination argument is required: `location` evaluates to a legal
 * LocationRef supplied by target.location; `target` evaluates to a TargetSpec id
 * whose surviving Board object supplies its location (198.2, 199.1); `pick`
 * evaluates to a PickSpec id for the same non-target selection; or `locations`
 * evaluates to legal LocationRef options. The last form requires `choiceId`, a
 * stable public resolution-time choice id. A target/pick must resolve to exactly
 * one location. Only the controller's base is a legal unit base destination.
 *
 * `mode` is create (default) or play. Creating directly to the Board is 440.2;
 * playing a NEW token creates it on the Chain (440.2.c, 185.2.a, 186, 350.2,
 * 354), then hands the returned ObjectRef to perform(play). The action owns
 * Pending/Finalize and priority; this primitive never advances them. Creating
 * on the Board then playing would add an incorrect Board entry. effect.zone handles
 * existing objects; effect.play handles already existing playable objects.
 * Token ownership/control is the ability controller (182, 183, 440.4). Entry
 * exhaustion belongs to the creation/play actions (143.4, 185.2.d); a later exhaust action
 * cannot substitute for entering exhausted. Entry overrides are not supported.
 *
 * `linkKey` defaults to token. Its receipt contains the actual successful create
 * or play count (`amount`), current object references after that action (`objects`),
 * and `objectsComplete` (an object may no longer exist after the handoff).
 * In play mode, `createdAmount` and `createdObjects` separately retain Chain
 * creation receipts, even if a later play is negated. These creation references
 * become stale when play changes zones; current refs are read, never guessed.
 * Unsupported paths add `blockedReason`.
 * `<linkKey>.amount` and `<linkKey>.objects` also expose those values directly to
 * EffectIR linked expressions, including numeric "if you do" conditions.
 * A partial negation retains its actual earlier creations and their events.
 */
import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  LocationRef,
  ObjectRef,
  TokenSpec,
  Value
} from "../contract.js";

export interface TokenArgs {
  readonly token: Expr;
  readonly amount?: Expr;
  readonly mode?: Expr;
  readonly location?: Expr;
  readonly target?: Expr;
  readonly pick?: Expr;
  readonly locations?: Expr;
  readonly choiceId?: Expr;
  readonly linkKey?: Expr;
}

const DEFINITIONS = new Map<string, TokenSpec>([
  ["recruit", { cardId: null, name: "Recruit", types: ["unit"], tags: ["Recruit"], might: 1, energy: null, power: null }],
  ["sand-soldier", { cardId: null, name: "Sand Soldier", types: ["unit"], tags: ["Shurima"], might: 2, energy: null, power: null }],
  ["mech", { cardId: null, name: "Mech", types: ["unit"], tags: ["Mech"], might: 3, energy: null, power: null }],
  ["reflection", { cardId: null, name: "Reflection", types: ["unit"], tags: [], might: 0, energy: null, power: null }],
  ["tentacle", { cardId: null, name: "Tentacle", types: ["unit"], tags: ["Bilgewater"], might: 1, energy: null, power: null }]
]);

const ARGUMENTS = new Set(["token", "amount", "mode", "location", "target", "pick", "locations", "choiceId", "linkKey"]);
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
  if (DESTINATIONS.filter(key => Object.hasOwn(value, key)).length !== 1) {
    throw new TypeError("effect.token requires exactly one destination argument");
  }
  if (Object.hasOwn(value, "locations") !== Object.hasOwn(value, "choiceId")) {
    throw new TypeError("effect.token locations requires a choiceId, used only with locations");
  }
  return { ...value } as unknown as TokenArgs;
}

function isLocation(value: unknown): value is LocationRef {
  return isRecord(value) && (value.type === "base" && isString(value.player) || value.type === "battlefield" && isString(value.id));
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return left.type === "base"
    ? right.type === "base" && left.player === right.player
    : right.type === "battlefield" && left.id === right.id;
}

export default {
  op: "effect.token",
  argsSchema: { parse: parseArgs },
  execute(ctx, args) {
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
    if (args.target !== undefined || args.pick !== undefined) {
      const specId = ctx.evaluate((args.target ?? args.pick)!);
      if (!isString(specId)) return negate();
      const refs = args.target === undefined ? ctx.picks(specId) : ctx.targets(specId);
      for (const ref of refs) {
        if (!isObjectRef(ref)) continue;
        const object = ctx.object(ref);
        const objectLocation = object?.zone === "board" ? object.location : null;
        if (objectLocation === null) continue;
        if (!locations.some(location => sameLocation(location, objectLocation))) locations.push(objectLocation);
      }
      if (locations.length === 0 && args.target !== undefined) return { status: "ignored", reason: "mistargeted" };
      if (locations.length !== 1) return negate();
    } else {
      const value = ctx.evaluate((args.location ?? args.locations)!);
      const options = args.locations === undefined ? [value] : value;
      if (!Array.isArray(options) || options.length === 0 || !options.every(isLocation)) return negate();
      locations = options;
    }
    if (locations.some(location => location.type === "base" && location.player !== ctx.controller)) return negate();

    const amount = args.amount === undefined ? 1 : ctx.evaluate(args.amount);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return negate();
    const mode = args.mode === undefined ? "create" : ctx.evaluate(args.mode);
    if (mode !== "create" && mode !== "play") return negate();
    playing = mode === "play";
    const definitionId = ctx.evaluate(args.token);
    const definition = typeof definitionId === "string" ? DEFINITIONS.get(definitionId) : undefined;
    if (definition === undefined) return negate("impossible", "token-definition-or-abilities-judge-required");

    if (amount === 0) return { status: "executed", events, linkedValues: linkReceipt() };
    let location = locations[0]!;
    if (args.locations !== undefined) {
      const choiceId = ctx.evaluate(args.choiceId!);
      if (!isString(choiceId)) return negate();
      if (locations.length > 1) {
        location = ctx.choose<LocationRef>({
          id: choiceId,
          type: "mode",
          chooser: ctx.controller,
          visibility: "public",
          options: locations
        });
        if (!isLocation(location) || !locations.some(option => sameLocation(option, location))) return negate();
      }
    }
    for (let index = 0; index < amount; index++) {
      const outcome = ctx.perform(playing
        ? { type: "create-token", player: ctx.controller, token: definition, to: "chain" }
        : { type: "create-token", player: ctx.controller, token: definition, to: "board", location });
      events.push(...outcome.events);
      if (outcome.status !== "done") return negate(outcome.status === "replaced" ? "replaced" : "impossible");
      created++;
      if (isObjectRef(outcome.result)) createdObjects.push(outcome.result);
      if (playing) {
        if (!isObjectRef(outcome.result)) return negate("impossible", "token-creation-missing-object-ref");
        const createdRef = outcome.result;
        const played = ctx.perform({ type: "play", object: createdRef, player: ctx.controller, location });
        events.push(...played.events);
        if (played.status !== "done") return negate(played.status === "replaced" ? "replaced" : "impossible");
        const current = ctx.object(createdRef) ?? ctx.query({}).find(object => object.ref.id === createdRef.id);
        if (current !== undefined && current !== null) objects.push(current.ref);
      } else if (isObjectRef(outcome.result)) {
        objects.push(outcome.result);
      }
      completed++;
    }
    return { status: "executed", events, linkedValues: linkReceipt() };
  }
} satisfies InstructionDef<TokenArgs>;
