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
  "damage", "score", "card-played", "card-revealed",
  "object-enters-zone", "object-leaves-chain", "object-leaves-zone", "phase-procedure"
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
  "ready", "exhausted", "characteristics", "zoneEntryId"
]);
function validatePattern(pattern: Readonly<Record<string, unknown>>): void {
  const allowedTopLevel = new Set([
    "event", "type", "kind", "filter", "object", "player", "fromZone", "toZone", "notFromZone", "procedure"
  ]);
  if (Object.keys(pattern).some(key => !allowedTopLevel.has(key))) {
    throw new BlockedReplacementError("replacement.event contains an unsupported event pattern key");
  }
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
  // Card IR stores this structural list in a constant expression. The
  // interpreter evaluates that wrapper before dispatch, while the binder also
  // accepts the same shape directly. Keep one closed instruction-body check.
  if (!Array.isArray(value) || !value.every(item =>
    isRecord(item) && typeof item.id === "string" && typeof item.op === "string" && isRecord(item.args)
  )) {
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

function paymentDescriptor(ctx: ResolveContext, value: Expr | Value | undefined): Record<string, unknown> | null {
  if (value === undefined) return null;
  const cost = evaluated(ctx, value);
  if (!isRecord(cost) || Array.isArray(cost.payments) ||
      Object.keys(cost).some(key => !["energy", "power", "xp", "payments", "domain"].includes(key))) {
    throw new BlockedReplacementError("replacement.event cost must be an energy/power/xp payment descriptor");
  }
  if (cost.energy !== undefined && (typeof cost.energy !== "number" || !Number.isSafeInteger(cost.energy) || cost.energy < 0)) {
    throw new BlockedReplacementError("replacement.event cost energy must be a nonnegative integer");
  }
  if (cost.xp !== undefined && (typeof cost.xp !== "number" || !Number.isSafeInteger(cost.xp) || cost.xp < 0)) {
    throw new BlockedReplacementError("replacement.event cost xp must be a nonnegative integer");
  }
  const normalized: Record<string, unknown> = { ...cost };
  if (normalized.domain !== undefined) {
    if (typeof normalized.domain !== "string" || normalized.power === undefined) {
      throw new BlockedReplacementError("replacement.event cost domain requires a Power amount");
    }
    const amount = normalized.power;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      throw new BlockedReplacementError("replacement.event cost Power amount must be a nonnegative integer");
    }
    normalized.power = Array.from({ length: amount }, () => normalized.domain);
    delete normalized.domain;
  }
  return normalized;
}

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
    const object = args.object === undefined ? undefined : evaluated(ctx, args.object);
    const cost = paymentDescriptor(ctx, args.cost);
    if (cost !== null) {
      const normalizedCost = cost;
      // Expose the payment as a structural instruction. The binder lowers it
      // only when the replacement is actually applied; this declaration does
      // not execute the cost while registering the window.
      const bodyWithCost: readonly Instruction[] = [
        { id: `${ctx.source.ref.id}.replacement.event.pay`, op: "cost.pay", args: { payments: constant(normalizedCost as Value) } },
        ...instead
      ];
      const declaration: Instruction = {
        id: `${ctx.source.ref.id}.replacement.event`,
        op: "replacement.event",
        args: {
          event: constant(event as unknown as Value),
          window: constant(window),
          optional: constant(optional),
          instead: constant(bodyWithCost as unknown as Value)
        }
      };
      const bound = bindWithDuration(ctx, { replaces: {}, with: [declaration] }, lifetime, registration => ({
        ...registration,
        optional: optional || registration.optional === true
      }));
      return {
        status: "executed",
        events: [],
        linkedValues: { replacementId: bound.id, duration: lifetime, window, costExposed: true }
      };
    }
    if (object !== undefined) {
      const targetId = typeof object === "string"
        ? object
        : isRecord(object) && object.kind === "target" && typeof object.id === "string"
          ? object.id
          : isRecord(object) && typeof object.target === "string"
            ? object.target
            : undefined;
      if (targetId !== undefined) {
        const refs = ctx.targets(targetId);
        if (refs.length !== 1) throw new BlockedReplacementError("replacement.event object requires one finalized target");
        const ref = refs[0]!;
        const filters = isRecord(event.filter) ? { ...event.filter } : {};
      const declarationPattern = {
          ...event,
        filter: { ...filters, objectId: ref.id, zoneEntryId: ref.zoneEntryId }
        };
      const payment = cost;
      const boundBody = payment === null
        ? instead
        : [{ id: `${ctx.source.ref.id}.replacement.event.pay`, op: "cost.pay", args: { payments: constant(payment as Value) } }, ...instead];
        const declaration: Instruction = {
          id: `${ctx.source.ref.id}.replacement.event`,
          op: "replacement.event",
          args: {
            event: constant(declarationPattern as unknown as Value),
            window: constant(window),
            optional: constant(optional),
            instead: constant(boundBody as unknown as Value)
          }
        };
        const bound = bindWithDuration(ctx, { replaces: {}, with: [declaration] }, lifetime, registration => ({
          ...registration,
          optional: optional || registration.optional === true
        }));
        return {
          status: "executed",
          events: [],
          linkedValues: { replacementId: bound.id, duration: lifetime, window }
        };
      }
      if (isRecord(object) && (object.kind === "source" || object.kind === "self")) {
        // Source is resolved by the binder at application time; no extra filter
        // is needed because the host incarnation is the registration source.
      } else {
        throw new BlockedReplacementError(
          "replacement.event object binding supports one finalized target or source; other selectors are not approximated"
        );
      }
    }
    const declaration: Instruction = {
      id: `${ctx.source.ref.id}.replacement.event`,
      op: "replacement.event",
      args: {
        event: constant(event as unknown as Value),
        window: constant(window),
        optional: constant(optional),
        // Keep the structural body inside an Expr, matching CardProgram IR and
        // the interpreter's argument boundary. The binder unwraps this exact
        // constant field when evaluating the declaration.
        instead: constant((cost === null
          ? instead
          : [{ id: `${ctx.source.ref.id}.replacement.event.pay`, op: "cost.pay", args: { payments: constant(cost as Value) } }, ...instead]) as unknown as Value)
      }
    };
    const ability: ReplacementAbilityInput = { replaces: {}, with: [declaration] };
    const bound = bindWithDuration(ctx, ability, lifetime, registration => ({
      ...registration,
      optional: optional || registration.optional === true
    }));
    return {
      status: "executed",
      events: [],
      linkedValues: { replacementId: bound.id, duration: lifetime, window }
    };
  }
} satisfies InstructionDef<ReplacementEventArgs>;

export default replacementEvent;
