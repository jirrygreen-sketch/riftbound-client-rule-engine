/**
 * replacement.event — register a general event replacement.
 *
 * Matching, chooser ownership, and replacement ordering remain in the public
 * replacement binder and EventPipeline.  This primitive only evaluates the
 * declaration and installs it for the requested lifetime.
 */
import type {
  Expr,
  Instruction,
  InstructionDef,
  InstructionResult,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";
import {
  BlockedReplacementError,
  type ReplacementAbilityInput
} from "../../replacement/index.js";
import {
  bindWithDuration,
  replacementDuration,
  evaluated
} from "./replacement.enter.js";

export interface ReplacementEventArgs {
  readonly event?: Expr | Value;
  readonly instead?: Expr | Value;
  readonly optional?: Expr | Value;
  readonly window?: Expr | Value;
  readonly duration?: Expr | Value;
  /** Kept in the schema for card-data audit; target binding is not guessed. */
  readonly object?: Expr | Value;
  readonly cost?: Expr | Value;
}

const ARGUMENTS = new Set(["event", "instead", "optional", "window", "duration", "object", "cost"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isExpr(value: unknown): value is Expr { return isRecord(value) && typeof value.kind === "string"; }
function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    const valid = value.every(item => isValue(item, ancestors));
    ancestors.delete(value);
    return valid;
  }
  if (!isRecord(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}
function parseArgs(value: unknown): ReplacementEventArgs {
  if (!isRecord(value)) throw new TypeError("replacement.event args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.event argument: ${key}`);
    if (!isExpr(argument) && !isValue(argument)) throw new TypeError(`Invalid replacement.event argument: ${key}`);
  }
  return value as ReplacementEventArgs;
}
const argsSchema: Schema<ReplacementEventArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try { return { success: true, data: parseArgs(value) }; }
    catch (error) { return { success: false, error }; }
  }
};

const SUPPORTED_EVENTS = new Set([
  "object-enters-board", "object-killed", "object-readied", "object-exhausted",
  "damage", "score", "card-played", "card-revealed"
]);

function eventPattern(value: Value | undefined): Readonly<Record<string, unknown>> {
  const pattern = typeof value === "string" ? { event: value } : value;
  if (!isRecord(pattern)) throw new BlockedReplacementError("replacement.event requires an event pattern");
  validatePattern(pattern);
  const kind = pattern.event ?? pattern.type ?? pattern.kind;
  if (typeof kind !== "string" || !SUPPORTED_EVENTS.has(kind)) {
    throw new BlockedReplacementError(`Unsupported replacement.event event: ${JSON.stringify(kind)}`);
  }
  return pattern;
}
const SUPPORTED_FILTER_KEYS = new Set([
  "self", "other", "source", "target", "object", "objectId", "id", "cardId", "canonicalCardId",
  "type", "types", "tag", "tags", "zone", "location", "controller", "owner", "states", "state",
  "ready", "exhausted", "characteristics"
]);
function validatePattern(pattern: Readonly<Record<string, unknown>>): void {
  for (const key of ["filter", "object"]) {
    const value = pattern[key];
    if (!isRecord(value)) continue;
    if (Object.keys(value).some(candidate => !SUPPORTED_FILTER_KEYS.has(candidate))) {
      throw new BlockedReplacementError(`replacement.event contains an unsupported ${key} filter key`);
    }
  }
}

function body(value: Value | undefined): readonly Instruction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(item => isRecord(item) && typeof item.id === "string" && typeof item.op === "string")) {
    throw new BlockedReplacementError("replacement.event instead must be an instruction body");
  }
  return value as unknown as readonly Instruction[];
}
function bool(value: Value | undefined, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new BlockedReplacementError(`${label} must be boolean`);
  return value;
}
function windowValue(value: Value | undefined): "permanent" | "next-time-this-turn" {
  if (value === undefined || value === "permanent" || value === "forever") return "permanent";
  if (value === "next-time-this-turn" || value === "next-time") return "next-time-this-turn";
  // `this-turn` is enforced by bindWithDuration's clock guard; the binder
  // itself must see a reusable declaration rather than a one-shot window.
  if (value === "this-turn" || value === "end-of-turn") return "permanent";
  throw new BlockedReplacementError(`Unsupported replacement.event window: ${JSON.stringify(value)}`);
}
function constant(value: Value): Expr { return { kind: "constant", value }; }

const replacementEvent = {
  op: "replacement.event",
  argsSchema,
  execute(ctx: ResolveContext, args: ReplacementEventArgs): InstructionResult {
    const event = eventPattern(evaluated(ctx, args.event));
    const instead = body(evaluated(ctx, args.instead));
    const optional = bool(evaluated(ctx, args.optional), "replacement.event optional");
    const rawDuration = evaluated(ctx, args.duration);
    const rawWindow = evaluated(ctx, args.window);
    const lifetime = replacementDuration(rawDuration ?? rawWindow, "replacement.event");
    const window = windowValue(rawWindow ?? rawDuration);
    if (args.object !== undefined) {
      throw new BlockedReplacementError(
        "replacement.event object binding needs a Finalize target adapter; it is not approximated"
      );
    }
    if (args.cost !== undefined) {
      throw new BlockedReplacementError(
        "replacement.event optional cost needs the cost pipeline; it is not approximated"
      );
    }
    const declaration: Instruction = {
      id: `${ctx.source.ref.id}.replacement.event`,
      op: "replacement.event",
      args: {
        event: constant(event as unknown as Value),
        window: constant(window),
        optional: constant(optional),
        instead: instead as unknown as Expr
      }
    };
    const ability: ReplacementAbilityInput = { replaces: {}, with: [declaration] };
    const bound = bindWithDuration(ctx, ability, lifetime);
    return {
      status: "executed",
      events: [],
      linkedValues: { replacementId: bound.id, duration: lifetime, window }
    };
  }
} satisfies InstructionDef<ReplacementEventArgs>;

export default replacementEvent;
