/**
 * effect.empower — Empower / Disempower 状态（作为效果执行）。
 *
 * 规则依据（Core Rules v1.5）：442 定义 Empower（把 Game Object 变为 Empowered），
 * 443 定义 Disempower（移除 Empowered 状态）。两者都是 Limited Action
 * （442.3 / 442.3.a、443.2 / 443.2.a）：只有游戏效果指示时才能执行 —— 本原语
 * 就是那个“游戏效果指示”的入口。关键词 [Empower] 的启动费用与
 * “Use only if not Empowered”限制属于 cost.activated / cost.pay 与关键词展开
 * （827.1.b、827.1.b.1、827.1.c.1–c.4、827.2/827.2.a）；Empowered 依赖能力
 * （828.1.b.1、828.1.c、828.1.d）由 continuous 图层与触发器读取，都不在本原语内。
 *
 * 参数（argsSchema 校验 IR 形状；每个参数既可以是 card-dsl Expr，也可以是
 * 解释器已求值的字面值，两种调用约定都支持）：
 *
 * - objects?: Expr / Value — 要 Empower 或 Disempower 的对象。求值结果必须是
 *   下列之一：
 *   - { kind: "source" }：能力来源对象（[Empower] 的“Empower me”即此值，
 *     827.1.b 让能力来源本身成为 Empowered；827.1.b.1 来源不是目标）；
 *   - { kind: "target", id }：经 ctx.targets(id) 读取 Finalize 锁定、Resolve
 *     重验后仍合法的目标（“Empower a unit.”、ven-035-166 Sanction）；
 *   - { kind: "pick", id }：经 ctx.picks(id) 读取非目标选择（契约 3.4：pick
 *     不是目标，不触发“成为目标”类触发）；
 *   - { kind: "query", filter }：经 ctx.query(filter) 读取当前匹配的集合
 *     （442.1 的 one or more Game Objects，如“Empower all ...”）
 *   - { kind: "choose", id, filter, min?, max?, chooser?, visibility?, prompt? }：
 *     结算时才做的非目标选择，经 ctx.choose 发起 select-objects（id 是稳定的
 *     重放请求 id；min / max 缺省为 1；chooser 缺省为能力控制者）；
 *   - 单个对象引用、引用数组，或前序指令的 { count, objects } 链接值（消费
 *     “if you do”拿到的实际结果）。
 *   objects 缺省为 { kind: "source" }。
 *
 * - mode?: Expr / Value — "empower" 或 "disempower"，缺省 "empower"。两种动作
 *   共用一个原语，因为 RIFT-9 调研把两者算作同一张模板（effect.empower =
 * "Empower / Disempower 状态"，卡池覆盖率 M2 中 53 个身份直接用到）。
 *
 * - amount?: Expr / Value — 本次为每个对象添加多少个 Empower 状态，缺省 1
 *   （442.1.a 的二元状态即 amount 1）。0 表示“up to N”里选了 0 个（355.13）：
 *   不发起选择、不提交动作，仍返回 executed 并链接 count 0。大于 1 需要对象
 *   拥有“可被 Empower 多次”许可（442.1.c.1，见 multiple / limit）。
 *   disempower 模式不接受 amount / multiple / limit：443.1.b 每次只移除一个
 *   状态，由 disempower 动作自身保证。
 *
 * - multiple?: Expr / Value（布尔）— 该对象拥有“可被 Empower 多次”许可时为
 *   true（442.1.c.1：这类对象忽略 442.1.b 的限制，Empowered 成为可叠加状态）。
 *   缺省 false，此时不下发该字段。许可本身是卡牌特征（如 ven-134-166 Kayle
 *   “I can be Empowered up to three times.”），由图层 / 关键词侧持有；本原语
 *   只把作者声明的许可原样随动作下发。
 *
 * - limit?: Expr / Value（非负整数）— 叠加 Empower 的上限，随动作下发。
 *
 * - linkKey?: Expr / Value — 实际结果写入 ctx.link 的键；缺省按模式取
 *   "empowered" / "disempowered"。
 *
 * 结果（契约 3.3、3.6 原语规则 2；v1.5 055、359.3.e.6–e.9、e.11）：
 * - 全部 perform 为 done → executed；
 * - 任一 perform 为 replaced / prevented / impossible → negated（replaced 保留
 *   reason "replaced"，prevented 与 impossible 归为 "impossible"），其余对象
 *   按 055 / 359.3.e.11“能做多少做多少”继续处理，实际发生的结果仍写入链接值；
 * - 目标 / pick / 派生引用在开始结算时全部失效（对象已离区、旧 zoneEntryId、
 *   已不在 Board）→ ignored（reason "mistargeted"，359.3.e.2/e.4/e.6/e.7）；
 *   部分失效时按 359.3.e.8 只处理仍合法的对象；非目标 choose 没有任何合法选项
 *   且 min > 0 → negated "impossible"（359.3.e.9 的 Mistargeting 在非目标选择上
 *   没有 ignored 语义，与 effect.ready / effect.attach 一致）；
 * - 链接值（executed 与 negated 都写入实际结果，供 "if you do" 与后续链接指令
 *   判断）：<linkKey> = { mode, count, objects }，另有 <linkKey>.count 与
 *   <linkKey>.objects 便于链接表达式直接引用。count 只统计动作完成的对象。
 *
 * 状态检查的边界：“已被 Empower 的对象不能再次 Empower，什么也不发生”
 * （442.1.b / 442.1.c）与“Disempower 只影响当前 Empowered 的对象”
 * （443.1.a / 443.1.a.1）在提交动作前由本原语读取统一的 live 状态规划；缺少
 * Empowered 字段的旧快照会严格失败闭合。最终状态、回滚与实付收据仍由动作适配器
 * 提交并返回（见回复里的契约变更请求）。Empowered 触发的时点（828.1.d、
 * “When I become [Empowered]”）由动作层发出 empowered-changed 后交给 trigger.state
 * 处理。
 *
 * 与相近原语的边界：
 * - 与 effect.exhaust / effect.ready 同类：只提交状态标记动作并记录实际结果，
 *   不移动区域、不改控制权、不推进优先权、不往链上加项。成为 Empowered 之后
 *   的收益（“+2 Might for each time I'm Empowered”、Deflect / Ganking）属于
 *   continuous 图层与 condition.predicate，读取状态的谓词不在本原语。
 * - [Empower] 关键词的费用、费用改写与“Use only if not Empowered”限制属于
 *   cost.activated / cost.pay / cost.modify 与关键词展开；“达上限时启动仍合法
 *   但无效果”（契约 3.4）由 Finalize / 关键词侧处理，本原语不重复实现。
 * - 回合结束的“Disempower it at end of turn”（ven-035-166 Sanction）由 delayed /
 *   阶段触发再次调用本原语，本原语自身不注册延迟触发。
 *
 * 用到的 GameAction：仅 empower 与 disempower（契约 3.6 状态标记类别，封闭集合
 * 已有；不新增、不增删任何动作）。
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
  disempowerTransition,
  empowerTransition,
  type EmpowermentTransition
} from "../../zones/empower-state.js";

/** 结算期选择（choose）的稳定请求描述。 */
export interface EffectEmpowerChoice {
  readonly id: string;
  readonly filter?: ObjectFilter;
  readonly chooser?: PlayerId;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
  readonly min?: number;
  readonly max?: number;
}

/** 本原语的参数；接受 Expr 或已求值的字面值。 */
export interface EffectEmpowerArgs {
  readonly objects?: Expr | Value;
  readonly mode?: Expr | Value;
  readonly amount?: Expr | Value;
  readonly multiple?: Expr | Value;
  readonly limit?: Expr | Value;
  readonly linkKey?: Expr | Value;
}

/** 结算时确定对象的方式（来源 / 目标 / pick / 集合查询 / 结算期选择 / 显式引用）。 */
type Selection =
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
      readonly chooser?: PlayerId;
      readonly visibility?: ChoiceVisibility;
      readonly prompt?: string;
    }
  | { readonly kind: "refs"; readonly refs: readonly ObjectRef[] };

/** 选择解析结果；ignored / impossible 由调用方映射为指令结果。 */
type CandidateResolution =
  | { readonly status: "ok"; readonly refs: readonly ObjectRef[] }
  | { readonly status: "ignored" }
  | { readonly status: "impossible" };

const ARGUMENT_KEYS: readonly string[] = [
  "objects",
  "mode",
  "amount",
  "multiple",
  "limit",
  "linkKey"
];

const CHOICE_KEYS: readonly string[] = [
  "kind",
  "id",
  "filter",
  "chooser",
  "visibility",
  "prompt",
  "min",
  "max"
];

/**
 * CR 107 把 Bases、Battlefield Zones、Facedown Zones 与 Legend Zone 归入 The
 * Board，108 列出 Chain、Trash、Hand、Main Deck、Rune Deck、Banishment 等非
 * Board 区域。契约的 ZoneId 目前没有 legend-zone / champion-zone 成员（见回复里
 * 的契约变更请求），所以这里用“不属于已知非 Board 区域”表达 442.2 / 443.1 的
 * “在 Board 上”，将来契约补上时无需改动本原语（与 effect.exhaust 同一写法）。
 */
const NON_BOARD_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "hand",
  "deck",
  "rune-deck",
  "trash",
  "banishment",
  "chain"
]);

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

function isVisibility(value: unknown): value is ChoiceVisibility {
  return value === "public" || value === "chooser-only" ||
    (Array.isArray(value) && value.length > 0 && value.every(isId));
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant":
    case "literal":
      return "value" in value && isValue(value.value);
    case "object-property":
      return isRef(value.object) && isId(value.property);
    case "object-attribute":
      return isRef(value.object) && isId(value.attribute);
    case "linked":
    case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count":
      return isId(value.subject) && (value.filter === undefined || isFilter(value.filter));
    default:
      return false;
  }
}

function bound(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("effect.empower " + label + " must be a nonnegative safe integer");
  }
  return value;
}

/** 把已求值的 Value 解析为选择描述；形状错误按作者侧错误抛出。 */
function parseSelection(value: Value): Selection {
  if (isRef(value)) {
    return { kind: "refs", refs: [{ id: value.id, zoneEntryId: value.zoneEntryId }] };
  }
  // 便捷简写：裸字符串就是 TargetSpec id（等价于 { kind: "target", id }）。
  if (isId(value)) return { kind: "target", id: value };
  if (Array.isArray(value)) {
    if (!value.every(isRef)) {
      throw new TypeError("effect.empower objects must contain only object references");
    }
    return { kind: "refs", refs: value as readonly ObjectRef[] };
  }
  if (!isRecord(value)) {
    throw new TypeError(
      "effect.empower objects must be a selection descriptor or object reference(s)"
    );
  }
  switch (value.kind) {
    case "source":
      return { kind: "source" };
    case "target":
    case "pick":
      if (!isId(value.id)) {
        throw new TypeError(
          "effect.empower " + value.kind + " selection requires a non-empty id"
        );
      }
      return { kind: value.kind, id: value.id };
    case "query":
      if (!isFilter(value.filter)) {
        throw new TypeError("effect.empower query selection requires a filter");
      }
      return { kind: "query", filter: value.filter };
    case "choose": {
      for (const name of Object.keys(value)) {
        if (!CHOICE_KEYS.includes(name)) {
          throw new TypeError("Invalid effect.empower choose argument: " + name);
        }
      }
      if (!isId(value.id)) {
        throw new TypeError("effect.empower choose selection requires a non-empty id");
      }
      if (!isFilter(value.filter)) {
        throw new TypeError("effect.empower choose selection requires a filter");
      }
      const min = value.min === undefined ? undefined : bound(value.min, "choose min");
      const max = value.max === undefined ? undefined : bound(value.max, "choose max");
      if (min !== undefined && max !== undefined && min > max) {
        throw new TypeError("effect.empower choose selection min must not exceed max");
      }
      if (value.chooser !== undefined && !isId(value.chooser)) {
        throw new TypeError("effect.empower choose chooser must be a player id");
      }
      if (value.visibility !== undefined && !isVisibility(value.visibility)) {
        throw new TypeError("effect.empower choose visibility is invalid");
      }
      if (value.prompt !== undefined && !isId(value.prompt)) {
        throw new TypeError("effect.empower choose prompt must be a non-empty string");
      }
      return {
        kind: "choose",
        id: value.id,
        filter: value.filter,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(value.chooser === undefined ? {} : { chooser: value.chooser }),
        ...(value.visibility === undefined ? {} : { visibility: value.visibility }),
        ...(value.prompt === undefined ? {} : { prompt: value.prompt })
      };
    }
    default:
      if (value.kind === undefined && Array.isArray(value.objects) && value.objects.every(isRef)) {
        return { kind: "refs", refs: value.objects as readonly ObjectRef[] };
      }
      throw new TypeError(
        "effect.empower objects must be a selection descriptor or object reference(s)"
      );
  }
}

function parseArgs(value: unknown): EffectEmpowerArgs {
  if (!isRecord(value)) throw new TypeError("effect.empower args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) {
      throw new TypeError("Invalid effect.empower argument: " + key);
    }
    // 表达式只能按形状校验（值在结算时才求值）；直接给出的字面值在此处即完全校验。
    if (isExpr(argument)) continue;
    if (!isValue(argument)) throw new TypeError("Invalid effect.empower argument: " + key);
    if (key === "mode" && argument !== "empower" && argument !== "disempower") {
      throw new TypeError('effect.empower mode must be "empower" or "disempower"');
    }
    if (key === "amount") bound(argument, "amount");
    if (key === "limit") bound(argument, "limit");
    if (key === "multiple" && typeof argument !== "boolean") {
      throw new TypeError("effect.empower multiple must be a boolean");
    }
    if (key === "linkKey" && !isId(argument)) {
      throw new TypeError("effect.empower linkKey must be a non-empty string");
    }
    if (key === "objects") parseSelection(argument);
  }
  return value as unknown as EffectEmpowerArgs;
}

const argsSchema: Schema<EffectEmpowerArgs> = {
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

function refKey(ref: ObjectRef): string {
  return ref.id + ":" + String(ref.zoneEntryId);
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

/** 442.2 / 443.1：Empowered 是 Board 上 Game Object 的状态。 */
function isBoardObject(snapshot: ObjectSnapshot | null): snapshot is ObjectSnapshot {
  return snapshot !== null && !NON_BOARD_ZONES.has(snapshot.zone);
}

/** 保序去重，并丢掉已离区或已不在 Board 的引用（359.3.e.2/e.4/e.8）。 */
function currentBoardRefs(ctx: ResolveContext, refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const current: ObjectRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
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
  // max 0：选择已被唯一确定（355.10.d.1 的“没有其他可能”），不发起空提问。
  if (max === 0) return [];
  // 355.10.f / 359.3.e.9：一个合法选择都没有的 must 型非目标选择是 impossible。
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
  if (!valid) throw new TypeError("Invalid effect.empower choice answer");
  return (answer as readonly ObjectRef[]).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function resolveCandidates(ctx: ResolveContext, selection: Selection): CandidateResolution {
  switch (selection.kind) {
    case "source": {
      const refs = currentBoardRefs(ctx, [ctx.source.ref]);
      return refs.length === 0 ? { status: "ignored" } : { status: "ok", refs };
    }
    case "target": {
      const refs = currentBoardRefs(ctx, ctx.targets(selection.id));
      return refs.length === 0 ? { status: "ignored" } : { status: "ok", refs };
    }
    case "pick": {
      const refs = currentBoardRefs(ctx, ctx.picks(selection.id).filter(isRef));
      return refs.length === 0 ? { status: "ignored" } : { status: "ok", refs };
    }
    case "refs": {
      const refs = currentBoardRefs(ctx, selection.refs);
      return refs.length === 0 ? { status: "ignored" } : { status: "ok", refs };
    }
    case "query":
      return { status: "ok", refs: sortedBoardRefs(ctx, selection.filter) };
    case "choose": {
      const options = sortedBoardRefs(ctx, selection.filter);
      const requestedMax = selection.max ?? 1;
      const requestedMin = selection.min ?? requestedMax;
      if (options.length === 0 && requestedMin > 0) return { status: "impossible" };
      if (options.length === 0) return { status: "ok", refs: [] };
      return { status: "ok", refs: askSelection(ctx, selection, options) };
    }
  }
}

export default {
  op: "effect.empower",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectEmpowerArgs): InstructionResult {
    const rawObjects = args.objects === undefined ? undefined : evaluateArgument(ctx, args.objects);
    const selection: Selection = rawObjects === undefined
      ? { kind: "source" }
      : parseSelection(rawObjects);

    const rawMode = args.mode === undefined ? "empower" : evaluateArgument(ctx, args.mode);
    if (rawMode !== "empower" && rawMode !== "disempower") {
      throw new TypeError('effect.empower mode must evaluate to "empower" or "disempower"');
    }
    const mode: "empower" | "disempower" = rawMode;

    const hasAmount = args.amount !== undefined;
    const hasMultiple = args.multiple !== undefined;
    const hasLimit = args.limit !== undefined;
    if (mode === "disempower" && (hasAmount || hasMultiple || hasLimit)) {
      throw new TypeError(
        "effect.empower disempower mode does not accept amount, multiple, or limit"
      );
    }
    const amount = hasAmount ? bound(evaluateArgument(ctx, args.amount!), "amount") : 1;
    let multiple = false;
    if (hasMultiple) {
      const evaluated = evaluateArgument(ctx, args.multiple!);
      if (typeof evaluated !== "boolean") {
        throw new TypeError("effect.empower multiple must evaluate to a boolean");
      }
      multiple = evaluated;
    }
    const limit = hasLimit ? bound(evaluateArgument(ctx, args.limit!), "limit") : undefined;

    const linkKey = args.linkKey === undefined
      ? (mode === "empower" ? "empowered" : "disempowered")
      : evaluateArgument(ctx, args.linkKey);
    if (!isId(linkKey)) {
      throw new TypeError("effect.empower linkKey must be a non-empty string");
    }

    // NegatedInstructionResult 没有 linkedValues 字段（契约 3.3），但实际结果仍要写进
    // ctx.link："if you do" 与后续链接指令要按 CR 055 看到已经发生的那部分结果。
    const writeLinks = (objects: readonly ObjectRef[], receipts: readonly Value[] = []): Record<string, Value> => {
      const refs = objects.map(refValue);
      const values: Record<string, Value> = {
        [linkKey]: { mode, count: objects.length, objects: refs },
        [linkKey + ".count"]: objects.length,
        [linkKey + ".objects"]: refs
      };
      // A payment/transaction adapter may provide an atomic receipt for a
      // Disempower action.  Preserve that evidence beside the stable object
      // result without changing the existing empower link shape.
      if (mode === "disempower" && receipts.length > 0) {
        values[linkKey + ".receipts"] = [...receipts];
      }
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };

    // 355.13："up to N" 里选了 0 个时不发起选择、不提交动作。
    if (mode === "empower" && amount === 0) {
      return { status: "executed", events: [], linkedValues: writeLinks([]) };
    }

    const resolution = resolveCandidates(ctx, selection);
    if (resolution.status === "ignored") {
      // 359.3.e.6/e.7：目标（或等价的 pick / 派生引用）全部失效 → ignored，
      // 其后链接的指令同样被忽略（契约 3.6 原语规则 2）。
      return { status: "ignored", reason: "mistargeted" };
    }
    if (resolution.status === "impossible") {
      return { status: "negated", reason: "impossible", events: [] };
    }

    // Resolve-time state is authoritative.  Finalize/keyword restrictions may
    // have been checked earlier, while another item on the Chain can change
    // the same object's Empowered count before this instruction resolves.
    // Planning all transitions before submitting any action also prevents a
    // missing state field on a later object from causing a partial mutation.
    const planned: readonly { readonly ref: ObjectRef; readonly transition: EmpowermentTransition }[] =
      resolution.refs.map(ref => ({
        ref,
        transition: mode === "empower"
          ? empowerTransition(ctx.object(ref), { amount, multiple, limit })
          : disempowerTransition(ctx.object(ref))
      }));

    const events: GameEvent[] = [];
    const acted: ObjectRef[] = [];
    const receipts: Value[] = [];
    let reason: "replaced" | "impossible" | null = null;
    for (const { ref, transition } of planned) {
      // CR 442.1.b/442.1.c and 443.1.a/443.1.a.1 are no-effect outcomes;
      // they do not submit a redundant action and therefore cannot emit a
      // misleading empowered-changed event.
      if (!transition.changed) continue;
      const outcome = mode === "empower"
        ? ctx.perform({
            type: "empower",
            object: ref,
            amount: transition.appliedAmount,
            ...(multiple ? { multiple: true } : {}),
            ...(limit === undefined ? {} : { limit })
          })
        : ctx.perform({ type: "disempower", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        // replaced 保留原因；prevented / impossible 都归为 impossible（与
        // effect.exhaust / effect.ready 的映射一致），其余对象继续执行。
        reason ??= outcome.status === "replaced" ? "replaced" : "impossible";
        continue;
      }
      if (ctx.object(ref) !== null) {
        acted.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
        if (outcome.receipt !== undefined) receipts.push(outcome.receipt as unknown as Value);
      }
    }

    const values = writeLinks(acted, receipts);
    if (reason !== null) return { status: "negated", reason, events };
    return { status: "executed", events, linkedValues: values };
  }
} satisfies InstructionDef<EffectEmpowerArgs>;
