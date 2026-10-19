/**
 * Play an object back after a preceding Banish or move (CR v1.5 420.3-420.4,
 * 428). The initial supported destination is each object owner's Base. This is
 * a real Limited Play: every leaf is submitted through the atomic contract
 * batch, so a rejected object rolls the whole instruction back. The object is
 * never moved or put onto the Board directly.
 *
 * When both `same-location` and `owner-base` are legal, each object's chooser
 * receives a stable per-object mode choice. Choosing owner-base plays through
 * the normal Limited Play path. `same-location` remains fail-closed: the banish
 * action publishes only the new Banishment incarnation, while CR 124 invalidates
 * the old reference; the frozen ResolveContext has no authoritative mapping
 * from the new ref to the old location. `chooser: "owner"` uses the owner
 * recorded on the post-move snapshot, and `orderChooser: "controller"` asks the
 * source controller for an explicit permutation. `ignoreCost: true` supplies a
 * finalized ignore-base plan; it never rewrites printed null costs.
 */
import type {
  ActionOutcome,
  BatchAction,
  Expr,
  FinalizedCostPlan,
  GameAction,
  InstructionDef,
  InstructionResult,
  LocationRef,
  ObjectRef,
  ResolveContext,
  Value,
} from "../contract.js";
import { requireContractActionCapability } from "../contract.js";
import { buildEffectPlayCostPlan } from "../play/index.js";
import { CostPlanError } from "../../cost/plan-types.js";

export interface EffectPlayBackArgs {
  readonly objects: Expr;
  readonly chooser?: Expr;
  readonly destination?: Expr;
  readonly destinations?: Expr;
  readonly orderChooser?: Expr;
  readonly orderChoiceId?: Expr;
  readonly ignoreCost?: Expr;
  readonly linkKey?: Expr;
}

type Destination = "same-location" | "owner-base";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) && Number(value.zoneEntryId) >= 0;
}

function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  active.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, active));
  active.delete(value);
  return valid;
}

function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return Object.hasOwn(value, "value") && isValue(value.value);
    case "object-property": case "object-attribute":
      return (value.object === "self" || value.object === "source" || isRef(value.object)) &&
        isId(value.property ?? value.attribute);
    case "linked": case "linked-value": return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter));
    case "arithmetic": return Array.isArray(value.operands) && value.operands.every(operand => isExpr(operand, active));
    default: return false;
  }
}

function parseArgs(value: unknown): EffectPlayBackArgs {
  if (!isRecord(value) || !Object.hasOwn(value, "objects")) throw new TypeError("effect.play-back requires objects");
  const allowed = ["objects", "chooser", "destination", "destinations", "orderChooser", "orderChoiceId", "ignoreCost", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) throw new TypeError("Invalid effect.play-back argument: " + key);
  }
  if (value.destination !== undefined && value.destinations !== undefined) {
    throw new TypeError("effect.play-back accepts destination or destinations, not both");
  }
  return { ...value } as unknown as EffectPlayBackArgs;
}

function refs(value: unknown): ObjectRef[] {
  if (isRef(value)) return [{ ...value }];
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(refs);
}

function uniqueRefs(values: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  return values.filter(ref => {
    const key = `${ref.id}:${ref.zoneEntryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(ref => ({ ...ref }));
}

function destinations(value: Value): Destination[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.some(entry => entry !== "same-location" && entry !== "owner-base")) {
    throw new TypeError("effect.play-back destinations must contain same-location and/or owner-base");
  }
  return [...new Set(values)] as Destination[];
}

function chooser(ctx: ResolveContext, value: Value, owner: string): string | null {
  if (value === "owner") return owner;
  if (value === "controller") return ctx.controller;
  return isId(value) ? value : null;
}

function currentRef(ctx: ResolveContext, old: ObjectRef): ObjectRef | null {
  const object = ctx.query({}).find(candidate => candidate.ref.id === old.id);
  return object === undefined ? null : { ...object.ref };
}

function outcomeReason(outcome: ActionOutcome): "replaced" | "skipped" | "impossible" {
  return outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible";
}

function run(ctx: ResolveContext, args: EffectPlayBackArgs): InstructionResult {
  const linkKey = args.linkKey === undefined ? "playedBack" : ctx.evaluate(args.linkKey);
  if (!isId(linkKey)) throw new TypeError("effect.play-back linkKey must be a nonempty string");
  const evaluated = ctx.evaluate(args.objects);
  const selected = uniqueRefs(refs(evaluated));
  const destinationValue = args.destination !== undefined ? ctx.evaluate(args.destination) :
    args.destinations !== undefined ? ctx.evaluate(args.destinations) : "owner-base";
  const options = destinations(destinationValue);
  const receipt = (amount: number, objects: readonly ObjectRef[], blockedReason?: string): Record<string, Value> => ({
    amount,
    objects: objects.map(ref => ({ ...ref })),
    objectsComplete: blockedReason === undefined,
    destinations: [...options],
    ...(blockedReason === undefined ? {} : { blockedReason }),
  });
  if (selected.length === 0) {
    const value = receipt(0, []);
    ctx.link(linkKey, value);
    ctx.link(`${linkKey}.amount`, 0);
    ctx.link(`${linkKey}.objects`, []);
    return { status: "executed", events: [], linkedValues: { [linkKey]: value, [`${linkKey}.amount`]: 0, [`${linkKey}.objects`]: [] } };
  }

  let ordered = selected;
  const orderChooserValue = args.orderChooser === undefined ? undefined : ctx.evaluate(args.orderChooser);
  if (ordered.length > 1 && orderChooserValue !== undefined) {
    const orderPlayer = chooser(ctx, orderChooserValue, ctx.controller);
    if (orderPlayer === null) return { status: "negated", reason: "impossible", events: [] };
    const requestId = args.orderChoiceId === undefined ?
      `effect-play-back:${ctx.source.ref.id}:${ctx.source.ref.zoneEntryId}:order` :
      ctx.evaluate(args.orderChoiceId);
    if (!isId(requestId)) throw new TypeError("effect.play-back orderChoiceId must evaluate to a nonempty string");
    const answer = ctx.choose<readonly ObjectRef[]>({
      id: requestId, type: "order", chooser: orderPlayer, visibility: "public", options: ordered,
    });
    if (!Array.isArray(answer) || answer.length !== ordered.length || answer.some((ref, index) =>
      !isRef(ref) || !ordered.some(option => option.id === ref.id && option.zoneEntryId === ref.zoneEntryId) ||
      answer.slice(0, index).some(previous => isRef(previous) && previous.id === ref.id && previous.zoneEntryId === ref.zoneEntryId))) {
      throw new TypeError("Invalid effect.play-back order answer");
    }
    ordered = answer.map(ref => ({ ...ref }));
  }

  const chooserValue = args.chooser === undefined ? "owner" : ctx.evaluate(args.chooser);
  const ignoreCost = args.ignoreCost === undefined ? false : ctx.evaluate(args.ignoreCost);
  if (typeof ignoreCost !== "boolean") throw new TypeError("effect.play-back ignoreCost must evaluate to a boolean");
  const actions: GameAction[] = [];
  for (const object of ordered) {
    const snapshot = ctx.object(object);
    if (snapshot === null || snapshot.zone !== "banishment") {
      const value = receipt(0, [], "play-back-object-not-currently-in-banishment");
      ctx.link(linkKey, value);
      return { status: "negated", reason: "impossible", events: [] };
    }
    const player = chooser(ctx, chooserValue, snapshot.owner);
    if (player === null) {
      const value = receipt(0, [], "play-back-owner-chooser-unavailable");
      ctx.link(linkKey, value);
      return { status: "negated", reason: "impossible", events: [] };
    }
    let selectedDestination: Destination;
    if (options.length === 1) {
      selectedDestination = options[0]!;
    } else {
      const requestId = `effect-play-back:${ctx.source.ref.id}:${ctx.source.ref.zoneEntryId}:${object.id}:${object.zoneEntryId}:destination`;
      selectedDestination = ctx.choose<Destination>({
        id: requestId, type: "mode", chooser: player, visibility: "public", options,
      });
      if (!options.includes(selectedDestination)) throw new TypeError("Invalid effect.play-back destination answer");
    }
    if (selectedDestination === "same-location") {
      const value = receipt(0, [], "play-back-same-location-requires-authoritative-pre-banish-location");
      ctx.link(linkKey, value);
      return { status: "negated", reason: "impossible", events: [] };
    }
    const location: LocationRef = { type: "base", player: snapshot.owner };
    let finalized: FinalizedCostPlan | undefined;
    try {
      finalized = buildEffectPlayCostPlan(ctx, {
        object,
        player,
        ...(ignoreCost ? { ignoreCost: true } : {}),
      });
    } catch (error) {
      if (error instanceof CostPlanError) {
        const value = receipt(0, [], `play-back-cost-unavailable:${error.message}`);
        ctx.link(linkKey, value);
        return { status: "negated", reason: "impossible", events: [] };
      }
      throw error;
    }
    if (finalized === undefined) {
      const value = receipt(0, [], "play-back-finalized-cost-unavailable");
      ctx.link(linkKey, value);
      return { status: "negated", reason: "impossible", events: [] };
    }
    actions.push({ type: "play", object, player, location, cost: finalized });
  }

  const batch: BatchAction = Object.freeze({
    type: "batch",
    transactionId: `effect-play-back:${ctx.source.ref.id}:${ctx.source.ref.zoneEntryId}`,
    actions: Object.freeze(actions),
  });
  const outcome = requireContractActionCapability(ctx).perform(batch);
  if (outcome.status !== "done") {
    const value = receipt(0, [], `play-back-atomic-${outcome.status}`);
    ctx.link(linkKey, value);
    return { status: "negated", reason: outcomeReason(outcome), events: [...outcome.events] };
  }
  const played = actions.flatMap(action => {
    if (action.type !== "play") return [];
    const ref = currentRef(ctx, action.object);
    return ref === null ? [] : [ref];
  });
  const value = receipt(actions.length, played);
  const linkedValues: Record<string, Value> = {
    [linkKey]: value,
    [`${linkKey}.amount`]: actions.length,
    [`${linkKey}.objects`]: played.map(ref => ({ ...ref })),
  };
  for (const [key, linked] of Object.entries(linkedValues)) ctx.link(key, linked);
  return { status: "executed", events: [...outcome.events], linkedValues };
}

const playBack: InstructionDef<EffectPlayBackArgs> = {
  op: "effect.play-back",
  argsSchema: { parse: parseArgs },
  execute: (ctx, args) => ctx.transaction === undefined ? run(ctx, args) : ctx.transaction(() => run(ctx, args)),
};

export default playBack;
