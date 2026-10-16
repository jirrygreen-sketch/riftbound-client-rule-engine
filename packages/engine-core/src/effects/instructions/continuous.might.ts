/**
 * continuous.might — 建立 Might 增 / 减 / 设值的图层效果（RIFT-91 图层引擎的
 * 指令入口，docs/plans/2026-10-15-p0-contract.md 3.4 / 3.8）。
 *
 * 规则依据（CR v1.5）：
 * - 478 / 478.1.a：连续效果按 copy → trait → ability → arithmetic 分层结算，
 *   Might 修改位于 arithmetic 图层；本原语注册 arithmetic 层 spec。
 * - 143.2.c：Might 引用时小于 0 按 0 引用（143.2.c.1 实际值仍存在并参与
 *   计算）—— 终值钳制由图层引擎 applyArithmetic 完成（might < 0 → 0）。
 * - 478.1.c（Siphon Power 例子）："-1 to a minimum of 1" 是逐条修改各自钳制
 *   （6/6 被两个 -1(最小 1) 修改后是 4/6：6 → 5 → 4）。通用引擎只做终值 0 钳制，所以本
 *   原语把印刷下限写进 effect.minimum，由 layers/ops 的 applyMightMinimums
 *   helper 按 CR 478.1.c 的顺序钳制消费（引擎通用路径缺口见最终回复）。
 * - 317.1.a / 317.2.c / 468.7.c：持续性 Game Effect 的持续时间（this turn 在
 *   Expiration Step 到期、this combat 在 combat-end 到期）。
 *
 * 参数（argsSchema 校验 IR 形状：字面值即全量校验，Expr 按形状校验、结算时
 * 求值；解释器 instruction() 会先把每个 arg 的 Expr 求值再传入 execute，所以
 * execute 接受的是已求值字面值，同时兼容未求值的 Expr）：
 * - target?: string — TargetSpec id，经 ctx.targets(id) 读取（355.10.g）。
 * - pick?: string — PickSpec id，经 ctx.picks(id) 读取（契约 3.4：pick 不触发
 *   成为目标类触发）。
 * - choose?: { id, filter?, chooser?, visibility?, prompt?, min?, max? } —
 *   结算时经 ctx.choose 发起 select-objects 非目标选择（355.10.f）；id 是稳定
 *   重放请求 id；选项是 ctx.query(filter)（缺省 {}）按 (id, zoneEntryId) 排序。
 * - objects?: Expr / Value — 求值结果为 { kind: "source" } / { kind: "target",
 *   id } / { kind: "pick", id } / { kind: "query", filter } / { kind: "choose",
 *   ... } / { objects: [ref...] } / 引用数组 / 前序指令的 { count, objects }
 *   链接值（与 effect.empower 的选择约定一致）。
 * - filter?: ObjectFilter — 顶层集合查询（非目标、不发起提问），供卡牌数据
 *   直写。target / pick / choose / objects / filter 至多给一个；都不给时作用
 *   对象是来源自身。
 * - amount?: Expr / number — 增量（可负）；mode "set" 时是目标值。缺省 0。
 * - mode?: Expr / "add" | "set" — 缺省 "add"；"set" 写 kind "set-might"（设为
 *   一个值，替代而非叠加，478.1.a arithmetic 语义）。
 * - minimum?: Expr / number — 本条修改的印刷值下限（CR 478.1.c），非负整数，
 *   写入 effect.minimum。
 * - duration?: Expr / 字符串别名 | { type: "until", at, player? } |
 *   { type: "while-source-in-zone" } — 缺省 "permanent"；别名映射见
 *   layers/ops/index.ts resolveContinuousDuration。
 * - appliesTo?: Expr / "self" — 简写：作用对象是能力来源本身；与显式选择
 *   参数互斥。
 * - linkKey?: Expr / string — 链接值键名，缺省 "affected"。
 *
 * 结果（契约 3.3 / 3.6 原语规则 2）：
 * - target / pick / objects 引用在开始结算时全部失效 → ignored mistargeted
 *   （359.3.e.2/e.4/e.6）；部分失效只处理仍合法的对象（359.3.e.8）。
 * - choose 没有合法选项且 min > 0 → negated impossible（359.3.e.9；与
 *   effect.empower / effect.exhaust 一致）。
 * - add 模式 amount 0 → negated skipped（355.13：选 0 个 / 无操作不发生，不
 *   注册 +0 图层效果）；set 模式目标值 0 是真实修改，正常注册。
 * - 每个合法对象提交一条 ctx.addContinuous（per-object filter + 确定性 id，
 *   见 layers/ops/index.ts）；addContinuous 返回 void、无 replacement 介入，
 *   产出零事件（契约 3.8）。
 * - 链接值（executed 与 negated 都写入实际结果）：<linkKey> = { count,
 *   objects }，另有 <linkKey>.count / <linkKey>.objects。
 *
 * 用到的 GameAction：无（addContinuous 是 ResolveContext 的效果注册通道，
 * 不属于 GameAction 封闭集合，契约 3.8）。
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
  ZoneId,
  Value
} from "../contract.js";
import {
  buildMightSpec,
  isDurationAlias,
  resolveContinuousDuration,
  type DurationAlias,
  type OpsTarget
} from "../../layers/ops/index.js";

/** Args accepted after interpreter evaluation (literal values fully validated). */
export interface ContinuousMightArgs {
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
  readonly amount?: Expr | Value;
  readonly mode?: Expr | Value;
  readonly minimum?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly appliesTo?: Expr | Value;
  readonly linkKey?: Expr | Value;
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
  "target", "pick", "choose", "objects", "filter",
  "amount", "mode", "minimum", "duration", "appliesTo", "linkKey"
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

function parseArgs(value: unknown): ContinuousMightArgs {
  if (!isRecord(value)) throw new TypeError("continuous.might args must be an object");
  const selectors = SELECTOR_KEYS.filter(key => value[key] !== undefined);
  if (selectors.length > 1) {
    throw new TypeError("continuous.might accepts at most one of target, pick, choose, objects, filter");
  }
  if (value.appliesTo !== undefined && selectors.length > 0) {
    throw new TypeError("continuous.might appliesTo self cannot be combined with an explicit selector");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) {
      throw new TypeError("Invalid continuous.might argument: " + key);
    }
    // 表达式只能按形状校验（值在结算时才求值）；直接给出的字面值在此处即完全校验。
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError("Invalid continuous.might argument: " + key);
    if (key === "target" || key === "pick") {
      if (!isId(entry)) throw new TypeError("continuous.might " + key + " must be a spec id string");
    } else if (key === "filter") {
      if (!isFilter(entry)) throw new TypeError("continuous.might filter must be an object filter");
    } else if (key === "choose") {
      parseSelection(
        { ...(entry as Record<string, unknown>), kind: "choose" } as Value,
        "continuous.might"
      );
    } else if (key === "objects") {
      parseSelection(entry as Value, "continuous.might");
    } else if (key === "amount") {
      if (!isInteger(entry)) throw new TypeError("continuous.might amount must be a safe integer");
    } else if (key === "mode") {
      if (entry !== "add" && entry !== "set") {
        throw new TypeError('continuous.might mode must be "add" or "set"');
      }
    } else if (key === "minimum") {
      if (!isInteger(entry) || entry < 0) {
        throw new TypeError("continuous.might minimum must be a non-negative integer");
      }
    } else if (key === "duration") {
      if (!isDurationAlias(entry)) throw new TypeError("continuous.might duration is not a known alias");
      if (isRecord(entry)) parseSelection(entry as Value, "continuous.might");
    } else if (key === "appliesTo") {
      if (entry !== "self") throw new TypeError('continuous.might appliesTo must be "self"');
    } else if (key === "linkKey") {
      if (!isId(entry)) throw new TypeError("continuous.might linkKey must be a non-empty string");
    }
  }
  return value as unknown as ContinuousMightArgs;
}

const argsSchema: Schema<ContinuousMightArgs> = {
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

/** 442.2 风格的 Board 判定：非 Board 区域的对象不再接收修改（359.3.e.8）。 */
function isBoardObject(snapshot: ObjectSnapshot | null): snapshot is ObjectSnapshot {
  return snapshot !== null && !NON_BOARD_ZONES.has(snapshot.zone);
}

/** 保序去重，并丢掉已离区或已不在 Board 的引用（359.3.e.2/e.4/e.8）。 */
function currentBoardRefs(ctx: ResolveContext, refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const current: ObjectRef[] = [];
  for (const ref of refs) {
    const key = refKeyOf(ref);
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

function refKeyOf(ref: ObjectRef): string {
  return ref.id + ":" + String(ref.zoneEntryId);
}

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
  if (!valid) throw new TypeError("Invalid continuous.might choice answer");
  return (answer as readonly ObjectRef[]).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

/**
 * CR 107 / 108：契约 ZoneId 没有 legend-zone 成员，用“不属于已知非 Board 区域”
 * 表达 Board；与非 Board 区域的对象不再接收修改（359.3.e.8）。
 */
const NON_BOARD_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "chain"
]);

function resolveSelection(ctx: ResolveContext, args: ContinuousMightArgs): Selection {
  if (args.target !== undefined) return { kind: "target", id: args.target };
  if (args.pick !== undefined) return { kind: "pick", id: args.pick };
  if (args.filter !== undefined) return { kind: "query", filter: args.filter };
  if (args.choose !== undefined) return parseSelection(
    { ...(args.choose as Record<string, unknown>), kind: "choose" } as Value,
    "continuous.might"
  );
  if (args.appliesTo !== undefined) return { kind: "source" };
  if (args.objects === undefined) return { kind: "source" };
  return parseSelection(evaluateArgument(ctx, args.objects), "continuous.might");
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
const continuousMight = {
  op: "continuous.might",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousMightArgs): InstructionResult {
    const events: GameEvent[] = [];
    const affected: Value[] = [];
    let count = 0;

    const linkKey = args.linkKey === undefined ? "affected" : evaluateArgument(ctx, args.linkKey);
    if (!isId(linkKey)) {
      throw new TypeError("continuous.might linkKey must be a non-empty string");
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

    const rawMode = args.mode === undefined ? "add" : evaluateArgument(ctx, args.mode);
    if (rawMode !== "add" && rawMode !== "set") {
      throw new TypeError('continuous.might mode must evaluate to "add" or "set"');
    }
    const mode: "add" | "set" = rawMode;

    const rawAmount = args.amount === undefined ? 0 : evaluateArgument(ctx, args.amount);
    if (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount)) {
      throw new TypeError("continuous.might amount must evaluate to a safe integer");
    }
    const amount: number = rawAmount;
    const rawMinimum = args.minimum === undefined ? undefined : evaluateArgument(ctx, args.minimum);
    if (rawMinimum !== undefined && (typeof rawMinimum !== "number" || !Number.isSafeInteger(rawMinimum) || rawMinimum < 0)) {
      throw new TypeError("continuous.might minimum must evaluate to a non-negative integer");
    }
    const minimum = rawMinimum;
    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.might duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    if (rawAppliesTo !== undefined && rawAppliesTo !== "self") {
      throw new TypeError('continuous.might appliesTo must evaluate to "self"');
    }

    // 355.13：add 模式的 0 增量不注册效果、不发生（"选了 0 个"）；set 模式的
    // 0 是真实修改（Set Might to 0），正常注册。
    if (mode === "add" && amount === 0) {
      return negate("skipped");
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
      const target: OpsTarget = {
        ref,
        snapshot,
        ...(minimum === undefined ? {} : { minimum })
      };
      const registration = buildMightSpec(
        "continuous.might",
        sourceRef,
        target,
        mode,
        amount,
        String(suffix)
      );
      ctx.addContinuous(registration.effect, resolveContinuousDuration(duration, sourceRef));
      count += 1;
      affected.push(refValue(ref));
    }

    if (count === 0) {
      // 选择合法但没有任何对象存活到提交（罕见：resolution 之后全部失效）。
      return negate("skipped");
    }
    const values = writeLinks();
    return { status: "executed", events: [...events], linkedValues: values };
  }
} satisfies InstructionDef<ContinuousMightArgs>;

export default continuousMight;
