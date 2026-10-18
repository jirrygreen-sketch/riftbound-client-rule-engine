/**
 * replacement.damage-multiplier — register a one-shot damage doubling or
 * numeric multiplier replacement for one current object.
 *
 * CR v1.5 433.1.b defines damage doubling as a replacement event whose source
 * remains unchanged.  The pipeline owns ordering and application; this
 * instruction installs the registration and rewrites only the pending damage
 * amount.  It does not mutate object health or damage directly.
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
  REPLACEMENT_ACTIVE_ZONES
} from "../../replacement/index.js";
import type { ReplacementRegistration } from "../../events/pipeline-types.js";
import {
  evaluated,
  replacementDependencies,
  type ReplacementDuration
} from "./replacement.enter.js";

export interface ReplacementDamageMultiplierArgs {
  readonly event?: Expr | Value;
  readonly object?: Expr | Value;
  readonly multiplier?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly optional?: Expr | Value;
}

const ARGUMENTS = new Set(["event", "object", "multiplier", "duration", "optional"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isExpr = (value: unknown): value is Expr => isRecord(value) && typeof value.kind === "string";
const isValue = (value: unknown, active = new Set<unknown>()): value is Value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isValue(item, active))
    : Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
};

function parseArgs(value: unknown): ReplacementDamageMultiplierArgs {
  if (!isRecord(value)) throw new TypeError("replacement.damage-multiplier args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.damage-multiplier argument: ${key}`);
    if (!isExpr(argument) && !isValue(argument)) throw new TypeError(`Invalid replacement.damage-multiplier argument: ${key}`);
  }
  return value as ReplacementDamageMultiplierArgs;
}

const argsSchema: Schema<ReplacementDamageMultiplierArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try { return { success: true as const, data: parseArgs(value) }; }
    catch (error) { return { success: false as const, error }; }
  }
};

function targetRef(ctx: ResolveContext, value: Value): ObjectRef {
  if (value === "self" || value === "source") return ctx.source.ref;
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value.target === "string") {
    const refs = ctx.targets(value.target);
    if (refs.length !== 1) throw new BlockedReplacementError("replacement.damage-multiplier requires one finalized target");
    return { id: refs[0]!.id, zoneEntryId: refs[0]!.zoneEntryId };
  }
  throw new BlockedReplacementError("replacement.damage-multiplier object must be source or one finalized target");
}

function duration(value: Value | undefined): ReplacementDuration {
  if (value === undefined || value === "permanent" || value === "forever") return "permanent";
  if (value === "this-turn" || value === "end-of-turn") return "this-turn";
  if (value === "next-time-this-turn" || value === "next-time") return "next-time-this-turn";
  throw new BlockedReplacementError(`Unsupported replacement.damage-multiplier duration: ${JSON.stringify(value)}`);
}

const multiplierOrdinals = new WeakMap<object, number>();
function ordinal(key: object): number {
  const current = multiplierOrdinals.get(key) ?? 0;
  multiplierOrdinals.set(key, current + 1);
  return current;
}

const replacementDamageMultiplier = {
  op: "replacement.damage-multiplier",
  argsSchema,
  execute(ctx: ResolveContext, args: ReplacementDamageMultiplierArgs): InstructionResult {
    const event = evaluated(ctx, args.event) ?? "damage";
    const eventKind = typeof event === "string" ? event : isRecord(event) ? event.event ?? event.type ?? event.kind : undefined;
    if (eventKind !== "damage") throw new BlockedReplacementError("replacement.damage-multiplier currently supports damage only");
    const factor = evaluated(ctx, args.multiplier);
    if (typeof factor !== "number" || !Number.isSafeInteger(factor) || factor < 2) {
      throw new BlockedReplacementError("replacement.damage-multiplier multiplier must be an integer of at least 2");
    }
    const objectValue = evaluated(ctx, args.object);
    if (objectValue === undefined) throw new BlockedReplacementError("replacement.damage-multiplier requires an object");
    const targetRefValue = targetRef(ctx, objectValue);
    const optionalValue = evaluated(ctx, args.optional);
    if (optionalValue !== undefined && typeof optionalValue !== "boolean") {
      throw new BlockedReplacementError("replacement.damage-multiplier optional must be boolean");
    }
    const lifetime = duration(evaluated(ctx, args.duration));
    const dependencies = replacementDependencies(ctx);
    const source = dependencies.host.object(ctx.source.ref) ?? ctx.source;
    const boundTurn = dependencies.pipeline.clock.turn;
    let used = false;
    const id = `${source.ref.id}:${source.ref.zoneEntryId}:replacement.damage-multiplier:${factor}:${ordinal(dependencies)}`;
    const active = (): boolean => {
      if (lifetime === "permanent") return true;
      if (dependencies.pipeline.clock.turn !== boundTurn) return false;
      return lifetime === "next-time-this-turn" ? !used : true;
    };
    const snapshotFor = (ref: ObjectRef): ObjectSnapshot | null => dependencies.host.object(ref);
    const registration: ReplacementRegistration = {
      id,
      source,
      activeZones: REPLACEMENT_ACTIVE_ZONES,
      optional: optionalValue === true,
      matches: (action: GameAction, _original: GameAction): boolean => {
        if (!active() || action.type !== "damage") return false;
        if (action.target.id !== targetRefValue.id || action.target.zoneEntryId !== targetRefValue.zoneEntryId) return false;
        return actionMatchesEventPattern({
          pattern: { event: "damage" },
          action,
          target: { object: action.target },
          hostRef: source.ref,
          controller: source.controller,
          snapshotFor
        });
      },
      apply: (action: GameAction, _original: GameAction) => {
        if (action.type !== "damage") throw new BlockedReplacementError("replacement.damage-multiplier matched a non-damage action");
        used = true;
        const amount = action.amount * factor;
        if (!Number.isSafeInteger(amount) || amount < 0) {
          throw new BlockedReplacementError("replacement.damage-multiplier produced an invalid damage amount");
        }
        return { status: "rewrite", action: { ...action, amount } };
      }
    };
    dependencies.pipeline.registerReplacement(registration);
    return {
      status: "executed",
      events: [],
      linkedValues: { replacementId: id, duration: lifetime, multiplier: factor }
    };
  }
} satisfies InstructionDef<ReplacementDamageMultiplierArgs>;

export default replacementDamageMultiplier;
