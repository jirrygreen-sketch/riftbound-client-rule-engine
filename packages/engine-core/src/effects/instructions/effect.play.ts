import type {
  ChoiceVisibility,
  Expr,
  FinalizedCostPlan,
  GameEvent,
  InstructionDef,
  LocationRef,
  NegatedInstructionResult,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";
import { CostPlanError } from "../../cost/plan-types.js";
import { buildEffectPlayCostPlan } from "../play/index.js";

/**
 * Arguments for the limited Play effect.
 *
 * `target` names a TargetSpec whose finalized references are read with
 * `ctx.targets()`. `pick` names a non-target PickSpec; when `choice` is
 * present, its object references are offered to `ctx.choose()` instead of
 * being played automatically. `object` is an Expr that evaluates to one
 * ObjectRef and is useful for an already-linked object.
 *
 * `player`, `location`, `cost`, `ignoreCost`, `ignoreCosts`, and `amount` are
 * Expr values. A missing `cost` is finalized from the selected card's trusted
 * program/catalog characteristics. Existing `cost.modify` descriptors and
 * complete CostPlan values are converted to the chain's flat finalized plan;
 * later additional costs and increases stay in the resulting total. Unknown
 * descriptors fail closed. `linkKey` receives the actual number of successful
 * plays and defaults to `"played"`.
 *
 * The operation follows Core Rules v1.5 420.3, 420.3.a–c and 420.4: a game
 * effect Play is a Limited Action, uses the normal Play procedure unless the
 * caller supplies a finalized choice or cost override, and does nothing when
 * no eligible object remains. Nested card abilities are resolved by the
 * chain after `play`; this primitive does not recursively resolve them or
 * grant a separate continuous permission. A stale target is ignored when
 * every selected reference has become invalid. Any replaced, prevented, or
 * impossible action negates this instruction under contract section 3.4.
 */
export interface EffectPlayChoice {
  readonly id: string;
  readonly chooser?: Expr;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
  readonly min?: number;
  readonly max?: number;
}

export interface EffectPlayArgs {
  readonly target?: string;
  readonly pick?: string;
  readonly object?: Expr;
  readonly choice?: EffectPlayChoice;
  readonly player?: Expr;
  readonly location?: Expr;
  readonly cost?: Expr;
  readonly ignoreCost?: Expr;
  readonly ignoreCosts?: Expr;
  readonly amount?: Expr;
  readonly linkKey?: string;
}

const EXPR_KINDS = new Set([
  "constant",
  "literal",
  "object-property",
  "object-attribute",
  "linked-value",
  "linked",
  "count"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string" && EXPR_KINDS.has(value.kind);
}

function parseArgs(value: unknown): EffectPlayArgs {
  if (!isRecord(value)) throw new TypeError("effect.play arguments must be an object");

  const sources = [value.target, value.pick, value.object].filter(item => item !== undefined);
  if (sources.length !== 1) {
    throw new TypeError("effect.play requires exactly one of target, pick, or object");
  }
  if (value.target !== undefined && (typeof value.target !== "string" || value.target.length === 0)) {
    throw new TypeError("effect.play target must be a non-empty TargetSpec id");
  }
  if (value.pick !== undefined && (typeof value.pick !== "string" || value.pick.length === 0)) {
    throw new TypeError("effect.play pick must be a non-empty PickSpec id");
  }
  for (const key of ["object", "player", "location", "cost", "ignoreCost", "ignoreCosts", "amount"]) {
    if (value[key] !== undefined && !isExpr(value[key])) {
      throw new TypeError(`effect.play ${key} must be an Expr`);
    }
  }
  if (value.choice !== undefined) {
    if (!isRecord(value.choice) || typeof value.choice.id !== "string" || value.choice.id.length === 0) {
      throw new TypeError("effect.play choice must have a non-empty id");
    }
    if (value.pick === undefined) throw new TypeError("effect.play choice requires a pick");
    for (const key of ["min", "max"]) {
      if (value.choice[key] !== undefined && (!Number.isInteger(value.choice[key]) || Number(value.choice[key]) < 0)) {
        throw new TypeError(`effect.play choice.${key} must be a non-negative integer`);
      }
    }
    const min = value.choice.min;
    const max = value.choice.max;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      throw new TypeError("effect.play choice.min cannot exceed choice.max");
    }
    if (value.choice.chooser !== undefined && !isExpr(value.choice.chooser)) {
      throw new TypeError("effect.play choice.chooser must be an Expr");
    }
  }
  if (value.linkKey !== undefined && (typeof value.linkKey !== "string" || value.linkKey.length === 0)) {
    throw new TypeError("effect.play linkKey must be a non-empty string");
  }
  return value as unknown as EffectPlayArgs;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && Number.isInteger(value.zoneEntryId);
}

function cloneRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function uniqueRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const result: ObjectRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneRef(ref));
  }
  return result;
}

function valueAsPlayer(value: Value | undefined, fallback: PlayerId): PlayerId | null {
  return value === undefined ? fallback : typeof value === "string" && value.length > 0 ? value : null;
}

function valueAsAmount(value: Value | undefined): number | null {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function valueAsLocation(value: Value | undefined): LocationRef | undefined | null {
  if (value === undefined || value === null) return value === undefined ? undefined : null;
  if (!isRecord(value) || (value.type !== "base" && value.type !== "battlefield")) return null;
  if (value.type === "base") return typeof value.player === "string" ? { type: "base", player: value.player } : null;
  return typeof value.id === "string" ? { type: "battlefield", id: value.id } : null;
}

function valueAsCost(value: Value | undefined): FinalizedCostPlan | undefined | null {
  if (value === undefined || value === null) return value === undefined ? undefined : null;
  if (!isRecord(value) || value.finalized !== true) return null;
  return value as unknown as FinalizedCostPlan;
}

function negated(reason: "impossible" | "replaced", events: readonly GameEvent[]): NegatedInstructionResult {
  return { status: "negated", reason, events: [...events] };
}

function chooseRefs(ctx: ResolveContext, args: EffectPlayArgs, refs: readonly ObjectRef[], amount: number | null): ObjectRef[] {
  if (!args.choice) return [...refs];
  const min = args.choice.min ?? 1;
  const requestedMax = args.choice.max ?? (amount === null ? 1 : amount);
  const max = Math.min(requestedMax, refs.length);
  if (refs.length === 0 || min > max) return [];
  const chooser = valueAsPlayer(
    args.choice.chooser === undefined ? undefined : ctx.evaluate(args.choice.chooser),
    ctx.controller
  );
  if (chooser === null) return [];
  const answer = ctx.choose<readonly ObjectRef[] | ObjectRef>({
    id: args.choice.id,
    chooser,
    visibility: args.choice.visibility ?? "chooser-only",
    prompt: args.choice.prompt,
    type: "select-objects",
    options: refs,
    min,
    max
  });
  const selected = Array.isArray(answer) ? answer : [answer];
  const allowed = new Set(refs.map(refKey));
  return uniqueRefs(selected.filter(ref => isObjectRef(ref) && allowed.has(refKey(ref))));
}

const execute: InstructionDef<EffectPlayArgs>["execute"] = (ctx, args) => {
  const player = valueAsPlayer(
    args.player === undefined ? undefined : ctx.evaluate(args.player),
    ctx.controller
  );
  const amount = valueAsAmount(args.amount === undefined ? undefined : ctx.evaluate(args.amount));
  const location = valueAsLocation(args.location === undefined ? undefined : ctx.evaluate(args.location));
  const cost = valueAsCost(args.cost === undefined ? undefined : ctx.evaluate(args.cost));
  if (player === null || (args.amount !== undefined && amount === null) || location === null || cost === null) {
    return negated("impossible", []);
  }

  let selected: ObjectRef[];
  if (args.target !== undefined) {
    selected = uniqueRefs(ctx.targets(args.target));
  } else if (args.pick !== undefined) {
    selected = uniqueRefs(ctx.picks(args.pick).filter(isObjectRef));
  } else {
    const value = ctx.evaluate(args.object!);
    selected = isObjectRef(value) ? [cloneRef(value)] : [];
  }

  selected = selected.filter(ref => ctx.object(ref) !== null);
  if (selected.length === 0) return { status: "ignored", reason: "mistargeted" };

  selected = chooseRefs(ctx, args, selected, amount);
  if (selected.length === 0) return { status: "ignored", reason: "mistargeted" };
  if (amount !== null) selected = selected.slice(0, amount);
  if (selected.length === 0) {
    const key = args.linkKey ?? "played";
    ctx.link(key, 0);
    return { status: "executed", events: [], linkedValues: { [key]: 0 } };
  }

  const events: GameEvent[] = [];
  let played = 0;
  for (const object of selected) {
    let finalized: FinalizedCostPlan | undefined;
    try {
      finalized = buildEffectPlayCostPlan(ctx, {
        object,
        player,
        ...(args.cost === undefined ? {} : { cost: ctx.evaluate(args.cost) }),
        ...(args.ignoreCost === undefined ? {} : { ignoreCost: ctx.evaluate(args.ignoreCost) }),
        ...(args.ignoreCosts === undefined ? {} : { ignoreCosts: ctx.evaluate(args.ignoreCosts) })
      });
    } catch (error) {
      if (error instanceof CostPlanError) return negated("impossible", events);
      throw error;
    }
    const effectiveCost = finalized ?? cost;
    const outcome = ctx.perform({
      type: "play",
      object,
      player,
      ...(location === undefined ? {} : { location }),
      ...(effectiveCost === undefined ? {} : { cost: effectiveCost })
    });
    events.push(...outcome.events);
    if (outcome.status !== "done") {
      return negated(outcome.status === "replaced" ? "replaced" : "impossible", events);
    }
    played += 1;
  }

  const key = args.linkKey ?? "played";
  ctx.link(key, played);
  return { status: "executed", events, linkedValues: { [key]: played } };
};

export default {
  op: "effect.play",
  argsSchema: { parse: parseArgs },
  execute
} satisfies InstructionDef<EffectPlayArgs>;
