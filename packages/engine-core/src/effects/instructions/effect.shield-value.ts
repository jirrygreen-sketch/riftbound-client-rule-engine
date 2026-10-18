import type {
  Expr,
  InstructionResult,
  ObjectRef,
  ResolveContext,
  Schema,
  Value,
} from "../contract.js";

/**
 * effect.shield-value — read an object's Shield Value as a linked number.
 *
 * CR v1.5 evidence (/root/swarm-rift/shared/rules/CR-v1.5.txt):
 * - 814.1.b / 814.1.b.2 / 814.1.b.3: Shield is formatted "Shield [X]"; X is
 *   the Shield Value; a printed omission is presumed 1.
 * - 814.2: multiple Shield instances on one unit sum into one Shield Value.
 *
 * The value is read from the object's keyword entries ({ id: "shield",
 * value? } in ObjectSnapshot.keywords), which the production LayerEngine
 * maintains through keyword grants; no state is written and no damage is
 * dealt. The linked value is the consumer input for effects such as Ntofo
 * Strikes (rad/ntofo-strikes IR: linked-value over this instruction's
 * linkKey feeding effect.damage.amount).
 *
 * Arguments (Expr or evaluated literal):
 * - object: { target: string } | ObjectRef | { kind: "source" } — the unit
 *   whose Shield Value is read.
 * - linkKey?: string — the linked value key, default "shieldValue".
 */
export interface EffectShieldValueArgs {
  readonly object: Expr;
  readonly linkKey?: Expr;
}

const ARGUMENT_KEYS = ["object", "linkKey"] as const;
const DEFAULT_LINK_KEY = "shieldValue";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId);
}
function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value;
    case "object-property": case "object-attribute":
      return isId(value.property ?? value.attribute);
    case "linked": case "linked-value": return isId(value.instructionId);
    default: return false;
  }
}

function parseArgs(value: unknown): EffectShieldValueArgs {
  if (!isRecord(value)) throw new TypeError("effect.shield-value requires args");
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key as (typeof ARGUMENT_KEYS)[number])) {
      throw new TypeError("Invalid effect.shield-value argument: " + key);
    }
    if (isExpr(entry) || isRecord(entry)) continue;
    throw new TypeError("Invalid effect.shield-value argument: " + key);
  }
  if (value.object === undefined) throw new TypeError("effect.shield-value requires object");
  return value as unknown as EffectShieldValueArgs;
}

const argsSchema: Schema<EffectShieldValueArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) } as const;
    } catch (error) {
      return { success: false, error } as const;
    }
  },
};

function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : (argument as Value);
}

function resolveTarget(ctx: ResolveContext, value: Value): ObjectRef | null {
  if (isRecord(value) && value.kind === "source") return ctx.source.ref;
  if (isRecord(value) && typeof value.target === "string") {
    const refs = ctx.targets(value.target);
    const live = refs.map(ref => isObjectRef(ref) ? ref : null).find(ref => ref !== null && ctx.object(ref) !== null);
    return live ?? null;
  }
  if (isObjectRef(value)) return ctx.object({ id: value.id, zoneEntryId: value.zoneEntryId }) === null ? null : { id: value.id, zoneEntryId: value.zoneEntryId };
  return null;
}

/** Shield keyword entries carry their value; a bare Shield entry is 1 (814.1.b.3). */
function shieldValueOf(snapshot: { readonly keywords?: readonly { readonly id?: string; readonly value?: unknown }[] | Value }): number {
  const keywords = isRecord(snapshot) && Array.isArray(snapshot.keywords) ? snapshot.keywords : [];
  let total = 0;
  for (const entry of keywords) {
    if (!isRecord(entry)) continue;
    const id = entry.id ?? entry.keyword;
    if (typeof id !== "string" || id.toLowerCase() !== "shield") continue;
    const value = entry.value;
    total += typeof value === "number" && Number.isSafeInteger(value) ? value : 1;
  }
  return total;
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer (same as continuous.restrict).
const effectShieldValue = {
  op: "effect.shield-value",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectShieldValueArgs): InstructionResult {
    const linkKeyValue = args.linkKey === undefined ? DEFAULT_LINK_KEY : evaluateArgument(ctx, args.linkKey);
    if (typeof linkKeyValue !== "string" || linkKeyValue.trim().length === 0) {
      throw new TypeError("effect.shield-value linkKey must be a non-empty string");
    }
    const linkKey = linkKeyValue;
    const objectValue = evaluateArgument(ctx, args.object);
    const ref = resolveTarget(ctx, objectValue);
    if (ref === null) return { status: "ignored", reason: "mistargeted" };
    const snapshot = ctx.object(ref);
    if (snapshot === null) return { status: "ignored", reason: "mistargeted" };
    // 814.1.b.3 + 814.2: sum valued Shield entries; entries without a value
    // read as the presumed 1. A unit without Shield reads 0 (no invented
    // minimum) so consumers can distinguish "no Shield" from "Shield 0".
    const total = shieldValueOf(snapshot);
    ctx.link(linkKey, total);
    return { status: "executed", events: [], linkedValues: { [linkKey]: total } };
  },
} satisfies import("../contract.js").InstructionDef<EffectShieldValueArgs>;

export default effectShieldValue;
