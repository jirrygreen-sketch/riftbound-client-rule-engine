import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectFilter,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";

/**
 * effect.buff - add or spend Buff counters (Buff 标记的添加 / 消耗).
 *
 * Rules evidence (Core Rules v1.5):
 * - 702: Buffs are counters placed on Units.
 * - 702.2.a: To Buff a Unit, a player chooses a Unit and places a buff on it;
 *   that Unit is Buffed for as long as the buff remains on it.
 * - 702.2.b: Spending a Buff removes a single Buff counter from a Unit.
 * - 702.2.b.1: A buff cannot be spent from a Unit that does not have a buff.
 * - 702.2.b.2: A player can only spend buffs on units they control.
 * - 702.3 / 702.3.a: There can only be one Buff on a Unit at a time; adding to
 *   a Unit that already has one is a no-op, unless another effect grants
 *   permission to be Buffed multiple times (427.1.b.2).
 * - 427.1.c and 427.3: Units that already have a Buff can still be chosen for a
 *   Buff action; they simply are not Buffed, and follow-ups keyed on
 *   "was buffed" must look at the actual per-unit result.
 *
 * Boundary with neighboring primitives: this primitive only places or removes
 * Buff counters through the closed "buff" / "spend-buff" GameActions. The +1
 * Might each Buff contributes (703) is derived by the layers system from the
 * counter count; temporary Might modifications ("gets +1 [M] this turn")
 * belong to continuous.might, never to this primitive.
 *
 * Args (value fields are card-dsl Exprs evaluated via ctx.evaluate):
 * - mode: "buff" (add) or "spend" (spend/remove).
 * - objects: how the affected Units are determined. The value may be an
 *   `Expr` or an already-evaluated value with one of these shapes:
 *   - `{ kind: "source" }`: the ability host ("buff me", 355.10.d.1);
 *   - `{ kind: "target", id }`: a Finalize-locked TargetSpec;
 *   - `{ kind: "pick", id }`: a resolution-time non-target pick;
 *   - `{ kind: "query", filter }`: a programmatic, non-target set;
 *   - `{ kind: "choose", id, filter, min?, max?, prompt? }`: a resolution-time
 *     non-target choice over the current matching set;
 *   - one `ObjectRef`, an array of refs, or `{ objects: ObjectRef[] }` from a
 *     linked result.
 *   `target` remains as the legacy shorthand for `{ kind: "target", id }`.
 *   `pick` remains as the legacy shorthand for `{ kind: "pick", id }`.
 * - amount: Buff counters per object. Defaults to literal 1 (one Buff per
 *   Buff/spend wording, 702.2.a / 702.2.b). A buff action never places more
 *   than one Buff on a Unit: 702.3/702.3.a caps the count at one, and this
 *   primitive has no multiple-Buff permission input. Spend mode removes at
 *   most the counters actually present (702.2.b.1).
 * - chooser: PlayerId of the player who spends (spend mode only; default is
 *   ctx.controller). Enforces 702.2.b.2 by skipping units the spender does
 *   not control.
 * - chooseUpTo: when true and more than one legal target remains, the
 *   chooser picks up to that many of them with ctx.choose() ("buff up to
 *   two other friendly units", e.g. ogn-141-298 Kinkou Monk). Choosing none
 *   yields negated with reason "skipped".
 *
 * Per-unit results are written to ctx.link under the keys "buffed" and
 * "spent" (arrays of ObjectRefs plus the counts "buffedCount" / "spentCount")
 * so "if you do" / "if it was buffed this way" follow-ups read the actual
 * result (427.1.c).
 */

export type EffectBuffSelection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "query"; readonly filter: ObjectFilter }
  | {
      readonly kind: "choose";
      readonly id: string;
      readonly filter: ObjectFilter;
      readonly min?: number;
      readonly max?: number;
      readonly prompt?: string;
    };

export interface EffectBuffArgs {
  readonly mode: "buff" | "spend";
  readonly objects?: Expr | Value | EffectBuffSelection;
  /** Legacy TargetSpec-id shorthand. */
  readonly target?: string;
  /** Legacy non-target pick shorthand. */
  readonly pick?: Expr | Value;
  readonly amount?: Expr;
  readonly chooser?: PlayerId;
  readonly chooseUpTo?: boolean;
}

type ParseResult =
  | { readonly ok: true; readonly args: EffectBuffArgs }
  | { readonly ok: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EXPR_KINDS: ReadonlySet<string> = new Set([
  "constant",
  "literal",
  "object-property",
  "object-attribute",
  "linked-value",
  "linked",
  "count"
]);

const isExpr = (value: unknown): value is Expr =>
  isRecord(value) && typeof value.kind === "string" && EXPR_KINDS.has(value.kind);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) &&
    Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0;
}

function isFilter(value: unknown): value is ObjectFilter {
  return isRecord(value) && isValue(value);
}

function parseSelection(value: unknown): EffectBuffSelection | readonly ObjectRef[] {
  if (isRef(value)) return [{ id: value.id, zoneEntryId: value.zoneEntryId }];
  if (isId(value)) return { kind: "target", id: value };
  if (Array.isArray(value)) {
    if (!value.every(isRef)) throw new Error("effect.buff objects must contain only object references");
    return value.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
  }
  if (!isRecord(value)) throw new Error("effect.buff objects must be a selection descriptor or object references");
  switch (value.kind) {
    case "source":
      return { kind: "source" };
    case "target":
    case "pick":
      if (!isId(value.id)) throw new Error(`effect.buff ${value.kind} selection requires a non-empty id`);
      return { kind: value.kind, id: value.id };
    case "query":
      if (!isFilter(value.filter)) throw new Error("effect.buff query selection requires a filter");
      return { kind: "query", filter: value.filter };
    case "choose": {
      if (!isId(value.id)) throw new Error("effect.buff choose selection requires a non-empty id");
      if (!isFilter(value.filter)) throw new Error("effect.buff choose selection requires a filter");
      const min = value.min === undefined ? undefined : value.min;
      const max = value.max === undefined ? undefined : value.max;
      if (min !== undefined && (typeof min !== "number" || !Number.isSafeInteger(min) || min < 0)) {
        throw new Error("effect.buff choose selection min must be a nonnegative safe integer");
      }
      if (max !== undefined && (typeof max !== "number" || !Number.isSafeInteger(max) || max < 0)) {
        throw new Error("effect.buff choose selection max must be a nonnegative safe integer");
      }
      if (min !== undefined && max !== undefined && min > max) {
        throw new Error("effect.buff choose selection min must not exceed max");
      }
      if (value.prompt !== undefined && !isId(value.prompt)) {
        throw new Error("effect.buff choose selection prompt must be a non-empty string");
      }
      return {
        kind: "choose",
        id: value.id,
        filter: value.filter,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(value.prompt === undefined ? {} : { prompt: value.prompt })
      };
    }
    default:
      if (value.kind === undefined && Array.isArray(value.objects) && value.objects.every(isRef)) {
        return value.objects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
      }
      throw new Error("effect.buff objects must be a selection descriptor or object references");
  }
}

const isRefs = (selection: EffectBuffSelection | readonly ObjectRef[]): selection is readonly ObjectRef[] =>
  Array.isArray(selection);

function parseArgs(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, reason: "args must be an object" };
  if (value.mode !== "buff" && value.mode !== "spend") return { ok: false, reason: "mode must be buff or spend" };
  const forms = [value.objects !== undefined, value.target !== undefined, value.pick !== undefined]
    .filter(Boolean).length;
  if (forms === 0) return { ok: false, reason: "one of objects, target or pick is required" };
  if (forms > 1) return { ok: false, reason: "objects, target and pick are mutually exclusive" };
  if (value.target !== undefined && !isId(value.target)) {
    return { ok: false, reason: "target must be a non-empty TargetSpec id" };
  }
  if (value.amount !== undefined && !isExpr(value.amount)) return { ok: false, reason: "amount must be an Expr" };
  if (value.chooser !== undefined && typeof value.chooser !== "string") return { ok: false, reason: "chooser must be a PlayerId string" };
  if (value.chooseUpTo !== undefined && typeof value.chooseUpTo !== "boolean") return { ok: false, reason: "chooseUpTo must be a boolean" };
  if (value.objects !== undefined) {
    if (isExpr(value.objects)) {
      // Expressions are validated after evaluation.
    } else {
      try {
        parseSelection(value.objects);
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "invalid objects" };
      }
    }
  }
  if (value.pick !== undefined && !isExpr(value.pick) && !isId(value.pick)) {
    return { ok: false, reason: "pick must be an Expr or non-empty PickSpec id" };
  }
  return {
    ok: true,
    args: {
      mode: value.mode,
      ...(value.objects === undefined ? {} : { objects: value.objects as Expr | Value | EffectBuffSelection }),
      ...(value.target === undefined ? {} : { target: value.target }),
      ...(value.pick === undefined ? {} : { pick: value.pick as Expr | Value }),
      ...(value.amount === undefined ? {} : { amount: value.amount }),
      ...(value.chooser === undefined ? {} : { chooser: value.chooser }),
      ...(value.chooseUpTo === undefined ? {} : { chooseUpTo: value.chooseUpTo })
    }
  };
}

const LITERAL_ONE: Expr = { kind: "literal", value: 1 };

const refValue = (ref: ObjectRef): Value => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });
const refKey = (ref: ObjectRef): string => ref.id + ":" + String(ref.zoneEntryId);

function asObjectRef(value: unknown): ObjectRef | null {
  return isRef(value) ? { id: value.id, zoneEntryId: value.zoneEntryId } : null;
}

function distinctRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const distinct: ObjectRef[] = [];
  for (const ref of refs) {
    if (seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    distinct.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  }
  return distinct;
}

function sortedRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  return distinctRefs(refs).sort((left, right) => {
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return left.zoneEntryId - right.zoneEntryId;
  });
}

function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : argument;
}

function refsFromPicks(ctx: ResolveContext, id: string): ObjectRef[] {
  return ctx.picks(id).map(asObjectRef).filter((ref): ref is ObjectRef => ref !== null);
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer.
const effectBuff = {
  op: "effect.buff",
  argsSchema: {
    parse(value) {
      const parsed = parseArgs(value);
      if (!parsed.ok) throw new Error("effect.buff args: " + parsed.reason);
      return parsed.args;
    },
    safeParse(value) {
      const parsed = parseArgs(value);
      return parsed.ok
        ? { success: true, data: parsed.args }
        : { success: false, error: new Error("effect.buff args: " + parsed.reason) };
    }
  },
  execute
} satisfies InstructionDef<EffectBuffArgs>;

export default effectBuff;

function negated(reason: "replaced" | "impossible", events: readonly GameEvent[]): InstructionResult {
  return { status: "negated", reason, events: [...events] };
}

function execute(ctx: ResolveContext, args: EffectBuffArgs): InstructionResult {
  const evaluated = ctx.evaluate(args.amount ?? LITERAL_ONE);
  if (typeof evaluated !== "number" || !Number.isInteger(evaluated) || evaluated < 0) {
    throw new Error("effect.buff args: amount must evaluate to a non-negative integer, got " + JSON.stringify(evaluated));
  }
  const amount = evaluated;
  const chooser = args.chooser ?? ctx.controller;

  const rawSelection: unknown = args.objects === undefined
    ? args.pick === undefined
      ? args.target === undefined ? { kind: "source" as const } : { kind: "target" as const, id: args.target }
      : { kind: "pick" as const, id: evaluateArgument(ctx, args.pick) }
    : evaluateArgument(ctx, args.objects);
  const selection: EffectBuffSelection | readonly ObjectRef[] = parseSelection(rawSelection);

  let planned: ObjectRef[];
  if (isRefs(selection)) {
    planned = selection.filter(ref => ctx.object(ref) !== null);
  } else {
    switch (selection.kind) {
      case "source":
        planned = [ctx.source.ref].filter(ref => ctx.object(ref) !== null);
        break;
      case "target":
        planned = ctx.targets(selection.id).filter(ref => ctx.object(ref) !== null);
        break;
      case "pick":
        planned = refsFromPicks(ctx, selection.id).filter(ref => ctx.object(ref) !== null);
        break;
      case "query":
        planned = sortedRefs(ctx.query(selection.filter).map(object => object.ref));
        break;
      case "choose": {
        const options = sortedRefs(ctx.query(selection.filter).map(object => object.ref));
        const requestedMax = selection.max ?? options.length;
        const requestedMin = selection.min ?? 0;
        const max = Math.min(requestedMax, options.length);
        if (requestedMin > max) return { status: "negated", reason: "impossible", events: [] };
        if (max === 0) {
          planned = [];
          break;
        }
        const chosen = ctx.choose<readonly ObjectRef[]>({
          id: selection.id,
          type: "select-objects",
          options,
          min: Math.min(requestedMin, max),
          max,
          chooser,
          visibility: "public",
          ...(selection.prompt === undefined ? {} : { prompt: selection.prompt })
        });
        if (!Array.isArray(chosen)) throw new Error("Invalid effect.buff choice answer");
        const legalKeys = new Set(options.map(refKey));
        const answered = chosen.map(asObjectRef);
        if (
          answered.some(ref => ref === null || !legalKeys.has(refKey(ref))) ||
          new Set(answered.map(ref => ref === null ? "invalid" : refKey(ref))).size !== answered.length ||
          answered.length < requestedMin ||
          answered.length > max
        ) {
          throw new Error("Invalid effect.buff choice answer");
        }
        planned = answered.filter((ref): ref is ObjectRef => ref !== null);
        break;
      }
    }
  }

  if (planned.length === 0) {
    // A non-target query/choice may legitimately resolve to no Units. Locked
    // target and pick inputs are references and therefore mistarget when all
    // of them are stale, preserving the primitive's existing boundary.
    if (isRefs(selection) || selection.kind === "target" || selection.kind === "pick") {
      return { status: "ignored", reason: "mistargeted" };
    }
  }

  if (args.chooseUpTo === true && planned.length > 1) {
    const choiceId = isRefs(selection)
      ? "effect.buff:buff-targets"
      : selection.kind === "target" || selection.kind === "pick"
        ? selection.id + ":buff-targets"
        : "effect.buff:buff-targets";
    const chosen = ctx.choose<readonly ObjectRef[]>({
      id: choiceId,
      type: "select-objects",
      options: planned,
      min: 0,
      max: planned.length,
      chooser,
      visibility: "public"
    });
    const legalKeys = new Set(planned.map(refKey));
    planned = distinctRefs((Array.isArray(chosen) ? chosen : [])
      .map(asObjectRef)
      .filter((ref): ref is ObjectRef => ref !== null && legalKeys.has(refKey(ref))));
  }

  const events: GameEvent[] = [];
  const buffed: ObjectRef[] = [];
  const spent: ObjectRef[] = [];
  let buffedCount = 0;
  let spentCount = 0;

  for (const ref of planned) {
    const snapshot = ctx.object(ref);
    if (snapshot === null) continue; // left its zone after the choice; skip it
    if (amount === 0) continue;
    if (args.mode === "buff") {
      // 702.3 / 702.3.a: a second Buff is simply not placed.
      if (snapshot.buffs > 0) continue;
      // No multiple-Buff permission is represented by this primitive, so one
      // Unit can receive at most one Buff even when a caller supplies a larger
      // per-object amount.
      const outcome = ctx.perform({ type: "buff", object: ref, amount: 1 });
      if (outcome.status !== "done") {
        return negated(outcome.status === "replaced" ? "replaced" : "impossible", [...events, ...outcome.events]);
      }
      events.push(...outcome.events);
      buffed.push(ref);
      buffedCount += 1;
    } else {
      // 702.2.b.2: buffs can only be spent on units the spender controls.
      if (snapshot.controller !== chooser) continue;
      const spendable = Math.min(amount, snapshot.buffs); // 702.2.b.1
      if (spendable === 0) continue;
      const outcome = ctx.perform({ type: "spend-buff", object: ref, amount: spendable });
      if (outcome.status !== "done") {
        return negated(outcome.status === "replaced" ? "replaced" : "impossible", [...events, ...outcome.events]);
      }
      events.push(...outcome.events);
      spent.push(ref);
      spentCount += spendable;
    }
  }

  const linkedValues: Record<string, Value> = {
    buffed: buffed.map(refValue),
    spent: spent.map(refValue),
    buffedCount,
    spentCount
  };
  for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);

  if (planned.length > 0 && buffed.length + spent.length === 0) {
    // Every candidate was already buffed / had nothing spendable, or an
    // optional selection picked nothing: nothing was done (702.3.a, 427.1.c).
    return { status: "negated", reason: "skipped", events };
  }
  return { status: "executed", events, linkedValues };
}

