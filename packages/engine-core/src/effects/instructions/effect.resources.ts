/**
 * Add Energy / domain Power to one player's Rune Pool (CR v1.5 163.1-2,
 * 166.1-2, 168, 430.1, 430.4-5). Every argument is a card-dsl Expr:
 * - energy: nonnegative safe integer; omitted means no Energy addition.
 * - power: ordered PowerPaymentSource[]; named Domains and Universal Power keep
 *   their source identity. Repeats add multiple separate Power lots.
 *   At least one of energy / power must be present. Zero / [] is a successful
 *   no-op, not a gain action. Null printed characteristics are never zero.
 * - player: PlayerId or candidate PlayerId[]; defaults to ctx.controller.
 * - target: TargetSpec id, read only through ctx.targets; current target
 *   controllers are candidate recipients. All targets lost means ignored
 *   (359.3.e.5-8). This is for an explicit "its controller adds" instruction.
 * - pick: PickSpec id, read only through ctx.picks; entries are PlayerIds or
 *   current ObjectRefs whose controllers are candidates. Picks are never
 *   targets (355.7); an empty or entirely stale pick is impossible.
 *   player / target / pick are mutually exclusive; candidates are deduplicated.
 * - choiceId: stable public mode-choice id, required if there is more than one
 *   recipient candidate; ctx.controller chooses one before any action occurs.
 * - linkKey: defaults to "resources"; stores { player, energy, power } with
 *   actual successful additions, including partial success on negation.
 *
 * Energy is submitted before Power. All actions done means executed; any
 * replaced / prevented / impossible means negated (P0 3.6 rules 1-3).
 * Resource types are checked before any action; malformed evaluated values
 * are impossible, without coercion or a partial Energy gain.
 *
 * Timing boundary: Add triggered / activated abilities finalize and resolve
 * immediately without passing Priority / Focus (430.2, 430.2.a); Add spells
 * retain normal spell timing (430.2.b), and Add Reactions can pay during costs
 * (430.3). The chain / payment caller owns those rules; this primitive neither
 * creates a chain item nor changes priority. Exhaust / recycle costs belong
 * to cost primitives, Channel belongs to effect.channel (431), and pool
 * clearing belongs to turn structure (167). Domain choices can be supplied
 * by a prior choice instruction via a linked Expr.
 *
 * Universal Power (163.2.b) remains distinct from the six named Domains and is
 * never approximated by a chosen domain.
 */
import type {
  Domain, Expr, GameAction, GameEvent, InstructionDef, InstructionResult,
  ObjectRef, PlayerId, PlayerSnapshot, PowerPaymentSource, ResolveContext, Value
} from "../contract.js";

export interface ResourcesArgs {
  readonly energy?: Expr;
  readonly power?: Expr;
  readonly player?: Expr;
  readonly target?: Expr;
  readonly pick?: Expr;
  readonly choiceId?: Expr;
  readonly linkKey?: Expr;
}

const DOMAINS: readonly Domain[] = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
const UNIVERSAL_POWER: readonly PowerPaymentSource[] = ["universal", "any", "universal-power"];
const ARG_KEYS = ["energy", "power", "player", "target", "pick", "choiceId", "linkKey"];

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

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value) || !isValue(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value;
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter));
    case "object-property": return isSelector(value.object) && isId(value.property);
    case "object-attribute": return isSelector(value.object) && isId(value.attribute);
    case "arithmetic": {
      if (!Array.isArray(value.operands) || !value.operands.every(isExpr)) return false;
      if (["add", "mul", "multiply", "min", "max"].includes(String(value.operator))) return value.operands.length > 0;
      if (["sub", "subtract", "div", "divide"].includes(String(value.operator))) return value.operands.length === 2;
      return value.operator === "neg" && value.operands.length === 1;
    }
    default: return false;
  }
}

function isSelector(value: unknown): boolean {
  // The interpreter binds authored selectors to runtime references.
  if (value === "self" || value === "source" || isRef(value)) return true;
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  return ["target", "pick", "linked"].some(key => isId(value[key]));
}

function parseArgs(value: unknown): ResourcesArgs {
  if (!isRecord(value)) throw new TypeError("effect.resources args must be an object");
  for (const [key, expression] of Object.entries(value)) {
    if (!ARG_KEYS.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid effect.resources Expr argument: " + key);
    }
  }
  if (value.energy === undefined && value.power === undefined) {
    throw new TypeError("effect.resources requires energy or power");
  }
  if ([value.player, value.target, value.pick].filter(entry => entry !== undefined).length > 1) {
    throw new TypeError("effect.resources accepts only one of player, target, or pick");
  }
  return value as unknown as ResourcesArgs;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPower(value: unknown): value is PowerPaymentSource[] {
  return Array.isArray(value) && value.every(source =>
    DOMAINS.includes(source as Domain) || UNIVERSAL_POWER.includes(source as PowerPaymentSource));
}

function recipientCandidates(ctx: ResolveContext, args: ResourcesArgs): PlayerId[] {
  let entries: readonly unknown[];
  if (args.target !== undefined || args.pick !== undefined) {
    const id = ctx.evaluate((args.target ?? args.pick)!);
    if (!isId(id)) throw new TypeError("effect.resources target / pick must evaluate to a spec id");
    entries = args.target !== undefined ? ctx.targets(id) : ctx.picks(id);
  } else {
    const value = args.player === undefined ? ctx.controller : ctx.evaluate(args.player);
    entries = Array.isArray(value) ? value : [value];
    if (!entries.every(isId)) return [];
  }
  const players: PlayerId[] = [];
  for (const entry of entries) {
    const player = isRef(entry) ? ctx.object(entry)?.controller : isId(entry) ? entry : null;
    if (player && !players.includes(player)) players.push(player);
  }
  return players;
}

function addedPower(before: readonly PowerPaymentSource[], after: readonly PowerPaymentSource[]): PowerPaymentSource[] {
  const remaining = [...before];
  return after.filter(domain => {
    const index = remaining.indexOf(domain);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

export default {
  op: "effect.resources",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const candidates = recipientCandidates(ctx, args);
    if (args.target !== undefined && candidates.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const impossible = (): InstructionResult => ({ status: "negated", reason: "impossible", events: [] });
    const energy = args.energy === undefined ? 0 : ctx.evaluate(args.energy);
    const power = args.power === undefined ? [] : ctx.evaluate(args.power);
    if (!isAmount(energy) || !isPower(power) || candidates.length === 0) return impossible();
    const linkKey = args.linkKey === undefined ? "resources" : ctx.evaluate(args.linkKey);
    if (!isId(linkKey)) throw new TypeError("effect.resources linkKey must evaluate to a nonempty string");

    const choiceId = args.choiceId === undefined ? undefined : ctx.evaluate(args.choiceId);
    if (choiceId !== undefined && !isId(choiceId)) return impossible();
    let player = candidates[0]!;
    if (candidates.length > 1) {
      if (!isId(choiceId)) return impossible();
      player = ctx.choose<PlayerId>({ id: choiceId, type: "mode", chooser: ctx.controller, visibility: "public", options: candidates });
      if (!candidates.includes(player)) return impossible();
    }
    let initial: PlayerSnapshot;
    try { initial = ctx.player(player); } catch { return impossible(); }
    if (!Number.isSafeInteger(initial.energy + energy)) return impossible();

    const actions: GameAction[] = [];
    if (energy > 0) actions.push({ type: "gain-energy", player, amount: energy });
    if (power.length > 0) actions.push({ type: "gain-power", player, power: [...power] });
    const events: GameEvent[] = [];
    let actualEnergy = 0;
    const actualPower: PowerPaymentSource[] = [];
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    for (const action of actions) {
      const before = ctx.player(player);
      const outcome = ctx.perform(action);
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
      } else if (action.type === "gain-energy") {
        actualEnergy += isAmount(outcome.result) ? outcome.result : ctx.player(player).energy - before.energy;
      } else if (action.type === "gain-power") {
        actualPower.push(...(isPower(outcome.result) ? outcome.result : addedPower(before.power, ctx.player(player).power)));
      }
    }
    const value: Value = { player, energy: actualEnergy, power: actualPower };
    ctx.link(linkKey, value);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<ResourcesArgs>;
