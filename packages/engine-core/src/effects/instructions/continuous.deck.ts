/**
 * Continuous deck-building permission (CR v1.5 103.3).
 *
 * Deck limits are deck-construction rules, not in-game effects. The primitive
 * records the modified limit as a permanent effect so deck validation and
 * rules tooling can query it (layers/rules deckLimit). It never mutates a
 * deck during play and does not implement a deck validator itself.
 *
 * Arguments (all Expr):
 * - mode: "unlimited" or "max"
 * - amount: cap size for "max" mode
 * - name: affected card name; defaults to the source card's name
 * - appliesTo: object filter for the affected cards
 * - duration: this-turn | this-combat | permanent | while-source-here
 *   (deck limits are expected to be permanent; other values are accepted so
 *   the shape stays uniform with the other continuous primitives)
 * An unknown mode or a "max" without an amount is negated/impossible and
 * registers nothing.
 */
import type {
  ContinuousEffectSpec,
  Duration, Expr, InstructionResult, ObjectFilter, ResolveContext, Value,
} from "../contract.js";

type DurationValue = Duration;

export interface DeckArgs {
  readonly mode?: Expr;
  readonly amount?: Expr;
  readonly name?: Expr;
  readonly appliesTo?: Expr;
  readonly duration?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant": case "literal": valid = Object.hasOwn(value, "value"); break;
    case "object-property": case "object-attribute":
      valid = isRecord(value.object) && isId(value.property ?? value.attribute); break;
    case "linked": case "linked-value":
      valid = isId(value.instructionId); break;
    case "count": valid = isId(value.subject); break;
    case "arithmetic":
      valid = Array.isArray(value.operands) && value.operands.length > 0 &&
        value.operands.every((operand: unknown) => isExpr(operand, active));
      break;
    default: valid = false;
  }
  active.delete(value);
  return valid;
}
function parseArgs(value: unknown): DeckArgs {
  if (!isRecord(value)) throw new TypeError("continuous.deck requires args");
  const allowed = ["mode", "amount", "name", "appliesTo", "duration"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid continuous.deck argument: " + key);
    }
  }
  return { ...value } as unknown as DeckArgs;
}
function appliesTo(value: Value): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.deck appliesTo must be an object filter");
  return value as unknown as ObjectFilter;
}
function durationOf(value: Value, ctx: ResolveContext): DurationValue {
  const name = typeof value === "string" ? value : null;
  if (name === "permanent") return { type: "permanent" };
  if (name === "this-turn") return { type: "end-of-turn" };
  if (name === "this-combat") return { type: "end-of-combat" };
  if (name === "while-source-here") {
    return { type: "while-source-in-zone", source: ctx.source.ref };
  }
  throw new TypeError("continuous.deck duration must be this-turn, this-combat, permanent, or while-source-here");
}

export default {
  op: "continuous.deck",
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: DeckArgs): InstructionResult => {
    const mode = args.mode === undefined ? null : ctx.evaluate(args.mode);
    if (mode !== "unlimited" && mode !== "max") {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const amount = args.amount === undefined ? undefined : ctx.evaluate(args.amount);
    if (mode === "max" && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const filter = args.appliesTo === undefined ? undefined : appliesTo(ctx.evaluate(args.appliesTo));
    const nameValue = args.name === undefined ? ctx.source.name : ctx.evaluate(args.name);
    if (typeof nameValue !== "string" || nameValue.trim().length === 0) {
      throw new TypeError("continuous.deck name must be a nonempty string");
    }
    const durationArg = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    const spec: ContinuousEffectSpec = {
      id: "continuous-deck:" + ctx.source.ref.id + ":" + ctx.source.ref.zoneEntryId,
      layer: "ability",
      source: ctx.source.ref,
      filter: filter ?? { characteristics: { name: nameValue } },
      effect: {
        kind: "deck-limit",
        mode,
        ...(mode === "max" ? { amount } : {}),
        ...(args.name === undefined ? {} : { name: nameValue }),
      },
    };
    ctx.addContinuous(spec, durationOf(durationArg, ctx));
    ctx.link("registered", { id: spec.id, duration: durationArg });
    return { status: "executed", events: [] };
  },
};
