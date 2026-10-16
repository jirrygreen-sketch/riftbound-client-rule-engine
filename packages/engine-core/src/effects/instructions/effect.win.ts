/**
 * Declare the single player instructed to win (Core Rules v1.5 195, 196).
 *
 * Args are Expr values, evaluated through ResolveContext:
 * - player defaults to the ability controller. It evaluates to a PlayerId, or
 *   { kind: "target", id } for the controller of a current object obtained from
 *   ctx.targets(id), { kind: "pick", id } for PlayerIds from ctx.picks(id), or
 *   { kind: "choose", id, options: PlayerId[] } for a public non-target choice
 *   by the ability controller. Choice ids are stable across suspension/replay.
 *   Target/pick selectors must identify exactly one distinct player; multiple
 *   players are impossible, never sequential wins. Empty targets are ignored;
 *   empty picks/options are impossible. Duplicate candidates count only once.
 * - linkKey defaults to "winner" and evaluates to a nonempty string. It stores
 *   the actual done action result (the winner if no result is supplied), or
 *   null on negation. Ignored instructions do not write a linked value.
 * The schema also normalizes evaluated argument values supplied by the current
 * ability interpreter back to constant Expr values.
 *
 * Conditions such as The Grand Plaza's seven units and Gutter Palace's exact
 * counts belong to condition.predicate / the instruction's condition, and the
 * hold/Beginning timing belongs to trigger/turn code (135.2.b.5-6, 383.2.a-b). This
 * primitive only performs win; it never awards score, checks the Victory Score,
 * or waits for scoring cleanup (194.2, 323.1, 470.1). Game termination belongs
 * to the authoritative win action (196). Replacement/prevention/impossibility
 * negate the instruction; stale targets are ignored (359.3.e.12, 14.a-b).
 *
 * CR 195.1 loss/removal is blocked: the closed GameAction vocabulary has no
 * player-removal action. It must not be approximated by declaring an opponent
 * the winner, especially in multiplayer. There is deliberately no loss mode.
 */
import type {
  Expr, InstructionDef, InstructionResult, PlayerId, ResolveContext, Value
} from "../contract.js";

export interface EffectWinArgs {
  readonly player?: Expr;
  readonly linkKey?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function expression(value: unknown): Expr {
  if (isRecord(value) && typeof value.kind === "string" && [
    "constant", "literal", "object-property", "object-attribute", "linked",
    "linked-value", "count", "arithmetic"
  ].includes(value.kind)) {
    if ((value.kind === "constant" || value.kind === "literal") && !("value" in value)) {
      throw new TypeError("effect.win constant Expr requires a value");
    }
    return value as unknown as Expr;
  }
  if (typeof value === "string" || isRecord(value) && ["target", "pick", "choose"].includes(String(value.kind))) {
    return { kind: "constant", value: value as Value };
  }
  throw new TypeError("effect.win arguments must be Expr values or evaluated player selectors/strings");
}

function parseArgs(value: unknown): EffectWinArgs {
  if (!isRecord(value)) throw new TypeError("effect.win args must be an object");
  for (const key of Object.keys(value)) {
    if (key !== "player" && key !== "linkKey") throw new TypeError("Unknown effect.win argument: " + key);
  }
  return {
    ...(value.player === undefined ? {} : { player: expression(value.player) }),
    ...(value.linkKey === undefined ? {} : { linkKey: expression(value.linkKey) })
  };
}

interface Candidates {
  readonly players: readonly PlayerId[];
  readonly targeted: boolean;
  readonly choiceId?: string;
}

function candidates(ctx: ResolveContext, value: Value): Candidates {
  if (isId(value)) return { players: [value], targeted: false };
  if (!isRecord(value)) return { players: [], targeted: false };
  if (!isId(value.id)) throw new TypeError("effect.win player selector requires a nonempty id");
  switch (value.kind) {
    case "target": {
      const players = ctx.targets(value.id).flatMap(ref => {
        const object = ctx.object(ref);
        return object === null ? [] : [object.controller];
      });
      return { players: [...new Set(players)], targeted: true };
    }
    case "pick": {
      const picks = ctx.picks(value.id);
      return { players: picks.every(isId) ? [...new Set(picks)] : [], targeted: false };
    }
    case "choose": {
      if (!Array.isArray(value.options) || !value.options.every(isId)) {
        throw new TypeError("effect.win choice options must be PlayerIds");
      }
      return { players: [...new Set(value.options)], targeted: false, choiceId: value.id };
    }
    default: throw new TypeError("effect.win player selector must name target, pick, or choose");
  }
}

export default {
  op: "effect.win",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const linkKey = args.linkKey === undefined ? "winner" : ctx.evaluate(args.linkKey);
    if (!isId(linkKey)) throw new TypeError("effect.win linkKey must evaluate to a nonempty string");
    const selected = candidates(ctx, args.player === undefined ? ctx.controller : ctx.evaluate(args.player));
    if (selected.targeted && selected.players.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }
    if (selected.players.length === 0 || selected.players.length > 1 && selected.choiceId === undefined) {
      ctx.link(linkKey, null);
      return { status: "negated", reason: "impossible", events: [] };
    }
    const player = selected.players.length === 1 ? selected.players[0]! : ctx.choose<PlayerId>({
      id: selected.choiceId!, type: "mode", chooser: ctx.controller,
      visibility: "public", options: selected.players
    });
    if (!selected.players.includes(player)) {
      ctx.link(linkKey, null);
      return { status: "negated", reason: "impossible", events: [] };
    }
    const outcome = ctx.perform({ type: "win", player });
    if (outcome.status !== "done") {
      ctx.link(linkKey, null);
      return {
        status: "negated",
        reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
        events: [...outcome.events]
      };
    }
    const winner = outcome.result === undefined ? player : outcome.result;
    ctx.link(linkKey, winner);
    return { status: "executed", events: [...outcome.events], linkedValues: { [linkKey]: winner } };
  }
} satisfies InstructionDef<EffectWinArgs>;
