import type { Expr, PlayerId } from "../contract.js";
import type { InstructionDef, Schema, Value } from "../contract.js";

/**
 * effect.channel — channel runes from the top of a player's Rune Deck onto the
 * board (their rune zone).
 *
 * Rules (Core Rules v1.5):
 * - 431.1: Channeling takes one or more Runes from the top of the player's
 *   Rune Deck and puts them on the board.
 * - 431.2 / 431.2.a: The effect may stipulate how the runes enter (e.g.
 *   "channel 1 rune exhausted"); by default runes are channeled readied.
 * - 431.3: If the Rune Deck holds fewer runes than instructed, channel as
 *   many as possible. A shortfall is not a failure and does not negate the
 *   instruction; the actual channeled count is exposed via the linked value
 *   so follow-up instructions ("If you couldn't channel 2 runes this way,
 *   draw 1", 431.5) can test it.
 * - 431.4 / 431.4.b: Channeling is a Limited Action; this primitive covers
 *   channeling directed by game effects. The Channel Phase channel
 *   (315.3.b / 431.4.a) is turn structure and belongs to turn/, not here.
 * - 431.5: Card format is "Channel X rune(s)" with optional stipulations.
 *
 * Args:
 * - player: the player who channels. Either a PlayerId string or an Expr
 *   evaluating to one (e.g. a controller pick); defaults to the ability's
 *   controller when omitted.
 * - amount: number of runes to channel, as an Expr evaluated at resolution
 *   time (constant, linked value, count, ...). Must evaluate to a
 *   non-negative integer.
 * - exhausted: optional boolean Expr; true channels the runes exhausted
 *   (431.2), false/omitted channels them readied (431.2.a). Passed through
 *   to the channel-rune action; the engine applies the entry state.
 *
 * Boundary notes: runes come from the Rune Deck (not the Main Deck) and enter
 * the rune zone, which is distinct from the resource pool of Energy/Power;
 * "Add [1]" is gain-energy/gain-power, not channel. Moving a rune that is
 * already on the board is effect.zone / move-zone territory, not channel.
 *
 * Result semantics (P0 contract 3.6 rules 1-3): a done action yields
 * executed and links "channeled" with the actual number of runes moved (for
 * "if you do" / shortfall checks); any replaced/prevented/impossible outcome
 * yields negated; no object targets exist here, so an unresolvable player
 * expression negates as impossible rather than ignoring.
 */
export interface ChannelArgs {
  readonly player?: PlayerId | Expr;
  readonly amount: Expr;
  readonly exhausted?: boolean | Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

const argsSchema: Schema<ChannelArgs> = {
  parse(value: unknown): ChannelArgs {
    if (!isRecord(value)) throw new Error("effect.channel args must be an object");
    const { player, amount, exhausted } = value;
    if (player !== undefined && typeof player !== "string" && !isExpr(player)) {
      throw new Error("effect.channel player must be a PlayerId or Expr");
    }
    if (!isExpr(amount)) throw new Error("effect.channel amount must be an Expr");
    if (exhausted !== undefined && typeof exhausted !== "boolean" && !isExpr(exhausted)) {
      throw new Error("effect.channel exhausted must be a boolean or Expr");
    }
    return { player: player as ChannelArgs["player"], amount, exhausted: exhausted as ChannelArgs["exhausted"] };
  }
};

function resolveAmount(raw: Value): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

const definition = {
  op: "effect.channel",
  argsSchema,
  execute(ctx, args) {
    const player = typeof args.player === "string"
      ? args.player
      : args.player === undefined
        ? ctx.controller
        : ctx.evaluate(args.player);
    if (typeof player !== "string" || player.length === 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    const amount = resolveAmount(ctx.evaluate(args.amount));
    if (amount === null) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    const exhausted = typeof args.exhausted === "boolean"
      ? args.exhausted
      : args.exhausted === undefined
        ? false
        : ctx.evaluate(args.exhausted) === true;

    // CR 431.2.a: channeling zero runes channels nothing but succeeds, so a
    // following "if you couldn't channel 2 runes this way" sees the truth.
    if (amount === 0) {
      ctx.link("channeled", 0);
      return { status: "executed", events: [], linkedValues: { channeled: 0 } };
    }

    const outcome = ctx.perform({ type: "channel-rune", player, amount, exhausted });
    if (outcome.status !== "done") {
      return {
        status: "negated",
        reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
        events: [...outcome.events]
      };
    }

    const channeled = typeof outcome.result === "number" ? outcome.result : amount;
    ctx.link("channeled", channeled);
    return { status: "executed", events: [...outcome.events], linkedValues: { channeled } };
  }
} satisfies InstructionDef<ChannelArgs>;

export default definition;
