/**
 * replacement.enter — register an entry-orientation replacement.
 *
 * The replacement binder owns matching and event ordering.  This instruction
 * only turns a resolved card declaration into the binder's public ability
 * shape.  A production ResolveContext needs to expose ReplacementDependencies
 * at resolution time; until that contract is added, the instruction fails
 * closed with BlockedReplacementError instead of pretending to register.
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
  bindReplacement,
  BlockedReplacementError,
  type ReplacementAbilityInput,
  type ReplacementDependencies,
  type ReplacementPipelineAdapter
} from "../../replacement/index.js";
import type { ReplacementRegistration } from "../../events/pipeline-types.js";

export type ReplacementDuration = "permanent" | "this-turn" | "next-time-this-turn";

export interface ReplacementInstructionContext extends ResolveContext {
  /** Runtime-only extension pending the contract change request. */
  readonly replacement?: ReplacementDependencies;
  /** Alias accepted by adapters while the contract is being migrated. */
  readonly replacementDependencies?: ReplacementDependencies;
}

export interface ReplacementEnterArgs {
  readonly state?: Expr | Value;
  readonly exhausts?: Expr | Value;
  readonly zone?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly appliesTo?: Expr | Value;
  readonly filter?: Expr | Value;
  readonly window?: Expr | Value;
}

const ARGUMENTS = new Set(["state", "exhausts", "zone", "duration", "appliesTo", "filter", "window"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

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

function parseArgs(value: unknown): ReplacementEnterArgs {
  if (!isRecord(value)) throw new TypeError("replacement.enter args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.enter argument: ${key}`);
    if (!isExpr(argument) && !isValue(argument)) {
      throw new TypeError(`Invalid replacement.enter argument: ${key}`);
    }
  }
  return value as ReplacementEnterArgs;
}

const argsSchema: Schema<ReplacementEnterArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

export function evaluated(ctx: ResolveContext, value: Expr | Value | undefined): Value | undefined {
  if (value === undefined) return undefined;
  return isExpr(value) ? ctx.evaluate(value) : value;
}

export function replacementDependencies(ctx: ResolveContext): ReplacementDependencies {
  const extended = ctx as ReplacementInstructionContext;
  const dependencies = extended.replacement ?? extended.replacementDependencies;
  if (dependencies && dependencies.host && dependencies.pipeline) return dependencies;
  throw new BlockedReplacementError(
    "replacement instruction requires ResolveContext.replacement dependencies " +
    "(host + pipeline); request the contract extension before production wiring"
  );
}

export function replacementDuration(value: Value | undefined, label: string): ReplacementDuration {
  if (value === undefined || value === "permanent" || value === "forever") return "permanent";
  if (value === "this-turn" || value === "end-of-turn") return "this-turn";
  if (value === "next-time-this-turn" || value === "next-time") return "next-time-this-turn";
  throw new BlockedReplacementError(`Unsupported ${label} duration: ${JSON.stringify(value)}`);
}

function constant(value: Value): Expr {
  return { kind: "constant", value };
}

/**
 * Register a binder-backed replacement while constraining a temporary
 * duration through the pipeline matcher.  The binder still supplies all
 * normal source-zone checks and replacement ordering.
 */
export function bindWithDuration(
  ctx: ResolveContext,
  ability: ReplacementAbilityInput,
  lifetime: ReplacementDuration,
  transformRegistration?: (registration: ReplacementRegistration) => ReplacementRegistration
): { readonly id: string; readonly cancel: () => void } {
  const dependencies = replacementDependencies(ctx);
  const bound = bindReplacement(
    ability,
    ctx.source.ref,
    wrappedDependencies(ctx, ability, dependencies, lifetime, transformRegistration)
  );
  return { id: bound.registration.id, cancel: bound.cancel };
}

/**
 * Add the resolution-time lifetime and declaration filter around the shared
 * binder registration.  The binder's entry declaration follows the host
 * incarnation, while `ability.replaces.filter` carries the card's additional
 * entering-object predicate.  Keeping that predicate here avoids silently
 * broadening an `appliesTo` declaration when the frozen binder API has no
 * separate instruction-level filter field.
 */
function wrappedDependencies(
  ctx: ResolveContext,
  ability: ReplacementAbilityInput,
  dependencies: ReplacementDependencies,
  lifetime: ReplacementDuration,
  transformRegistration?: (registration: ReplacementRegistration) => ReplacementRegistration
): ReplacementDependencies {
  const boundTurn = dependencies.pipeline.clock.turn;
  const kind = ability.replaces.event ?? ability.replaces.type ?? ability.replaces.kind;
  const hasDeclaredPattern = typeof kind === "string";
  const hostSnapshot = () => {
    const current = dependencies.host.objects().find(object => object.ref.id === ctx.source.ref.id);
    return current ?? dependencies.host.object(ctx.source.ref) ?? ctx.source;
  };
  const snapshotFor = (ref: ObjectRef): ObjectSnapshot | null => {
    const current = dependencies.host.object(ref);
    if (current) return current;
    try { return ctx.lastKnown(ref); }
    catch { return null; }
  };
  const matchesDeclaredPattern = (action: GameAction): boolean => {
    if (!hasDeclaredPattern) return true;
    const ref = "target" in action ? action.target : "object" in action ? action.object : undefined;
    const target = ref ? { object: ref } : "player" in action ? { player: action.player } : {};
    const host = hostSnapshot();
    return actionMatchesEventPattern({
      pattern: ability.replaces,
      action,
      target,
      hostRef: host.ref,
      controller: host.controller,
      snapshotFor
    });
  };
  // A one-shot declaration is consumed only after the pipeline actually
  // chooses it. The binder's optional decision runs after `matches`, so this
  // wrapper cannot mark the window on a decline. Failed application is rolled
  // back by the pipeline checkpoint, and a retry rebuilds this local window.
  const oneShot = { used: false };
  const wrappedPipeline: ReplacementPipelineAdapter = {
    clock: dependencies.pipeline.clock,
    registerReplacement(registration) {
      const registrationToRegister: ReplacementRegistration = {
        ...registration,
        matches: (action, original) => {
          if (lifetime !== "permanent" && dependencies.pipeline.clock.turn !== boundTurn) return false;
          if (lifetime === "next-time-this-turn" && oneShot.used) return false;
          if (!matchesDeclaredPattern(action)) return false;
          return registration.matches(action, original);
        },
        apply: (action, original) => {
          const result = registration.apply(action, original);
          if (lifetime === "next-time-this-turn") oneShot.used = true;
          return result;
        }
      };
      dependencies.pipeline.registerReplacement(
        transformRegistration?.(registrationToRegister) ?? registrationToRegister
      );
    },
    unregisterReplacement: id => dependencies.pipeline.unregisterReplacement?.(id),
    ...(dependencies.pipeline.checkpoint === undefined ? {} : {
      checkpoint: () => dependencies.pipeline.checkpoint?.(),
      restore: (checkpoint: unknown) => dependencies.pipeline.restore?.(checkpoint)
    })
  };
  return { host: dependencies.host, pipeline: wrappedPipeline };
}

const SUPPORTED_FILTER_KEYS = new Set([
  "self", "other", "source", "target", "object", "objectId", "id", "cardId", "canonicalCardId",
  "type", "types", "tag", "tags", "zone", "location", "controller", "owner", "states", "state",
  "ready", "exhausted", "characteristics"
]);

function entryFilter(value: Value | undefined, requireSelf = false): Readonly<Record<string, unknown>> {
  if (value === undefined) {
    if (requireSelf) throw new BlockedReplacementError("replacement.enter appliesTo must identify the host/source object");
    return { self: true };
  }
  if (!isRecord(value)) {
    throw new BlockedReplacementError("replacement.enter appliesTo/filter must be an object filter");
  }
  // The merged binder's entry form is host-scoped.  Cross-object declarations
  // would silently broaden the effect, so keep them judge-required.
  if (Object.keys(value).some(key => !SUPPORTED_FILTER_KEYS.has(key))) {
    throw new BlockedReplacementError("replacement.enter contains an unsupported entry filter key");
  }
  const self = value.self ?? value.source ?? value.target;
  if (requireSelf && self === undefined) {
    throw new BlockedReplacementError("replacement.enter appliesTo must identify the host/source object");
  }
  if (self !== undefined && self !== true && self !== "self" && self !== "source") {
    throw new BlockedReplacementError("replacement.enter can only register a self/source entry replacement");
  }
  return self === undefined ? value : { ...value, self: true };
}

const replacementEnter = {
  op: "replacement.enter",
  argsSchema,
  execute(ctx: ResolveContext, args: ReplacementEnterArgs): InstructionResult {
    const stateValue = evaluated(ctx, args.state);
    const exhaustsValue = evaluated(ctx, args.exhausts);
    const state = stateValue === undefined && typeof exhaustsValue === "boolean"
      ? (exhaustsValue ? "exhausted" : "ready")
      : stateValue;
    if (state !== "ready" && state !== "exhausted") {
      throw new BlockedReplacementError("replacement.enter requires state ready/exhausted");
    }
    const zone = evaluated(ctx, args.zone);
    if (zone !== undefined && zone !== "board") {
      throw new BlockedReplacementError(`replacement.enter only supports board entry, got ${JSON.stringify(zone)}`);
    }
    const lifetime = replacementDuration(evaluated(ctx, args.duration), "replacement.enter");
    const rawFilter = evaluated(ctx, args.filter);
    const rawAppliesTo = evaluated(ctx, args.appliesTo);
    const filter = entryFilter(rawFilter ?? rawAppliesTo, rawAppliesTo !== undefined);
    const instruction: ReplacementAbilityInput["with"][number] = {
      id: `${ctx.source.ref.id}.replacement.enter`,
      op: "replacement.enter",
      args: { state: constant(state) }
    };
    const ability: ReplacementAbilityInput = {
      replaces: { event: "object-enters-board", filter },
      with: [instruction]
    };
    const bound = bindWithDuration(ctx, ability, lifetime);
    return {
      status: "executed",
      events: [],
      linkedValues: { replacementId: bound.id, duration: lifetime, state }
    };
  }
} satisfies InstructionDef<ReplacementEnterArgs>;

export default replacementEnter;
