import type {
  Expr,
  GameAction,
  Instruction,
  ObjectRef,
  Value,
  ZoneDestination
} from "../effects/contract.js";
import type { ObjectSelector } from "@riftbound/card-dsl";
import { BlockedReplacementError, REPLACED_EVENT_LINK, type ReplacementHostAdapter, type ReplacementPlanInput } from "./types.js";

/** The bound context this planner plans against (no pipeline execution). */
export interface PlannerContext {
  readonly host: ReplacementHostAdapter;
  readonly controller: string;
  readonly evaluate: (expr: Expr) => Value;
}

/** Permanents live at their controller's base unless the card names a spot. */
function locationFor(controller: string): Extract<GameAction, { type: "move-zone" }>["location"] {
  return { type: "base", player: controller };
}

function asObjectRef(value: unknown): ObjectRef | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if ("id" in value && "zoneEntryId" in value) return value as unknown as ObjectRef;
  return null;
}

/**
 * Resolve a body object selector. Static spellings stay static (the card
 * names "me"/"it" at bind time); runtime spellings resolve through the
 * plan-time object value (CR 805.6 source, CR 355.10.c it).
 */
function selectorRef(selector: unknown, input: ReplacementPlanInput, evaluate: (expr: Expr) => Value): ObjectRef {
  if (selector === "self" || selector === "source") return input.hostRef;
  if (typeof selector === "object" && selector !== null && !Array.isArray(selector)) {
    if ("linked" in selector && selector.linked === REPLACED_EVENT_LINK) {
      if (!input.replacedObject) throw new BlockedReplacementError("replacement body has no replaced-event object binding");
      return input.replacedObject;
    }
    if ("kind" in selector) {
      const kind = (selector as { kind: unknown }).kind;
      if (kind === "source" || kind === "self") return input.hostRef;
      if (kind === "target" || kind === "pick") {
        const id = (selector as { target?: unknown; id?: unknown }).target ?? (selector as { id?: unknown }).id;
        if (typeof id === "string") return selectorRef({ target: id }, input, evaluate);
      }
      if (kind === "linked" || kind === "linked-value") {
        const key = (selector as { instructionId?: unknown; key?: unknown }).instructionId ?? (selector as { key?: unknown }).key;
        if (typeof key === "string") return selectorRef({ linked: key }, input, evaluate);
      }
    }
    if ("target" in selector || "pick" in selector || "linked" in selector) return selectorRef(selector as ObjectSelector, input, evaluate);
  }
  const value = asObjectRef(evaluate({ kind: "constant", value: selector as Value }));
  if (value) return value;
  throw new BlockedReplacementError("Unsupported object selector in replacement body: " + JSON.stringify(selector));
}

/** Convert effect.* object arguments into the action's ObjectRef spelling. */
function objectRefFromValue(value: Value, input: ReplacementPlanInput, evaluate: (expr: Expr) => Value): ObjectRef {
  if (typeof value === "object" && value !== null && "id" in value && "zoneEntryId" in value) {
    return value as unknown as ObjectRef;
  }
  if (typeof value === "object" && value !== null && "kind" in value) {
    return selectorRef(value, input, evaluate);
  }
  if (typeof value === "object" && value !== null && ("target" in value || "pick" in value || "linked" in value)) {
    return selectorRef(value, input, evaluate);
  }
  throw new BlockedReplacementError("Unsupported object-valued replacement argument: " + JSON.stringify(value));
}

function destinationOf(value: Value): ZoneDestination {
  if (typeof value === "string") return value as ZoneDestination;
  if (typeof value === "object" && value !== null && "type" in value) return (value as { type: ZoneDestination }).type;
  throw new BlockedReplacementError("Unsupported zone destination in replacement body");
}

const objectSelectorArg = (value: unknown): boolean =>
  typeof value === "string" ||
  (typeof value === "object" && value !== null && !Array.isArray(value) &&
    ("target" in value || "pick" in value || "linked" in value || "kind" in value || ("id" in value && "zoneEntryId" in value)));

/**
 * Plan one instruction as a GameAction without executing it. Only opcodes
 * with a closed GameAction mapping are supported; everything else throws
 * BlockedReplacementError so callers keep judge-required semantics.
 */
export function planInstruction(
  instruction: Instruction,
  input: ReplacementPlanInput,
  planner: PlannerContext
): readonly GameAction[] {
  const args = instruction.args as Readonly<Record<string, Expr>>;
  if (instruction.condition && !planner.evaluate(instruction.condition as unknown as Expr)) {
    return [];
  }
  const evaluate = (expr: Expr | undefined, fallback: Value): Value => expr === undefined ? fallback : planner.evaluate(expr);
  const ref = (value: unknown): ObjectRef => objectRefFromValue(value as Value, input, planner.evaluate);
  const refArg = (expr: Expr | undefined, fallback: Value): ObjectRef => ref(evaluate(expr, fallback));
  switch (instruction.op) {
    case "effect.ready":
    case "effect.exhaust": {
      const target = (args.objects ?? args.target) as unknown;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.ready/effect.exhaust requires an object selector");
      const object = refArg(target as Expr, null);
      return [{ type: instruction.op === "effect.ready" ? "ready" : "exhaust", object }];
    }
    case "effect.move": {
      const mode = evaluate(args.mode, null);
      if (mode === "recall") throw new BlockedReplacementError("effect.move mode 'recall' is blocked (CR 457-460): no Recall action exists");
      if (args.objects === undefined || args.to === undefined) throw new BlockedReplacementError("effect.move requires objects and to arguments");
      const objects = planner.evaluate(args.objects);
      const destination = destinationOf(planner.evaluate(args.to));
      const list = Array.isArray(objects) ? objects : [objects];
      return list.map(object => ({
        type: "move-zone" as const,
        object: ref(object),
        to: destination,
        ...(destination === "base" ? { location: locationFor(planner.controller) } : {})
      }));
    }
    case "effect.zone": {
      const target = args.target;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.zone target must be an object selector spelling");
      if (args.to === undefined) throw new BlockedReplacementError("effect.zone requires a to argument");
      const object = refArg(target, null);
      const destination = destinationOf(planner.evaluate(args.to));
      return [{
        type: "move-zone",
        object,
        to: destination,
        ...(destination === "base" ? { location: locationFor(planner.controller) } : {})
      }];
    }
    case "effect.damage": {
      const target = args.target;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.damage target must be an object selector spelling");
      const amount = evaluate(args.amount, 0);
      if (amount === null || amount === "opponent" || typeof amount === "object" || Number(amount) <= 0) {
        throw new BlockedReplacementError("effect.damage amount must be a positive number");
      }
      return [{
        type: "damage",
        source: selectorRef("source", input, planner.evaluate),
        target: refArg(target, null),
        amount: Number(amount),
        combat: false
      }];
    }
    case "effect.draw": {
      const player = evaluate(args.target, planner.controller);
      if (typeof player !== "string") throw new BlockedReplacementError("effect.draw target must be a player id");
      const amount = evaluate(args.amount, 1);
      if (amount === null || typeof amount !== "number" || amount < 0) throw new BlockedReplacementError("effect.draw amount must be a nonnegative number");
      return [{ type: "draw", player, amount }];
    }
    case "effect.heal": {
      const target = args.objects ?? args.target;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.heal target must be an object selector spelling");
      const amount = evaluate(args.amount, 1);
      if (amount === null || typeof amount !== "number" || amount < 0) throw new BlockedReplacementError("effect.heal amount must be a nonnegative number");
      return [{ type: "heal", object: refArg(target, null), amount }];
    }
    case "effect.resources": {
      const energy = evaluate(args.energy, 0);
      if (energy === null || typeof energy !== "number" || energy < 0) throw new BlockedReplacementError("effect.resources energy must be a nonnegative number");
      return [{ type: "gain-energy", player: planner.controller, amount: energy }];
    }
    case "effect.buff": {
      const mode = evaluate(args.mode, "add");
      const target = args.target;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.buff target must be an object selector spelling");
      const amount = evaluate(args.amount, 1);
      if (amount === null || typeof amount !== "number" || amount < 0) throw new BlockedReplacementError("effect.buff amount must be a nonnegative number");
      const object = refArg(target, null);
      return [mode === "spend" ? { type: "spend-buff", object, amount } : { type: "buff", object, amount }];
    }
    case "effect.counter": {
      const object = evaluate(args.target, null);
      const counter = evaluate(args.counter, null);
      const amount = evaluate(args.amount, 1);
      if (object === null || typeof object !== "object" || counter === null || typeof counter !== "string") {
        throw new BlockedReplacementError("effect.counter requires an object value and a counter name");
      }
      if (amount === null || typeof amount !== "number" || amount < 0) throw new BlockedReplacementError("effect.counter amount must be a nonnegative number");
      return [{ type: "add-counter", object: ref(object), counter, amount }];
    }
    case "effect.kill": {
      const target = args.target;
      if (!objectSelectorArg(target)) throw new BlockedReplacementError("effect.kill target must be an object selector spelling");
      return [{ type: "kill", object: refArg(target, null) }];
    }
    default:
      throw new BlockedReplacementError("Unsupported replacement opcode: " + instruction.op);
  }
}

/**
 * Plan an instruction body in order; sequencing inside a replacement is the
 * action list order. Per-instruction conditions gate single instructions.
 */
export function planReplacementBody(
  body: readonly Instruction[],
  input: ReplacementPlanInput,
  planner: PlannerContext
): readonly GameAction[] {
  const actions: GameAction[] = [];
  for (const instruction of body) actions.push(...planInstruction(instruction, input, planner));
  return actions;
}
