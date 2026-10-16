/**
 * Gain points from an effect (Core Rules v1.5 194.1.c, 470.1-3).
 * All arguments are card-dsl Expr values, evaluated through ResolveContext:
 * - amount is required and must evaluate to a nonnegative safe integer. Zero
 *   succeeds without a score action. Negative amounts are not point loss.
 * - player defaults to the ability controller. It evaluates to a PlayerId or
 *   PlayerId[] (each player gains the amount once, in first-appearance order),
 *   or to one of these selectors:
 *   { kind: "target", id }: current controllers from ctx.targets(id); entirely
 *   stale targets are ignored, surviving targets still execute (359.3.e.7-8).
 *   { kind: "pick", id }: PlayerIds from ctx.picks(id), without targeting.
 *   { kind: "choose", id, options: PlayerId[] }: the controller chooses one
 *   recipient publicly through ctx.choose; id is stable for suspend/replay.
 *   Duplicates never award twice; empty non-target sets are impossible.
 * - linkKey defaults to "scored". The linked value is an ordered list of
 *   { player, amount } for actual successful awards; negation retains partial
 *   awards and zero awards link an empty list. Ignored instructions do not link.
 * The schema also accepts evaluated JSON arguments from the ability interpreter
 * and normalizes them to constant Expr values.
 *
 * This is gaining points, distinct from Scoring a Battlefield (470.1-3). It
 * neither establishes control nor consumes the once-per-turn Battlefield score
 * (471-472), triggers Hold/Conquer, nor applies Conquer's Final Point draw
 * replacement: non-Conquer points can be the Final Point (473.1.a.1-b.1).
 * The authoritative score action owns point-gain replacements and prevention;
 * any replaced/prevented/impossible action negates this instruction, while
 * other recipients are still processed (359.3.e.11, 359.3.e.14.b).
 * Timing and prerequisites, including Yasuo's third move and The Arena's
 * Greatest's first Beginning Phase, belong to triggers/conditions. Cleanup owns
 * Victory Score comparisons and ties (194.2-3, 323.1, 474); effect.win is a
 * separate explicit winning instruction. No score cap, automatic win, draw,
 * turn advancement, or Battlefield scoring window is implemented here.
 *
 * Contract gap: targets returns only ObjectRef[], not PlayerIds. Its selector
 * therefore means a targeted object's controller, never a fabricated player
 * object. Native player targets need a contract addition; non-target player
 * selections already work through picks/choose or an explicit player Expr.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, PlayerId, ResolveContext,
  Value
} from "../contract.js";

export interface EffectScoreArgs {
  readonly amount: Expr;
  readonly player?: Expr;
  readonly linkKey?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if ((!isRecord(value) && !Array.isArray(value)) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isSelector(value: unknown): boolean {
  if (value === "self" || value === "source") return true;
  if (!isRecord(value)) return false;
  // The interpreter may already have bound a symbolic selector to a reference.
  if (isId(value.id) && Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0) return true;
  return Object.keys(value).length === 1 && ["target", "pick", "linked"].some(key => isId(value[key]));
}

function isExpr(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case "constant": case "literal": return "value" in value;
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "object-property": return isSelector(value.object) && isId(value.property);
    case "object-attribute": return isSelector(value.object) && isId(value.attribute);
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter));
    case "arithmetic": {
      if (!Array.isArray(value.operands) || !value.operands.every(operand => isRecord(operand) && isExpr(operand))) return false;
      if (["add", "mul", "multiply", "min", "max"].includes(String(value.operator))) return value.operands.length > 0;
      if (["sub", "subtract", "div", "divide"].includes(String(value.operator))) return value.operands.length === 2;
      return value.operator === "neg" && value.operands.length === 1;
    }
    default: return false;
  }
}

function expression(value: unknown): Expr {
  if (!isValue(value)) throw new TypeError("effect.score arguments must contain finite JSON values");
  if (isRecord(value) && typeof value.kind === "string" && !["target", "pick", "choose"].includes(value.kind)) {
    if (!isExpr(value)) throw new TypeError("Invalid effect.score Expr");
    return value as unknown as Expr;
  }
  return { kind: "constant", value };
}

function parseArgs(value: unknown): EffectScoreArgs {
  if (!isRecord(value)) throw new TypeError("effect.score args must be an object");
  for (const key of Object.keys(value)) {
    if (!["amount", "player", "linkKey"].includes(key)) throw new TypeError("Unknown effect.score argument: " + key);
  }
  if (value.amount === undefined) throw new TypeError("effect.score requires amount");
  return {
    amount: expression(value.amount),
    ...(value.player === undefined ? {} : { player: expression(value.player) }),
    ...(value.linkKey === undefined ? {} : { linkKey: expression(value.linkKey) })
  };
}

interface Recipients {
  readonly players: readonly PlayerId[];
  readonly targeted: boolean;
  readonly choiceId?: string;
}

function players(value: unknown): PlayerId[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.every(isId) ? [...new Set(entries)] : [];
}

function resolveRecipients(ctx: ResolveContext, value: Value): Recipients {
  if (!isRecord(value)) return { players: players(value), targeted: false };
  if (!isId(value.id)) throw new TypeError("effect.score player selector requires a nonempty id");
  switch (value.kind) {
    case "target": return {
      players: [...new Set(ctx.targets(value.id).flatMap(ref => {
        const object = ctx.object(ref);
        return object === null ? [] : [object.controller];
      }))], targeted: true
    };
    case "pick": return { players: players(ctx.picks(value.id)), targeted: false };
    case "choose": {
      if (!Array.isArray(value.options) || !value.options.every(isId)) {
        throw new TypeError("effect.score choice options must be PlayerIds");
      }
      return { players: players(value.options), targeted: false, choiceId: value.id };
    }
    default: throw new TypeError("effect.score player selector must name target, pick, or choose");
  }
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export default {
  op: "effect.score",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const selected = resolveRecipients(ctx, args.player === undefined ? ctx.controller : ctx.evaluate(args.player));
    if (selected.targeted && selected.players.length === 0) return { status: "ignored", reason: "mistargeted" };
    const linkKey = args.linkKey === undefined ? "scored" : ctx.evaluate(args.linkKey);
    if (!isId(linkKey)) throw new TypeError("effect.score linkKey must evaluate to a nonempty string");
    const awards: { player: PlayerId; amount: number }[] = [];
    const impossible = (): InstructionResult => {
      ctx.link(linkKey, awards);
      return { status: "negated", reason: "impossible", events: [] };
    };
    const amount = ctx.evaluate(args.amount);
    if (!isAmount(amount) || selected.players.length === 0) return impossible();
    let recipients = selected.players;
    if (selected.choiceId !== undefined && recipients.length > 1) {
      const answer = ctx.choose<PlayerId>({
        id: selected.choiceId, type: "mode", chooser: ctx.controller,
        visibility: "public", options: recipients
      });
      if (!recipients.includes(answer)) return impossible();
      recipients = [answer];
    }
    // Reject unsafe arithmetic before awarding any player; never clamp points.
    for (const player of recipients) {
      let score: number;
      try { score = ctx.player(player).score; } catch { return impossible(); }
      if (!isAmount(score) || !Number.isSafeInteger(score + amount)) return impossible();
    }
    const events: GameEvent[] = [];
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    if (amount > 0) for (const player of recipients) {
      const before = ctx.player(player).score;
      const outcome = ctx.perform({ type: "score", player, amount });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
      } else {
        awards.push({ player, amount: isAmount(outcome.result) ? outcome.result : ctx.player(player).score - before });
      }
    }
    ctx.link(linkKey, awards);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: awards } };
  }
} satisfies InstructionDef<EffectScoreArgs>;
