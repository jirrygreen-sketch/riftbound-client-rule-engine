/**
 * continuous.add-tag — register a trait-layer tag grant (CR v1.5 133.8,
 * 478.1.a).
 *
 * The instruction is deliberately small: the layer engine already applies
 * add-tag / gain-tag / grant-tag effects.  Resolution only validates the
 * trait layer, resolves the current Board object identities, and registers a
 * duration-aware per-object effect.  It never mutates an object directly.
 */
import type {
  ChoiceVisibility,
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Schema,
  Value,
} from "../contract.js";
import {
  isDurationAlias,
  resolveContinuousDuration,
  settlementIdentity,
  type DurationAlias,
} from "../../layers/ops/index.js";
import { buildTraitTagSpec, type TraitTagTarget } from "../../layers/trait-adapter.js";

export interface ContinuousAddTagArgs {
  readonly tag: Expr | Value;
  readonly layer: Expr | Value;
  /** CardProgram spelling used by Ivern: "self" / "source" or a selector. */
  readonly object?: Expr | Value;
  /** General selector alias retained for the continuous.* family. */
  readonly objects?: Expr | Value;
  readonly target?: string | Expr;
  readonly pick?: string | Expr;
  readonly choose?: {
    readonly id: string;
    readonly filter?: ObjectFilter;
    readonly chooser?: PlayerId;
    readonly visibility?: ChoiceVisibility;
    readonly prompt?: string;
    readonly min?: number;
    readonly max?: number;
  } | Expr;
  readonly filter?: ObjectFilter | Expr;
  readonly duration?: Expr | Value;
  readonly appliesTo?: Expr | Value;
  readonly linkKey?: Expr | Value;
  readonly settlementId?: Expr | Value;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "query"; readonly filter: ObjectFilter }
  | {
      readonly kind: "choose";
      readonly id: string;
      readonly filter?: ObjectFilter;
      readonly min?: number;
      readonly max?: number;
      readonly chooser?: PlayerId;
      readonly visibility?: ChoiceVisibility;
      readonly prompt?: string;
    }
  | { readonly kind: "refs"; readonly refs: readonly ObjectRef[] };

const ARGUMENT_KEYS: readonly string[] = [
  "tag", "layer", "object", "objects", "target", "pick", "choose", "filter",
  "duration", "appliesTo", "linkKey", "settlementId",
];
const SELECTOR_KEYS: readonly string[] = ["object", "objects", "target", "pick", "choose", "filter"];
const CHOICE_KEYS: readonly string[] = ["id", "filter", "chooser", "visibility", "prompt", "min", "max"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isValue(item, ancestors))
    : Object.values(value).every(item => isValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && isInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function isExpr(value: unknown, ancestors = new Set<unknown>()): value is Expr {
  if (!isRecord(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant":
    case "literal":
      valid = Object.hasOwn(value, "value") && isValue(value.value);
      break;
    case "object-property":
    case "object-attribute":
      valid = isId(value.property ?? value.attribute);
      break;
    case "linked":
    case "linked-value":
      valid = isId(value.instructionId) && (value.key === undefined || isId(value.key));
      break;
    case "count":
      valid = isId(value.subject) && (value.filter === undefined || isValue(value.filter));
      break;
    case "arithmetic":
      valid = Array.isArray(value.operands) && value.operands.length > 0 &&
        value.operands.every(item => isExpr(item, ancestors));
      break;
    default:
      valid = false;
      break;
  }
  ancestors.delete(value);
  return valid;
}

function isVisibility(value: unknown): value is ChoiceVisibility {
  return value === "public" || value === "chooser-only" ||
    (Array.isArray(value) && value.length > 0 && value.every(isId));
}

function parseSelection(value: Value, op: string): Selection {
  if (value === "self" || value === "source") return { kind: "source" };
  if (isRef(value)) return { kind: "refs", refs: [{ id: value.id, zoneEntryId: value.zoneEntryId }] };
  if (Array.isArray(value)) {
    if (!value.every(isRef)) throw new TypeError(op + " object list entries must be object references");
    return { kind: "refs", refs: value.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })) };
  }
  if (!isRecord(value)) throw new TypeError(op + " object must be self, source, a selector, or an object reference");
  if (value.kind === "source" || value.kind === "self") return { kind: "source" };
  if (value.kind === "target" || Object.hasOwn(value, "target")) {
    const id = value.kind === "target" ? value.id : value.target;
    if (!isId(id)) throw new TypeError(op + " object target requires an id");
    return { kind: "target", id };
  }
  if (value.kind === "pick" || Object.hasOwn(value, "pick")) {
    const id = value.kind === "pick" ? value.id : value.pick;
    if (!isId(id)) throw new TypeError(op + " object pick requires an id");
    return { kind: "pick", id };
  }
  if (value.kind === "query") {
    if (!isRecord(value.filter) || !isValue(value.filter)) throw new TypeError(op + " object query requires a filter");
    return { kind: "query", filter: value.filter as unknown as ObjectFilter };
  }
  if (value.kind === "choose") {
    const id = value.id;
    const min = value.min;
    const max = value.max;
    if (!isId(id)) throw new TypeError(op + " choose requires a stable non-empty choice id");
    if (min !== undefined && (!isInteger(min) || min < 0)) throw new TypeError(op + " choose min must be a non-negative integer");
    if (max !== undefined && (!isInteger(max) || max < 0)) throw new TypeError(op + " choose max must be a non-negative integer");
    if (min !== undefined && max !== undefined && min > max) throw new TypeError(op + " choose min must not exceed max");
    if (value.filter !== undefined && (!isRecord(value.filter) || !isValue(value.filter))) throw new TypeError(op + " choose filter is invalid");
    if (value.chooser !== undefined && !isId(value.chooser)) throw new TypeError(op + " choose chooser is invalid");
    if (value.visibility !== undefined && !isVisibility(value.visibility)) throw new TypeError(op + " choose visibility is invalid");
    if (value.prompt !== undefined && !isId(value.prompt)) throw new TypeError(op + " choose prompt is invalid");
    for (const key of Object.keys(value)) {
      if (key !== "kind" && !CHOICE_KEYS.includes(key)) throw new TypeError("Invalid " + op + " choose argument: " + key);
    }
    return {
      kind: "choose", id,
      ...(value.filter === undefined ? {} : { filter: value.filter as ObjectFilter }),
      ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
      ...(value.chooser === undefined ? {} : { chooser: value.chooser as PlayerId }),
      ...(value.visibility === undefined ? {} : { visibility: value.visibility as ChoiceVisibility }),
      ...(value.prompt === undefined ? {} : { prompt: value.prompt as string }),
    };
  }
  if (value.kind === undefined && Array.isArray(value.objects) && value.objects.every(isRef)) {
    return { kind: "refs", refs: value.objects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })) };
  }
  throw new TypeError(op + " object must be a supported selector");
}

function parseArgs(value: unknown): ContinuousAddTagArgs {
  if (!isRecord(value)) throw new TypeError("continuous.add-tag args must be an object");
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) throw new TypeError("Invalid continuous.add-tag argument: " + key);
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError("Invalid continuous.add-tag argument: " + key);
    if (key === "tag") {
      if (!isId(entry)) throw new TypeError("continuous.add-tag tag must be a non-empty string");
    } else if (key === "layer") {
      if (entry !== "trait") throw new TypeError('continuous.add-tag layer must be "trait"');
    } else if (key === "object" || key === "objects") {
      parseSelection(entry, "continuous.add-tag");
    } else if (key === "target" || key === "pick") {
      if (!isId(entry)) throw new TypeError("continuous.add-tag " + key + " must be a spec id string");
    } else if (key === "choose") {
      parseSelection({ ...(entry as Record<string, unknown>), kind: "choose" } as Value, "continuous.add-tag");
    } else if (key === "filter") {
      if (!isRecord(entry) || !isValue(entry)) throw new TypeError("continuous.add-tag filter must be an object filter");
    } else if (key === "duration") {
      if (!isDurationAlias(entry)) throw new TypeError("continuous.add-tag duration is not a known alias");
    } else if (key === "appliesTo") {
      if (entry !== "self") throw new TypeError('continuous.add-tag appliesTo must be "self"');
    } else if (key === "linkKey" || key === "settlementId") {
      if (!isId(entry)) throw new TypeError("continuous.add-tag " + key + " must be a non-empty string");
    }
  }
  if (value.tag === undefined) throw new TypeError("continuous.add-tag requires tag");
  if (value.layer === undefined) throw new TypeError("continuous.add-tag requires layer");
  const selectors = SELECTOR_KEYS.filter(key => value[key] !== undefined);
  if (selectors.length > 1) throw new TypeError("continuous.add-tag accepts at most one object selector");
  if (value.appliesTo !== undefined && selectors.length > 0) {
    throw new TypeError("continuous.add-tag appliesTo self cannot be combined with an explicit selector");
  }
  return value as unknown as ContinuousAddTagArgs;
}

const argsSchema: Schema<ContinuousAddTagArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  },
};

function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : argument as Value;
}

function isBoardObject(snapshot: ObjectSnapshot | null): snapshot is ObjectSnapshot {
  return snapshot !== null && snapshot.zone === "board";
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function currentBoardRefs(ctx: ResolveContext, refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const current: ObjectRef[] = [];
  for (const ref of refs) {
    const key = ref.id + ":" + String(ref.zoneEntryId);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isBoardObject(ctx.object(ref))) continue;
    current.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  }
  return current;
}

function sortedBoardRefs(ctx: ResolveContext, filter: ObjectFilter): ObjectRef[] {
  return currentBoardRefs(ctx, ctx.query(filter).filter(isBoardObject).map(object => object.ref)).sort((left, right) =>
    left.id === right.id ? left.zoneEntryId - right.zoneEntryId : left.id < right.id ? -1 : 1);
}

function askSelection(
  ctx: ResolveContext,
  selection: Extract<Selection, { readonly kind: "choose" }>,
  options: readonly ObjectRef[],
): ObjectRef[] {
  const requestedMax = selection.max ?? 1;
  const requestedMin = selection.min ?? requestedMax;
  const max = Math.min(requestedMax, options.length);
  if (max === 0) return [];
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selection.id,
    type: "select-objects",
    chooser: selection.chooser ?? ctx.controller,
    visibility: selection.visibility ?? "public",
    options,
    min: Math.min(requestedMin, max),
    max,
    ...(selection.prompt === undefined ? {} : { prompt: selection.prompt }),
  });
  const valid = Array.isArray(answer) && answer.length >= Math.min(requestedMin, max) && answer.length <= max &&
    answer.every((ref, index) => isRef(ref) && options.some(option => sameRef(option, ref)) &&
      !answer.slice(0, index).some(previous => isRef(previous) && sameRef(previous, ref)));
  if (!valid) throw new TypeError("Invalid continuous.add-tag choice answer");
  return answer.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function resolveSelection(ctx: ResolveContext, args: ContinuousAddTagArgs): Selection {
  if (args.target !== undefined) {
    const value = evaluateArgument(ctx, args.target);
    if (!isId(value)) throw new TypeError("continuous.add-tag target must evaluate to a spec id string");
    const id = value;
    return { kind: "target", id };
  }
  if (args.pick !== undefined) {
    const value = evaluateArgument(ctx, args.pick);
    if (!isId(value)) throw new TypeError("continuous.add-tag pick must evaluate to a spec id string");
    const id = value;
    return { kind: "pick", id };
  }
  if (args.choose !== undefined) {
    const value = evaluateArgument(ctx, args.choose as unknown as Expr | Value);
    return parseSelection({ ...(value as Record<string, unknown>), kind: "choose" } as Value, "continuous.add-tag");
  }
  if (args.filter !== undefined) {
    const filter = evaluateArgument(ctx, args.filter as unknown as Expr | Value);
    if (!isRecord(filter)) throw new TypeError("continuous.add-tag filter must be an object filter");
    return { kind: "query", filter: filter as ObjectFilter };
  }
  if (args.appliesTo !== undefined) {
    if (evaluateArgument(ctx, args.appliesTo) !== "self") throw new TypeError('continuous.add-tag appliesTo must evaluate to "self"');
    return { kind: "source" };
  }
  const selected = args.object ?? args.objects;
  if (selected === undefined) return { kind: "source" };
  return parseSelection(evaluateArgument(ctx, selected), "continuous.add-tag");
}

function resolveCandidates(ctx: ResolveContext, selection: Selection): { status: "ok" | "ignored" | "impossible"; refs: readonly ObjectRef[] } {
  switch (selection.kind) {
    case "source": {
      const refs = currentBoardRefs(ctx, [ctx.source.ref]);
      return refs.length === 0 ? { status: "ignored", refs: [] } : { status: "ok", refs };
    }
    case "target": {
      const refs = currentBoardRefs(ctx, ctx.targets(selection.id));
      return refs.length === 0 ? { status: "ignored", refs: [] } : { status: "ok", refs };
    }
    case "pick": {
      const refs = currentBoardRefs(ctx, ctx.picks(selection.id).filter(isRef));
      return refs.length === 0 ? { status: "ignored", refs: [] } : { status: "ok", refs };
    }
    case "refs": {
      const refs = currentBoardRefs(ctx, selection.refs);
      return refs.length === 0 ? { status: "ignored", refs: [] } : { status: "ok", refs };
    }
    case "query":
      return { status: "ok", refs: sortedBoardRefs(ctx, selection.filter) };
    case "choose": {
      const options = sortedBoardRefs(ctx, selection.filter ?? {});
      const requestedMax = selection.max ?? 1;
      const requestedMin = selection.min ?? requestedMax;
      if (options.length === 0 && requestedMin > 0) return { status: "impossible", refs: [] };
      if (options.length === 0) return { status: "ok", refs: [] };
      return { status: "ok", refs: askSelection(ctx, selection, options) };
    }
  }
}

const continuousAddTag = {
  op: "continuous.add-tag",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousAddTagArgs): InstructionResult {
    const events: GameEvent[] = [];
    const affected: Value[] = [];
    let count = 0;
    const rawTag = evaluateArgument(ctx, args.tag);
    if (!isId(rawTag)) throw new TypeError("continuous.add-tag tag must evaluate to a non-empty string");
    const rawLayer = evaluateArgument(ctx, args.layer);
    if (rawLayer !== "trait") throw new TypeError('continuous.add-tag layer must evaluate to "trait"');

    const linkKeyValue = args.linkKey === undefined ? "affected" : evaluateArgument(ctx, args.linkKey);
    if (!isId(linkKeyValue)) throw new TypeError("continuous.add-tag linkKey must be a non-empty string");
    const linkKey = linkKeyValue;
    const writeLinks = (): Record<string, Value> => {
      const receipt: Value = { count, objects: affected };
      const values: Record<string, Value> = {
        [linkKey]: receipt,
        [linkKey + ".count"]: count,
        [linkKey + ".objects"]: affected,
      };
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    const negate = (reason: "replaced" | "skipped" | "impossible"): InstructionResult => {
      writeLinks();
      return { status: "negated", reason, events: [...events] };
    };

    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) throw new TypeError("continuous.add-tag duration is not a known alias");
    const rawSettlementId = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (rawSettlementId !== undefined && !isId(rawSettlementId)) {
      throw new TypeError("continuous.add-tag settlementId must be a non-empty string");
    }
    const settlement = settlementIdentity(
      ctx.source.ref,
      "continuous.add-tag",
      key => ctx.linked(key),
      (key, value) => ctx.link(key, value),
      rawSettlementId,
    );
    const resolution = resolveCandidates(ctx, resolveSelection(ctx, args));
    if (resolution.status === "ignored") return { status: "ignored", reason: "mistargeted" };
    if (resolution.status === "impossible") return negate("impossible");

    let suffix = 0;
    for (const ref of resolution.refs) {
      const snapshot = ctx.object(ref);
      if (snapshot === null) continue;
      suffix += 1;
      const target: TraitTagTarget = { ref, snapshot };
      const spec = buildTraitTagSpec(
        "continuous.add-tag",
        ctx.source.ref,
        target,
        rawTag,
        String(suffix),
        settlement,
      );
      ctx.addContinuous(spec, resolveContinuousDuration(rawDuration as DurationAlias, ctx.source.ref));
      count += 1;
      affected.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
    }
    if (count === 0) return negate("skipped");
    const linkedValues = writeLinks();
    return { status: "executed", events: [...events], linkedValues };
  },
} satisfies InstructionDef<ContinuousAddTagArgs>;

export default continuousAddTag;

