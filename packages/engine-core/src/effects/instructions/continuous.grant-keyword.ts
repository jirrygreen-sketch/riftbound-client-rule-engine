/**
 * continuous.grant-keyword — 建立“获得关键词 / 能力”（ability 图层）的图层效果
 * （RIFT-91 图层引擎的指令入口，docs/plans/2026-10-15-p0-contract.md 3.4/3.8）。
 *
 * 规则依据（CR v1.5）：478 / 478.1.a（ability 图层：获得或失去能力 / 关键词）、
 * 317.1.a / 317.2.c / 468.7.c（持续时间）。关键词的具体语义（Assault、Ganking、
 * Shield、Tank、Deflect 等）由关键词展开与 combat 工作流负责（例如 Tank 是
 * 815.1.b 的战斗伤害分配顺序、Shield 叠加是 814.2），本原语只建立 ability 层
 * 注册，不实现关键词行为。
 *
 * 参数（与 continuous.might 的选择约定一致；差异只有关键词取值）：
 * - keyword?: Expr / string — 单个关键词 id（如 "Assault"）；keywords 缺省时
 *   必须给出。
 * - value?: Expr / number — 单个关键词的数值（如 Shield 3、Assault 2）；缺省
 *   不带数值。卡牌数据里 value 也可以是 object-property 表达式（pride-of-
 *   nazumah 读 shield），解释器求值后传入。
 * - keywords?: Expr / (string | { id, value? })[] — 多个关键词：字符串数组或
 *   {id, value} 对象数组（block 用前者 + 单一 value、grumpy-rockbear 静态数据
 *   用后者；两种都收）。给出 keywords 时忽略 keyword / value。
 * - target? / pick? / choose? / objects? / filter? / duration? / appliesTo? /
 *   linkKey? — 同 continuous.might（选择至多一个；duration 缺省 permanent）。
 *
 * 结果（契约 3.3 / 3.6）：与 continuous.might 一致——目标全部失效 → ignored
 * mistargeted（359.3.e.2/e.6）；choose 无合法选项且 min > 0 → negated
 * impossible（359.3.e.9）；每个合法对象提交一条 ability 层 addContinuous；
 * 链接值 <linkKey> = { count, objects }（缺省键 "granted"）。
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
  buildKeywordArithmeticSpec,
  buildKeywordGrantSpec,
  isDurationAlias,
  resolveContinuousDuration,
  normaliseKeywordGrants,
  settlementIdentity,
  type DurationAlias,
  type KeywordGrant,
  type OpsTarget
} from "../../layers/ops/index.js";

/** Args accepted after interpreter evaluation (literal values fully validated). */
export interface ContinuousGrantKeywordArgs {
  readonly keyword?: Expr | Value;
  readonly value?: Expr | Value;
  readonly keywords?: Expr | Value;
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
  | { readonly kind: "refs"; readonly refs: readonly ObjectRef[] };

const ARGUMENT_KEYS: readonly string[] = [
  "keyword", "value", "keywords",
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

function parseKeywordValue(value: unknown, op: string): KeywordGrant[] {
  if (typeof value === "string") {
    if (!isId(value)) throw new TypeError(op + " keyword must be a non-empty id");
    return [{ id: value }];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw new TypeError(op + " keywords must not be empty");
    const grants: KeywordGrant[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        if (!isId(entry)) throw new TypeError(op + " keywords entries must be non-empty ids");
        grants.push({ id: entry });
        continue;
      }
      if (isRecord(entry) && isId(entry.id) &&
        (entry.value === undefined || (isInteger(entry.value) && entry.value >= 0))) {
        grants.push({ id: entry.id, ...(entry.value === undefined ? {} : { value: entry.value as number }) });
        continue;
      }
      throw new TypeError(op + " keywords entries must be ids or { id, value? }");
    }
    return grants;
  }
  throw new TypeError(op + " keywords must be an id, an id array, or a { id, value? } array");
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

function parseArgs(value: unknown): ContinuousGrantKeywordArgs {
  if (!isRecord(value)) throw new TypeError("continuous.grant-keyword args must be an object");
  const selectors = SELECTOR_KEYS.filter(key => value[key] !== undefined);
  if (selectors.length > 1) {
    throw new TypeError("continuous.grant-keyword accepts at most one of target, pick, choose, objects, filter");
  }
  if (value.appliesTo !== undefined && selectors.length > 0) {
    throw new TypeError("continuous.grant-keyword appliesTo self cannot be combined with an explicit selector");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) {
      throw new TypeError("Invalid continuous.grant-keyword argument: " + key);
    }
    // 表达式只能按形状校验（值在结算时才求值）；直接给出的字面值在此处即完全校验。
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError("Invalid continuous.grant-keyword argument: " + key);
    if (key === "target" || key === "pick") {
      if (!isId(entry)) throw new TypeError("continuous.grant-keyword " + key + " must be a spec id string");
    } else if (key === "filter") {
      if (!isFilter(entry)) throw new TypeError("continuous.grant-keyword filter must be an object filter");
    } else if (key === "choose") {
      parseSelection(
        { ...(entry as Record<string, unknown>), kind: "choose" } as Value,
        "continuous.grant-keyword"
      );
    } else if (key === "objects") {
      parseSelection(entry as Value, "continuous.grant-keyword");
    } else if (key === "keyword") {
      parseKeywordValue(entry, "continuous.grant-keyword");
    } else if (key === "keywords") {
      parseKeywordValue(entry, "continuous.grant-keyword");
    } else if (key === "value") {
      if (!isInteger(entry) || entry < 0) {
        throw new TypeError("continuous.grant-keyword value must be a non-negative integer");
      }
    } else if (key === "duration") {
      if (!isDurationAlias(entry)) throw new TypeError("continuous.grant-keyword duration is not a known alias");
    } else if (key === "appliesTo") {
      if (entry !== "self") throw new TypeError('continuous.grant-keyword appliesTo must be "self"');
    } else if (key === "linkKey") {
      if (!isId(entry)) throw new TypeError("continuous.grant-keyword linkKey must be a non-empty string");
    } else if (key === "settlementId") {
      if (!isId(entry)) throw new TypeError("continuous.grant-keyword settlementId must be a non-empty string");
    }
  }
  return value as unknown as ContinuousGrantKeywordArgs;
}

const argsSchema: Schema<ContinuousGrantKeywordArgs> = {
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
  if (!valid) throw new TypeError("Invalid continuous.grant-keyword choice answer");
  return (answer as readonly ObjectRef[]).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function resolveSelection(ctx: ResolveContext, args: ContinuousGrantKeywordArgs): Selection {
  if (args.target !== undefined) return { kind: "target", id: args.target };
  if (args.pick !== undefined) return { kind: "pick", id: args.pick };
  if (args.filter !== undefined) return { kind: "query", filter: args.filter };
  if (args.choose !== undefined) {
    return parseSelection(
      { ...(args.choose as Record<string, unknown>), kind: "choose" } as Value,
      "continuous.grant-keyword"
    );
  }
  if (args.appliesTo !== undefined) return { kind: "source" };
  if (args.objects === undefined) return { kind: "source" };
  return parseSelection(evaluateArgument(ctx, args.objects), "continuous.grant-keyword");
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
const continuousGrantKeyword = {
  op: "continuous.grant-keyword",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousGrantKeywordArgs): InstructionResult {
    const events: GameEvent[] = [];
    const granted: Value[] = [];
    let count = 0;

    const linkKey = args.linkKey === undefined ? "granted" : evaluateArgument(ctx, args.linkKey);
    if (!isId(linkKey)) {
      throw new TypeError("continuous.grant-keyword linkKey must be a non-empty string");
    }
    const writeLinks = (): Record<string, Value> => {
      const receipt: Value = { count, objects: granted };
      const values: Record<string, Value> = {
        [linkKey]: receipt,
        [linkKey + ".count"]: count,
        [linkKey + ".objects"]: granted
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

    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.grant-keyword duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const rawSettlementId = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (rawSettlementId !== undefined && !isId(rawSettlementId)) {
      throw new TypeError("continuous.grant-keyword settlementId must be a non-empty string");
    }
    const settlement = settlementIdentity(ctx.source.ref, "continuous.grant-keyword", key => ctx.linked(key), (key, value) => ctx.link(key, value), rawSettlementId);
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    if (rawAppliesTo !== undefined && rawAppliesTo !== "self") {
      throw new TypeError('continuous.grant-keyword appliesTo must evaluate to "self"');
    }

    // 关键词取值：keywords 优先；否则 keyword（+ value）；两者都缺省 → impossible。
    let grants: KeywordGrant[];
    if (args.keywords !== undefined) {
      grants = parseKeywordValue(evaluateArgument(ctx, args.keywords), "continuous.grant-keyword");
    } else if (args.keyword !== undefined) {
      const single = parseKeywordValue(evaluateArgument(ctx, args.keyword), "continuous.grant-keyword");
      const rawValue = args.value === undefined ? undefined : evaluateArgument(ctx, args.value);
      if (rawValue !== undefined && (typeof rawValue !== "number" || !Number.isSafeInteger(rawValue) || rawValue < 0)) {
        throw new TypeError("continuous.grant-keyword value must evaluate to a non-negative integer");
      }
      grants = single.map(grant => ({ ...grant, ...(rawValue === undefined ? {} : { value: rawValue }) }));
    } else {
      return negate("impossible");
    }

    const selection = resolveSelection(ctx, args);
    const resolution = resolveCandidates(ctx, selection);
    if (resolution.status === "ignored") {
      // 359.3.e.6/e.7：目标（或等价的 pick / 派生引用）全部失效 → ignored。
      return { status: "ignored", reason: "mistargeted" };
    }
    if (resolution.status === "impossible") {
      return negate("impossible");
    }

    const sourceRef = ctx.source.ref;
    let suffix = 0;
    for (const ref of resolution.refs) {
      const snapshot = ctx.object(ref);
      if (snapshot === null) continue;
      suffix += 1;
      const target: OpsTarget = { ref, snapshot };
      const normalised = normaliseKeywordGrants(target, grants);
      const promotedUnvaluedIds = [...new Set(grants
        .filter(grant => grant.value !== undefined && snapshot.keywords.some(keyword =>
          keyword.id === grant.id && keyword.value === undefined))
        .map(grant => grant.id))];
      const registration = buildKeywordGrantSpec(
        "continuous.grant-keyword",
        sourceRef,
        target,
        "continuous.grant-keyword",
        normalised,
        String(suffix),
        {
          settlement,
          condition: promotedUnvaluedIds.length > 0
            ? object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId &&
              promotedUnvaluedIds.every(id => object.keywords.some(keyword => keyword.id === id && keyword.value === undefined))
            : undefined
        }
      );
      ctx.addContinuous(registration.effect, resolveContinuousDuration(duration, sourceRef));
      for (const [index, grant] of grants.entries()) {
        if (grant.value === undefined || snapshot.keywords.every(keyword => keyword.id !== grant.id)) continue;
        const arithmetic = buildKeywordArithmeticSpec(
          "continuous.grant-keyword",
          sourceRef,
          target,
          grant,
          String(suffix) + ":value:" + String(index),
          settlement
        );
        ctx.addContinuous(arithmetic.effect, resolveContinuousDuration(duration, sourceRef));
      }
      count += 1;
      granted.push(refValue(ref));
    }

    if (count === 0) {
      // 选择合法但没有任何对象存活到提交（罕见：resolution 之后全部失效）。
      return negate("skipped");
    }
    const values = writeLinks();
    return { status: "executed", events: [...events], linkedValues: values };
  }
} satisfies InstructionDef<ContinuousGrantKeywordArgs>;

export default continuousGrantKeyword;
