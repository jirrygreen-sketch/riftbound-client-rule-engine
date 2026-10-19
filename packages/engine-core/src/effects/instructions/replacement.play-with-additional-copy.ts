/**
 * replacement.play-with-additional-copy — explicit fail-closed boundary.
 *
 * The authored Zilean IR asks for an original token play plus a second copy.
 * The merged action contract has no atomic copy-and-play action, and a plain
 * copy cannot create the pending Chain incarnation needed for a real play.
 * Registering this declaration must therefore fail before the original play
 * occurs; the replacement is never simulated after the fact.
 */
import type {
  Expr,
  InstructionDef,
  InstructionResult,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";
import { BlockedReplacementError } from "../../replacement/index.js";

export interface ReplacementPlayWithAdditionalCopyArgs {
  readonly original?: Expr | Value;
  readonly additional?: Expr | Value;
  readonly optional?: Expr | Value;
  readonly oncePerTurn?: Expr | Value;
}

const ARGUMENTS = new Set(["original", "additional", "optional", "oncePerTurn"]);
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

function parseArgs(value: unknown): ReplacementPlayWithAdditionalCopyArgs {
  if (!isRecord(value)) throw new TypeError("replacement.play-with-additional-copy args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.play-with-additional-copy argument: ${key}`);
    if (!isExpr(argument) && !isValue(argument)) throw new TypeError(`Invalid replacement.play-with-additional-copy argument: ${key}`);
  }
  if (value.original === undefined || value.additional === undefined) {
    throw new TypeError("replacement.play-with-additional-copy requires original and additional");
  }
  return value as ReplacementPlayWithAdditionalCopyArgs;
}

const argsSchema: Schema<ReplacementPlayWithAdditionalCopyArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try { return { success: true as const, data: parseArgs(value) }; }
    catch (error) { return { success: false as const, error }; }
  }
};

const replacementPlayWithAdditionalCopy = {
  op: "replacement.play-with-additional-copy",
  argsSchema,
  execute(_ctx: ResolveContext, _args: ReplacementPlayWithAdditionalCopyArgs): InstructionResult {
    throw new BlockedReplacementError(
      "replacement.play-with-additional-copy needs an atomic Chain copy-and-play contract; no original play is executed"
    );
  }
} satisfies InstructionDef<ReplacementPlayWithAdditionalCopyArgs>;

export default replacementPlayWithAdditionalCopy;
