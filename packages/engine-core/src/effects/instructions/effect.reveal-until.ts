import type {
  ActionOutcome, Expr, GameEvent, InstructionDef, InstructionResult, ObjectRef,
  ResolveContext, Schema, Value
} from "../contract.js";
import { disclosedRefs, inspectFilter, isInspectExpression } from "./effect.inspect.js";

/**
 * CR v1.5 425.1–425.4, 432.1.c: reveal a real top-to-bottom prefix, including
 * the first card successfully revealed that satisfies `until`. No cards move,
 * no Burn Out occurs, and cards below that match are never disclosed.
 *
 * The existing Dazzling Aurora IR supplies from: "deck-top", until: { type:
 * "unit" }, linkKey: "revealed". All arguments remain Expr nodes; omitted
 * player means the resolving ability's controller (190.6.d / 191.5.b).
 * `linkKey` names the ordered actual disclosure list. `revealedMatch` is the
 * first matching reference (or null), `revealedRest` is the ordered disclosed
 * list excluding that reference, and `revealedUnit` is the existing card IR's
 * unit binding. These are private engine bindings; visibility is provided by
 * the public reveal actions, not by publishing the remainder of the deck.
 */
export interface RevealUntilArgs {
  readonly from: Expr;
  readonly until: Expr;
  readonly player?: Expr;
  readonly linkKey?: Expr;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const keyOf = (ref: ObjectRef): string => JSON.stringify([ref.id, ref.zoneEntryId]);

function invalid(message: string): never { throw new TypeError(`effect.reveal-until: ${message}`); }

const argsSchema: Schema<RevealUntilArgs> = {
  parse(value: unknown): RevealUntilArgs {
    if (!record(value) || !isInspectExpression(value.from) || !isInspectExpression(value.until)) {
      invalid("from and until must be Expr nodes");
    }
    for (const [key, expression] of Object.entries(value)) {
      if (!["from", "until", "player", "linkKey"].includes(key)) invalid(`unknown argument ${key}`);
      if (expression !== undefined && !isInspectExpression(expression)) invalid(`${key} must be an Expr`);
    }
    return value as unknown as RevealUntilArgs;
  }
};

function execute(ctx: ResolveContext, args: RevealUntilArgs): InstructionResult {
  const from = ctx.evaluate(args.from);
  if (from !== "deck-top" && from !== "rune-deck-top") invalid("from must be deck-top or rune-deck-top");
  const player = args.player === undefined ? ctx.controller : ctx.evaluate(args.player);
  if (!id(player)) invalid("player must evaluate to a PlayerId");
  const linkKey = args.linkKey === undefined ? "revealed" : ctx.evaluate(args.linkKey);
  if (!id(linkKey) || ["revealedCount", "revealedMatch", "revealedUnit", "revealedRest"].includes(linkKey)) {
    invalid("linkKey must be a distinct nonempty result key");
  }
  const until = ctx.evaluate(args.until);
  if (!record(until)) invalid("until must evaluate to an ObjectFilter");
  // Use the merged filter vocabulary, including relative relations, and fail
  // closed on descriptive/unknown predicates instead of accepting every card.
  const filter = inspectFilter(until, "effect.reveal-until");
  const zone = from === "deck-top" ? "deck" : "rune-deck";
  const candidates = ctx.zoneSlice(player, zone, "top").map(object => ({ ...object.ref }));
  const events: GameEvent[] = [];
  const revealed: ObjectRef[] = [];
  let match: ObjectRef | null = null;
  let unit: ObjectRef | null = null;
  let failure: Exclude<ActionOutcome["status"], "done"> | undefined;

  for (const ref of candidates) {
    const object = ctx.object(ref);
    if (object === null || object.owner !== player || object.zone !== zone) {
      failure ??= "impossible";
      continue;
    }
    const outcome = ctx.perform({ type: "reveal", object: ref });
    events.push(...outcome.events);
    if (outcome.status !== "done") {
      failure ??= outcome.status;
      // CR 055 / 359.3.e.11: a failed reveal cannot satisfy `until`, but does
      // not prevent revealing the remaining cards in the captured sequence.
      continue;
    }
    const actual = disclosedRefs([ref], outcome);
    revealed.push(...actual);
    if (actual.length > 0 && ctx.query(filter).some(candidate => keyOf(candidate.ref) === keyOf(ref))) {
      match = { ...ref };
      unit = object.types.includes("unit") ? { ...ref } : null;
      break;
    }
  }

  const linkedValues: Record<string, Value> = {
    [linkKey]: revealed.map(ref => ({ ...ref })),
    revealedCount: revealed.length,
    revealedMatch: match === null ? null : { ...match },
    revealedUnit: unit === null ? null : { ...unit },
    revealedRest: revealed.filter(ref => match === null || keyOf(ref) !== keyOf(match)).map(ref => ({ ...ref }))
  };
  for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
  return failure === undefined
    ? { status: "executed", events, linkedValues }
    : { status: "negated", reason: failure === "prevented" ? "skipped" : failure, events };
}

export default {
  op: "effect.reveal-until",
  argsSchema,
  execute
} satisfies InstructionDef<RevealUntilArgs>;
