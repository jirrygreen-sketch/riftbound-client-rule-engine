/**
 * Replace (CR v1.5 439.1-439.7) is intentionally capability-shaped. A token
 * that replaces another object must inherit its effects/statuses and be treated
 * as the same Game Object for later references; Swap Back must recover the
 * exact banished predecessor. The frozen GameAction set and ObjectSelector
 * expose neither an identity alias nor that predecessor link. Submitting
 * create-token + banish + move-location would create a different object and is
 * therefore not a valid implementation. This instruction validates the
 * printed shape, links a precise blocked receipt, and fails closed until the
 * Replace/Swap-Back contract exists.
 */
import type { Expr, InstructionDef, InstructionResult, ResolveContext, Value } from "../contract.js";

export interface EffectReplaceArgs {
  readonly mode?: Expr;
  readonly battlefield?: Expr;
  readonly object?: Expr;
  readonly withToken?: Expr;
  readonly with?: Expr;
  readonly linkKey?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isExpr(value: unknown): value is Expr { return isRecord(value) && typeof value.kind === "string"; }

function parseArgs(value: unknown): EffectReplaceArgs {
  if (!isRecord(value)) throw new TypeError("effect.replace args must be an object");
  const allowed = ["mode", "battlefield", "object", "withToken", "with", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) throw new TypeError("Invalid effect.replace argument: " + key);
  }
  return { ...value } as unknown as EffectReplaceArgs;
}

function execute(ctx: ResolveContext, args: EffectReplaceArgs): InstructionResult {
  const mode = args.mode === undefined ? "replace" : ctx.evaluate(args.mode);
  if (mode !== "replace" && mode !== "swap-back") throw new TypeError("effect.replace mode must be replace or swap-back");
  const target = ctx.evaluate((args.battlefield ?? args.object ?? args.with) as Expr);
  const withToken = args.withToken === undefined ? undefined : ctx.evaluate(args.withToken);
  const key = args.linkKey === undefined ? "replaced" : ctx.evaluate(args.linkKey);
  if (typeof key !== "string" || key.length === 0) throw new TypeError("effect.replace linkKey must be a nonempty string");
  const value: Value = {
    mode,
    target: target as Value,
    ...(withToken === undefined ? {} : { withToken }),
    amount: 0,
    blockedReason: mode === "swap-back" ?
      "replace-swap-back-requires-predecessor-identity-link" :
      "replace-requires-same-game-object-alias-and-inherited-status-contract",
  };
  ctx.link(key, value);
  return { status: "negated", reason: "impossible", events: [] };
}

export default {
  op: "effect.replace",
  argsSchema: { parse: parseArgs },
  execute,
} satisfies InstructionDef<EffectReplaceArgs>;
