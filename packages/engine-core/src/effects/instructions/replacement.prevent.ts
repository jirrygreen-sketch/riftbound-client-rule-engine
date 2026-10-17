/**
 * replacement.prevent — install a damage prevention replacement.
 *
 * The EventPipeline still owns candidate ordering and optional choices.  The
 * matcher is the same public replacement matcher used by ability bindings.
 * Numeric prevention rewrites the pending damage action; "all" prevents it.
 */
import type {
  Expr,
  GameAction,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  ObjectSnapshot,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";
import {
  actionMatchesEventPattern,
  BlockedReplacementError,
  REPLACEMENT_ACTIVE_ZONES,
  type ReplacementDependencies
} from "../../replacement/index.js";
import type { ReplacementRegistration } from "../../events/pipeline-types.js";
import {
  evaluated,
  replacementDependencies,
  type ReplacementDuration
} from "./replacement.enter.js";

export interface ReplacementPreventArgs {
  readonly event?: Expr | Value;
  readonly amount?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly scope?: Expr | Value;
  readonly appliesTo?: Expr | Value;
  readonly target?: Expr | Value;
  readonly optional?: Expr | Value;
}

const ARGUMENTS = new Set(["event", "amount", "duration", "scope", "appliesTo", "target", "optional"]);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
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
function parseArgs(value: unknown): ReplacementPreventArgs {
  if (!isRecord(value)) throw new TypeError("replacement.prevent args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.prevent argument: ${key}`);
    if (!isExpr(argument) && !isValue(argument)) throw new TypeError(`Invalid replacement.prevent argument: ${key}`);
  }
  return value as ReplacementPreventArgs;
}
const argsSchema: Schema<ReplacementPreventArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try { return { success: true, data: parseArgs(value) }; }
    catch (error) { return { success: false, error }; }
  }
};

const SUPPORTED_FILTER_KEYS = new Set([
  "self", "other", "source", "target", "object", "objectId", "id", "cardId", "canonicalCardId",
  "type", "types", "tag", "tags", "zone", "location", "controller", "owner", "states", "state",
  "ready", "exhausted", "characteristics"
]);
function validateFilter(value: Value | undefined, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new BlockedReplacementError(`replacement.prevent ${label} must be an event filter`);
  if (Object.keys(value).some(key => !SUPPORTED_FILTER_KEYS.has(key))) {
    throw new BlockedReplacementError(`replacement.prevent contains an unsupported ${label} filter key`);
  }
}

function eventPattern(value: Value | undefined): Readonly<Record<string, unknown>> {
  if (value === undefined) return { event: "damage" };
  if (typeof value === "string") return { event: value };
  if (!isRecord(value)) throw new BlockedReplacementError("replacement.prevent event must be a pattern");
  const filters = [value.filter, value.object, value.appliesTo]
    .map(item => isRecord(item) ? item as unknown as Record<string, unknown> : null)
    .filter(item => item !== null) as readonly Record<string, unknown>[];
  if (filters.some(filter => Object.keys(filter).some(key => !SUPPORTED_FILTER_KEYS.has(key)))) {
    throw new BlockedReplacementError("replacement.prevent contains an unsupported event filter key");
  }
  return value;
}
function amount(value: Value | undefined): number | "all" {
  if (value === undefined || value === "all") return "all";
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BlockedReplacementError("replacement.prevent amount must be all or a nonnegative integer");
  }
  return value;
}
function bool(value: Value | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new BlockedReplacementError("replacement.prevent optional must be boolean");
  return value;
}
function duration(value: Value | undefined): ReplacementDuration {
  if (value === undefined || value === "permanent" || value === "forever") return "permanent";
  if (value === "this-turn" || value === "end-of-turn") return "this-turn";
  if (value === "one-shot-this-turn" || value === "next-time-this-turn" || value === "next-time") return "next-time-this-turn";
  throw new BlockedReplacementError(`Unsupported replacement.prevent duration: ${JSON.stringify(value)}`);
}
const preventOrdinals = new WeakMap<object, number>();
function preventOrdinal(dependencies: ReplacementDependencies): number {
  const key = dependencies as unknown as object;
  const ordinal = preventOrdinals.get(key) ?? 0;
  preventOrdinals.set(key, ordinal + 1);
  return ordinal;
}

function installPrevent(
  ctx: ResolveContext,
  dependencies: ReplacementDependencies,
  pattern: Readonly<Record<string, unknown>>,
  prevented: number | "all",
  lifetime: ReplacementDuration,
  optional: boolean
): { id: string; cancel: () => void } {
  if ((pattern.event ?? pattern.type ?? pattern.kind) !== "damage") {
    throw new BlockedReplacementError("replacement.prevent currently supports damage events only");
  }
  const source = dependencies.host.object(ctx.source.ref) ?? ctx.source;
  const boundTurn = dependencies.pipeline.clock.turn;
  let used = false;
  let remaining = prevented;
  const id = `${source.ref.id}:${source.ref.zoneEntryId}:replacement.prevent:${prevented}:${preventOrdinal(dependencies)}`;
  const snapshotFor = (ref: ObjectRef): ObjectSnapshot | null => {
    const current = dependencies.host.object(ref);
    if (current) return current;
    try { return dependencies.host.context(source, source.controller).lastKnown(ref); }
    catch { return null; }
  };
  const active = (): boolean => {
    if (lifetime === "permanent") return true;
    if (dependencies.pipeline.clock.turn !== boundTurn) return false;
    return lifetime === "next-time-this-turn" ? !used : true;
  };
  const registration: ReplacementRegistration = {
    id,
    source,
    activeZones: REPLACEMENT_ACTIVE_ZONES,
    optional,
    matches: (action: GameAction, _original: GameAction): boolean => {
      if (!active()) return false;
      if (action.type !== "damage") return false;
      if (lifetime === "this-turn" && typeof remaining === "number" && remaining <= 0) return false;
      const target = { object: action.target };
      return actionMatchesEventPattern({
        pattern,
        action,
        target,
        hostRef: source.ref,
        controller: source.controller,
        snapshotFor
      });
    },
    apply: (action: GameAction, _original: GameAction) => {
      if (action.type !== "damage") throw new BlockedReplacementError("replacement.prevent matched a non-damage action");
      used = true;
      const value = lifetime === "this-turn" && prevented !== "all" ? remaining : prevented;
      if (value === "all") return { status: "prevent" } as const;
      if (value >= action.amount) {
        if (lifetime === "this-turn") remaining = Math.max(0, value - action.amount);
        return { status: "prevent" } as const;
      }
      if (value === 0) return { status: "rewrite", action } as const;
      if (lifetime === "this-turn") remaining = Math.max(0, value - action.amount);
      return { status: "rewrite", action: { ...action, amount: action.amount - value } } as const;
    }
  };
  dependencies.pipeline.registerReplacement(registration);
  return {
    id,
    cancel: () => dependencies.pipeline.unregisterReplacement?.(id)
  };
}

const replacementPrevent = {
  op: "replacement.prevent",
  argsSchema,
  execute(ctx: ResolveContext, args: ReplacementPreventArgs): InstructionResult {
    const event = eventPattern(evaluated(ctx, args.event));
    const prevented = amount(evaluated(ctx, args.amount));
    const rawDuration = evaluated(ctx, args.duration) ?? evaluated(ctx, args.scope);
    const lifetime = duration(rawDuration);
    const optional = bool(evaluated(ctx, args.optional));
    const appliesTo = evaluated(ctx, args.appliesTo);
    const target = evaluated(ctx, args.target);
    validateFilter(appliesTo, "appliesTo");
    let pattern: Readonly<Record<string, unknown>> = event;
    if (appliesTo !== undefined) pattern = { ...pattern, filter: appliesTo as unknown as Readonly<Record<string, unknown>> };
    if (target !== undefined) {
      if (target === "self" || target === "source") {
        pattern = { ...pattern, filter: { ...(isRecord(pattern.filter) ? pattern.filter : {}), self: true } };
      } else if (isRecord(target) && typeof target.target === "string") {
        const refs = ctx.targets(target.target);
        if (refs.length !== 1) throw new BlockedReplacementError("replacement.prevent target requires one finalized target");
        pattern = { ...pattern, filter: { ...(isRecord(pattern.filter) ? pattern.filter : {}), objectId: refs[0]!.id } };
      } else {
        throw new BlockedReplacementError("replacement.prevent target binding is unsupported");
      }
    }
    const dependencies = replacementDependencies(ctx);
    const bound = installPrevent(ctx, dependencies, pattern, prevented, lifetime, optional);
    return {
      status: "executed",
      events: [],
      linkedValues: { replacementId: bound.id, duration: lifetime, amount: prevented }
    };
  }
} satisfies InstructionDef<ReplacementPreventArgs>;

export default replacementPrevent;
