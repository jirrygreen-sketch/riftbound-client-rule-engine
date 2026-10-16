/**
 * continuous.combat — 建立“本次战斗期间生效”的图层效果（RIFT-91 图层引擎的
 * 指令入口，docs/plans/2026-10-15-p0-contract.md 3.4/3.8）。
 *
 * 现状与边界（如实登记，不发明语义）：judgeReason 提及 continuous.combat 的
 * 卡牌（9 处，如 Tank / Backline 依赖）目前没有 combat consumer；图层引擎对
 * kind "continuous.combat" 的 ContinuousEffect 没有任何消费分支
 * （src/layers/engine.ts 的 applyAbility / applyArithmetic 都不命中）。因此本原语
 * 在当前契约下保持 blocked，既不报告成功也不写入无行为的注册行。CR v1.5
 * 468.7.c（“this combat”效果在 combat-end 到期）以及 Tank（815.1.b 战斗
 * 伤害分配顺序）应由正式 combat consumer 消费；最终回复里给出契约变更请求。
 *
 * 参数：
 * - flags?: Expr / string[] — 本次战斗内生效的规则标记（字符串数组，如
 *   ["tank"]）。缺省 []（空数组也合法）；在 combat consumer 落地前保持 blocked。
 * - target? / pick? / choose? / objects? / filter? / appliesTo? / linkKey? —
 *   同 continuous.might 的选择约定。
 * - duration?: Expr / 字符串别名 | { type: "until", at, player? } |
 *   { type: "while-source-in-zone" } — 缺省 "end-of-combat"（468.7.c）。
 *
 * 结果（契约 3.3 / 3.6）：combat consumer 缺失时统一返回 negated/impossible，
 * 不创建假效果；链接值 <linkKey> = { count, objects }（缺省键 "affected"）。
 *
 * 用到的 GameAction：无（addContinuous，契约 3.8）。
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
  ZoneId
} from "../contract.js";
import {
  buildKeywordGrantSpec,
  isDurationAlias,
  resolveContinuousDuration,
  settlementIdentity,
  type DurationAlias,
  type KeywordGrant,
  type OpsTarget
} from "../../layers/ops/index.js";

/** Args accepted after interpreter evaluation (literal values fully validated). */
export interface ContinuousCombatArgs {
  readonly flags?: Expr | Value;
  readonly target?: string;
  readonly pick?: string;
  readonly choose?: {
    readonly id: string;
    readonly filter?: ObjectFilter;
    readonly chooser?: PlayerId;
    readonly visibility?: ChoiceVisibility;
    readonly prompt?: string;
    readonly min?: number;
    readonly max?: number;
  };
  readonly objects?: Expr | Value;
  readonly filter?: ObjectFilter;
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
  | { kind: "refs"; refs: readonly ObjectRef[] };

const ARGUMENT_KEYS: readonly string[] = [
  "flags",
  "target", "pick", "choose", "objects", "filter",
  "duration", "appliesTo", "linkKey", "settlementId"
];
const SELECTOR_KEYS: readonly string[] = ["target", "pick", "choose", "objects", "filter"];
const CHOICE_KEYS: readonly string[] = [
  "id", "filter", "chooser", "visibility", "prompt", "min", "max"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function isFilter(value: unknown): value is ObjectFilter {
  return isRecord(value) && isValue(value);
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": return isRef(value.object) && isId(value.property);
    case "object-attribute": return isRef(value.object) && isId(value.attribute);
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count":
      return isId(value.subject) && (value.filter === undefined || isFilter(value.filter));
    default: return false;
  }
}

function isVisibility(value: unknown): value is ChoiceVisibility {
  return value === "public" || value === "chooser-only" ||
    (Array.isArray(value) && value.length > 0 && value.every(isId));
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function parseFlags(value: unknown, op: string): KeywordGrant[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string" || !isId(entry)) {
        throw new TypeError(op + " flags entries must be non-empty strings");
      }
    }
    return (value as string[]).map(flag => ({ id: flag }));
  }
  throw new TypeError(op + " flags must be a string array");
}

function parseSelection(value: Value, op: string): Selection {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      if (!value.every(isRef)) {
        throw new TypeError(op + " objects array entries must be object references");
      }
      return { kind: "refs", refs: value.map(entry => ({ id: entry.id, zoneEntryId: entry.zoneEntryId })) };
    }
    throw new TypeError(op + " objects must be a selection descriptor, object reference(s), or a linked result");
  }
  switch (value.kind) {
    case "source": return { kind: "source" };
    case "target":
      if (!isId(value.id)) throw new TypeError(op + " objects target requires an id");
      return { kind: "target", id: value.id };
    case "pick":
      if (!isId(value.id)) throw new TypeError(op + " objects pick requires an id");
      return { kind: "pick", id: value.id };
    case "query":
      if (!isFilter(value.filter)) throw new TypeError(op + " objects query requires a filter");
      return { kind: "query", filter: value.filter };
    case "choose": {
      if (!isId(value.id)) throw new TypeError(op + " objects choose requires a stable non-empty choice id");
      const min = value.min;
      const max = value.max;
      if (min !== undefined && (!isInteger(min) || min < 0)) {
        throw new TypeError(op + " objects choose min must be a non-negative integer");
      }
      if (max !== undefined && (!isInteger(max) || max < 0)) {
        throw new TypeError(op + " objects choose max must be a non-negative integer");
      }
      if (min !== undefined && max !== undefined && min > max) {
        throw new TypeError(op + " objects choose min must not exceed max");
      }
      if (value.filter !== undefined && !isFilter(value.filter)) {
        throw new TypeError(op + " objects choose filter must be an object filter");
      }
      if (value.chooser !== undefined && !isId(value.chooser)) {
        throw new TypeError(op + " objects choose chooser must be a player id");
      }
      if (value.visibility !== undefined && !isVisibility(value.visibility)) {
        throw new TypeError(op + " objects choose visibility is invalid");
      }
      if (value.prompt !== undefined && !isId(value.prompt)) {
        throw new TypeError(op + " objects choose prompt must be a non-empty string");
      }
      for (const key of Object.keys(value)) {
        if (key !== "kind" && !CHOICE_KEYS.includes(key)) {
          throw new TypeError("Invalid " + op + " choose argument: " + key);
        }
      }
      return {
        kind: "choose",
        id: value.id,
        ...(value.filter === undefined ? {} : { filter: value.filter as ObjectFilter }),
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(value.chooser === undefined ? {} : { chooser: value.chooser as PlayerId }),
        ...(value.visibility === undefined ? {} : { visibility: value.visibility as ChoiceVisibility }),
        ...(value.prompt === undefined ? {} : { prompt: value.prompt as string })
      };
    }
    default:
      if (value.kind === undefined && Array.isArray(value.objects) && value.objects.every(isRef)) {
        return {
          kind: "refs",
          refs: (value.objects as readonly ObjectRef[]).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }))
        };
      }
      throw new TypeError(op + " objects must be a selection descriptor or object reference(s)");
  }
}

function parseArgs(value: unknown): ContinuousCombatArgs {
  if (!isRecord(value)) throw new TypeError("continuous.combat args must be an object");
  const selectors = SELECTOR_KEYS.filter(key => value[key] !== undefined);
  if (selectors.length > 1) {
    throw new TypeError("continuous.combat accepts at most one of target, pick, choose, objects, filter");
  }
  if (value.appliesTo !== undefined && selectors.length > 0) {
    throw new TypeError("continuous.combat appliesTo self cannot be combined with an explicit selector");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) {
      throw new TypeError("Invalid continuous.combat argument: " + key);
    }
    // 表达式只能按形状校验（值在结算时才求值）；直接给出的字面值在此处即完全校验。
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError("Invalid continuous.combat argument: " + key);
    if (key === "target" || key === "pick") {
      if (!isId(entry)) throw new TypeError("continuous.combat " + key + " must be a spec id string");
    } else if (key === "filter") {
      if (!isFilter(entry)) throw new TypeError("continuous.combat filter must be an object filter");
    } else if (key === "choose") {
      parseSelection(
        { ...(entry as Record<string, unknown>), kind: "choose" } as Value,
        "continuous.combat"
      );
    } else if (key === "objects") {
      parseSelection(entry as Value, "continuous.combat");
    } else if (key === "flags") {
      parseFlags(entry, "continuous.combat");
    } else if (key === "duration") {
      if (!isDurationAlias(entry)) throw new TypeError("continuous.combat duration is not a known alias");
    } else if (key === "appliesTo") {
      if (entry !== "self") throw new TypeError('continuous.combat appliesTo must be "self"');
    } else if (key === "linkKey") {
      if (!isId(entry)) throw new TypeError("continuous.combat linkKey must be a non-empty string");
    } else if (key === "settlementId") {
      if (!isId(entry)) throw new TypeError("continuous.combat settlementId must be a non-empty string");
    }
  }
  return value as unknown as ContinuousCombatArgs;
}

const argsSchema: Schema<ContinuousCombatArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

/** Expr 经 ctx.evaluate 求值（取值时机即调用时，契约 3.6）；字面值原样使用。 */
function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : (argument as Value);
}

/** CR 107 / 108：契约 ZoneId 没有 legend-zone 成员，用非 Board 区域集合表达。 */
const NON_BOARD_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "chain"
]);

/** 非 Board 区域的对象不再接收修改（359.3.e.8）。 */
function isBoardObject(snapshot: ObjectSnapshot | null): snapshot is ObjectSnapshot {
  return snapshot !== null && !NON_BOARD_ZONES.has(snapshot.zone);
}

/** 保序去重，并丢掉已离区或已不在 Board 的引用（359.3.e.2/e.4/e.8）。 */
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

/** 集合查询与选择选项需要与调用顺序无关的稳定顺序（确定性）。 */
function sortedBoardRefs(ctx: ResolveContext, filter: ObjectFilter): ObjectRef[] {
  const refs = ctx.query(filter)
    .filter(isBoardObject)
    .map(object => ({ id: object.ref.id, zoneEntryId: object.ref.zoneEntryId }));
  return currentBoardRefs(ctx, refs).sort((left, right) => {
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return left.zoneEntryId - right.zoneEntryId;
  });
}

/** 非法的 select-objects 答案在这里拒绝；无答案时 ctx.choose 抛 AwaitChoice 由事务回滚重问。 */
function askSelection(
  ctx: ResolveContext,
  selection: Extract<Selection, { kind: "choose" }>,
  options: readonly ObjectRef[]
): ObjectRef[] {
  const requestedMax = selection.max ?? 1;
  const requestedMin = selection.min ?? requestedMax;
  const max = Math.min(requestedMax, options.length);
  // max 0：选择已被唯一确定（355.10.d.1），不发起空提问。
  if (max === 0) return [];
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selection.id,
    type: "select-objects",
    chooser: selection.chooser ?? ctx.controller,
    visibility: selection.visibility ?? "public",
    options,
    min: Math.min(requestedMin, max),
    max,
    ...(selection.prompt === undefined ? {} : { prompt: selection.prompt })
  });
  const valid = Array.isArray(answer) &&
    answer.length >= Math.min(requestedMin, max) &&
    answer.length <= max &&
    answer.every((ref, index) =>
      isRef(ref) &&
      options.some(option => sameRef(option, ref)) &&
      !answer.slice(0, index).some(previous => isRef(previous) && sameRef(previous, ref)));
  if (!valid) throw new TypeError("Invalid continuous.combat choice answer");
  return (answer as readonly ObjectRef[]).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function resolveSelection(ctx: ResolveContext, args: ContinuousCombatArgs): Selection {
  if (args.target !== undefined) return { kind: "target", id: args.target };
  if (args.pick !== undefined) return { kind: "pick", id: args.pick };
  if (args.filter !== undefined) return { kind: "query", filter: args.filter };
  if (args.choose !== undefined) {
    return parseSelection(
      { ...(args.choose as Record<string, unknown>), kind: "choose" } as Value,
      "continuous.combat"
    );
  }
  if (args.appliesTo !== undefined) return { kind: "source" };
  if (args.objects === undefined) return { kind: "source" };
  return parseSelection(evaluateArgument(ctx, args.objects), "continuous.combat");
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

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer (same as effect.buff).
const continuousCombat = {
  op: "continuous.combat",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousCombatArgs): InstructionResult {
    const events: GameEvent[] = [];
    const affected: Value[] = [];
    let count = 0;

    const linkKey = args.linkKey === undefined ? "affected" : evaluateArgument(ctx, args.linkKey);
    if (!isId(linkKey)) {
      throw new TypeError("continuous.combat linkKey must be a non-empty string");
    }
    const writeLinks = (): Record<string, Value> => {
      const receipt: Value = { count, objects: affected };
      const values: Record<string, Value> = {
        [linkKey]: receipt,
        [linkKey + ".count"]: count,
        [linkKey + ".objects"]: affected
      };
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    // NegatedInstructionResult 没有 linkedValues 字段（契约 3.3），但实际结果
    // 仍要写进 ctx.link，供 "if you do" 与后续链接指令按 CR 055 读取。
    const negate = (reason: "replaced" | "skipped" | "impossible"): InstructionResult => {
      writeLinks();
      return { status: "negated", reason, events: [...events] };
    };

    const rawDuration = args.duration === undefined ? "end-of-combat" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.combat duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const rawSettlementId = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (rawSettlementId !== undefined && !isId(rawSettlementId)) {
      throw new TypeError("continuous.combat settlementId must be a non-empty string");
    }
    const settlement = settlementIdentity(ctx.source.ref, "continuous.combat", key => ctx.linked(key), (key, value) => ctx.link(key, value), rawSettlementId);
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    if (rawAppliesTo !== undefined && rawAppliesTo !== "self") {
      throw new TypeError('continuous.combat appliesTo must evaluate to "self"');
    }

    // flags 是可选的规则标记数组；缺省为空（无标记也合法注册，供 combat
    // 工作流按行消费）。
    const flags: KeywordGrant[] = args.flags === undefined
      ? []
      : parseFlags(evaluateArgument(ctx, args.flags), "continuous.combat");

    // No combat workflow consumer exists in the current contract. Keep this
    // primitive blocked instead of reporting a successful no-op registration.
    void duration;
    void settlement;
    void flags;
    return negate("impossible");
  }
} satisfies InstructionDef<ContinuousCombatArgs>;

export default continuousCombat;
