/**
 * CR v1.5 143.2.a / 479.2: "base Might becomes N" sets a trait before
 * ability/arithmetic effects. It does not change printed traits or remember
 * an arithmetic delta. Selection, receipts and durations reuse continuous.might.
 * `value` is the existing Dragon Form spelling; `amount` is Herald/Lulu's.
 * Descriptive card-text strings are not executable numeric expressions.
 */
import type { InstructionDef, InstructionResult, ResolveContext } from "../contract.js";
import { argsSchema as mightSchema, executeMight, type ContinuousMightArgs } from "./continuous.might.js";

function parseArgs(value: unknown): ContinuousMightArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("continuous.base-might args must be an object");
  }
  const { value: alias, ...args } = value as Record<string, unknown>;
  if (alias !== undefined && args.amount !== undefined) {
    throw new TypeError("continuous.base-might accepts either amount or value, not both");
  }
  if (alias === undefined && args.amount === undefined) {
    throw new TypeError("continuous.base-might requires a numeric amount or value");
  }
  if (args.minimum !== undefined) {
    throw new TypeError("continuous.base-might does not apply arithmetic minimums");
  }
  return mightSchema.parse({ ...args, amount: args.amount === undefined ? alias : args.amount,
    mode: args.mode === undefined ? "set" : args.mode });
}

const continuousBaseMight = {
  op: "continuous.base-might",
  argsSchema: {
    parse: parseArgs,
    safeParse: (value: unknown) => {
      try { return { success: true as const, data: parseArgs(value) }; }
      catch (error) { return { success: false as const, error }; }
    }
  },
  execute(ctx: ResolveContext, args: ContinuousMightArgs): InstructionResult {
    return executeMight(ctx, args, "trait");
  }
} satisfies InstructionDef<ContinuousMightArgs>;

export default continuousBaseMight;
