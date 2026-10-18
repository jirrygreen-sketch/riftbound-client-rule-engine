/**
 * CR v1.5 434.1.a-d / 479.4.b: read both Mights before writing either effect,
 * then give each unit the opposite signed difference for the stated duration.
 * Equal Mights do nothing. Both references must still be valid units (359.3.e.8).
 * The surrounding Chain transaction owns rollback of both registrations.
 */
import type { Expr, InstructionDef, InstructionResult, ObjectRef, ResolveContext, Value } from "../contract.js";
import { buildMightSpec, isDurationAlias, resolveContinuousDuration, settlementIdentity } from "../../layers/ops/index.js";
import { argsSchema as mightSchema, evaluateArgument } from "./continuous.might.js";

export interface SwapMightArgs {
  readonly targets: Expr | Value;
  readonly duration?: Expr | Value;
  readonly settlementId?: Expr | Value;
}

function targetIds(value: unknown): readonly [string, string] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(entry =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) &&
    Object.keys(entry).length === 1 && typeof entry.target === "string" && entry.target.trim().length > 0
  )) throw new TypeError("effect.swap-might targets must contain exactly two target selectors");
  return [value[0].target, value[1].target];
}

function parseArgs(value: unknown): SwapMightArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("effect.swap-might args must be an object");
  }
  const args = value as Record<string, unknown>;
  for (const key of Object.keys(args)) {
    if (!["targets", "duration", "settlementId"].includes(key)) {
      throw new TypeError("Invalid effect.swap-might argument: " + key);
    }
  }
  // Shared argument validation, including the existing Expr and lifetime forms.
  const { targets, ...rest } = args;
  mightSchema.parse(rest);
  if (typeof targets === "object" && targets !== null && !Array.isArray(targets) && "kind" in targets) {
    const expression = targets as Record<string, unknown>;
    if (expression.kind === "constant" || expression.kind === "literal") targetIds(expression.value);
    else mightSchema.parse({ objects: targets });
  } else targetIds(targets);
  return args as unknown as SwapMightArgs;
}

const swapMight = {
  op: "effect.swap-might",
  argsSchema: {
    parse: parseArgs,
    safeParse: (value: unknown) => {
      try { return { success: true as const, data: parseArgs(value) }; }
      catch (error) { return { success: false as const, error }; }
    }
  },
  execute(ctx: ResolveContext, args: SwapMightArgs): InstructionResult {
    const receipt = (refs: readonly ObjectRef[]): Record<string, Value> => {
      const objects = refs.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
      const count = objects.length;
      const values = { affected: { count, objects }, "affected.count": count, "affected.objects": objects };
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    const ids = targetIds(evaluateArgument(ctx, args.targets));
    const duration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(duration)) throw new TypeError("effect.swap-might duration is not a known alias");
    const requested = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (requested !== undefined && (typeof requested !== "string" || requested.trim().length === 0)) {
      throw new TypeError("effect.swap-might settlementId must be a non-empty string");
    }
    const selections = ids.map(id => ctx.targets(id));
    if (selections.some(refs => refs.length === 0)) return { status: "ignored", reason: "mistargeted" };
    if (selections.some(refs => refs.length !== 1)) {
      throw new TypeError("effect.swap-might requires one unit per target selector");
    }
    const [left, right] = selections.map(refs => ctx.object(refs[0]!));
    if (!left || !right || left.zone !== "board" || right.zone !== "board") {
      return { status: "ignored", reason: "mistargeted" };
    }
    if ((left.ref.id === right.ref.id && left.ref.zoneEntryId === right.ref.zoneEntryId) ||
        !left.types.includes("unit") || !right.types.includes("unit")) {
      receipt([]);
      return { status: "negated", reason: "impossible", events: [] };
    }
    if (left.might === null || right.might === null ||
        !Number.isSafeInteger(left.might) || !Number.isSafeInteger(right.might)) {
      throw new TypeError("effect.swap-might requires available integer Might values");
    }
    const difference = right.might - left.might;
    if (!Number.isSafeInteger(difference)) throw new RangeError("effect.swap-might difference must be a safe integer");
    if (difference === 0) {
      receipt([]);
      return { status: "negated", reason: "skipped", events: [] };
    }
    const settlement = settlementIdentity(ctx.source.ref, "effect.swap-might", key => ctx.linked(key),
      (key, value) => ctx.link(key, value), requested);
    const effects = [left, right].map((snapshot, index) => buildMightSpec("effect.swap-might", ctx.source.ref,
      { ref: snapshot.ref, snapshot }, "add", index === 0 ? difference : -difference, String(index + 1), settlement));
    for (const registration of effects) {
      ctx.addContinuous(registration.effect, resolveContinuousDuration(duration, ctx.source.ref));
    }
    return { status: "executed", events: [], linkedValues: receipt([left.ref, right.ref]) };
  }
} satisfies InstructionDef<SwapMightArgs>;

export default swapMight;
