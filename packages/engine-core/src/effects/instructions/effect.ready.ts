/**
 * effect.ready — 重置（Ready；Core Rules v1.5 416.1–416.3）。
 *
 * 参数（`argsSchema` 校验 IR 形状；每个参数既可以是 card-dsl `Expr`，也可以是解释器已
 * 求值的字面值，两种调用约定都支持）：
 *
 * - `objects?: Expr | Value` — 要重置的对象。求值结果必须是下列之一：
 *   - `{ kind: "source" }`：能力来源对象（“ready me”，355.10.g、412.4）；缺省即此值；
 *   - `{ kind: "target", id }`：经 `ctx.targets(id)` 读取 Finalize 锁定、Resolve 重验后
 *     仍合法的目标 TargetSpec。“Ready a friendly unit/gear/legend”都选目标（355.9、
 *     355.10.a、355.10.g）；
 *   - `{ kind: "pick", id }`：经 `ctx.picks(id)` 读取非目标 pick（355.10.c/e/f），不触发
 *     “成为目标”相关触发（契约 3.4）；
 *   - `{ kind: "query", filter }`：经 `ctx.query(filter)` 取当前匹配集合，用于 “Ready your
 *     units.”“ready all enemy units.” 这类无选择的集合（355.10.d、355.10.d.1）；
 *   - `{ kind: "choose", id, filter, min?, max?, prompt? }`：结算时才做的选择，经
 *     `ctx.choose` 发起 `select-objects` 公开请求（355.10.e/f、359.3.e.9）。`id` 是稳定
 *     重放请求 id；选项为当前匹配对象的引用，缺省 `max` 为 1、`min` 为 `max`；
 *   - `{ event: "it" }`：触发条件满足时冻结的事件对象引用。它只经
 *     `ResolveContext.eventObject("it")` 读取并由共享 `resolveObjectSelector` 校验，不接受
 *     source/target 回退，也不发起玩家选择（359.3.f.3、383.2.c.3.b）；
 *   - 单个对象引用 `{ id, zoneEntryId }`、其数组、或含 `objects` 引用数组的记录（消费
 *     前序指令写入的 `{ count, objects }` 链接值，供 “if you do / it” 引用）。
 *
 * - `amount?: Expr | Value` — 本次最多重置多少个对象（非负安全整数；缺省不设上限）。
 *   超量时按实际可用对象数执行（359.3.e.11）；`0` 不提交任何动作、也不发起选择。
 * - `linkKey?: Expr | Value` — 写入链接值的键，缺省 `"readied"`。
 *
 * 结果（契约 3.3、3.6 原语规则 2/3；v1.5 359.3.e.6–e.11）：
 * - 全部 `perform` 为 done → `executed`，链接值 `{ count, objects }` 记录实际被重置的对象
 *   个数与引用；
 * - 任一 `perform` 为 replaced/prevented/impossible → `negated`（`replaced` 保留原因，其余
 *   归为 `impossible`），其余对象继续处理，链接值记录实际发生的部分结果；
 * - 目标（或 pick/派生引用）在指令开始结算时全部失效 → `ignored`，reason `mistargeted`
 *   （359.3.e.6 引用不可用、359.3.e.7 目标全部失效、359.3.e.9 把“选择失效”也定义为
 *   Mistargeting）；部分失效时按 359.3.e.8 只处理仍合法的对象。
 * - 已经就绪的对象按 416.1.b/416.1.c 不再重置：不提交动作、不产生事件、不计入 `count`；
 *   若选中的对象都已就绪，仍是 `executed`（“nothing additional happens”），`count` 为 0。
 * - 确定性：只经 `ResolveContext` 读取，不读时间、不用随机；集合查询与选择选项按
 *   id/zoneEntryId 排序，目标按 Finalize 锁定顺序，保证同等输入下结果一致。
 *
 * 边界：
 * - **“enter ready” 是入场替代，不是事后重置**。359.2.c 规定单位横置入场，369.3、805.6
 *   （Accelerate）由入场事件的替代效果把“横置入场”替换成“就绪入场”。本原语不参与该流程，
 *   也不能拿它模拟（sfd-071-221“I enter ready if you control another Mech.”、
 *   sfd-103-221 的 Accelerate 同理），并且不会对已就绪对象补发一次重置事件。
 * - 不处理 “When you ready …” 触发（时点/触发管线职责，412.4）、不实现 416.3.a 觉醒
 *   阶段的常规重置，也不实现 rad-019-167“Units don't ready during the Awaken Phase.” 这类
 *   静态限制（continuous.restrict）。
 * - 不横置（effect.exhaust）、不支付费用（“[E]: 重置 X” 的费用由 cost.* 处理）、不移动
 *   区域、不改控制权、不注册持续效果或延迟触发。
 * - 只经 `perform` 提交封闭集合内已有的 GameAction（契约 3.6）`{ type: "ready", object }`，
 *   由内核处理替代与预防；不直接改状态、不推进优先权、不往链上加项。
 */
import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectFilter,
  ObjectRef,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";
import { resolveObjectSelector } from "../interpreter/selectors.js";

/** 结算时确定重置对象的方式（目标选择 / 非目标 pick / 集合查询 / 结算期选择）。 */
export type EffectReadySelection =
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

/** 本原语的参数；接受 `Expr` 或已求值的字面值。 */
export interface EffectReadyArgs {
  readonly objects?: Expr | Value | EffectReadySelection;
  readonly amount?: Expr | Value;
  readonly linkKey?: Expr | Value;
}

/** 解析后的选择：选择描述符，或直接给出的对象引用集合。 */
type ResolvedSelection =
  | EffectReadySelection
  | { readonly kind: "event"; readonly role: "it" }
  | { readonly kind: "refs"; readonly refs: readonly ObjectRef[] };

interface PendingChoice {
  readonly id: string;
  readonly options: readonly ObjectRef[];
  readonly min: number;
  readonly max: number;
  readonly prompt?: string;
}

const ARGUMENT_KEYS: readonly string[] = ["objects", "amount", "linkKey"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((entry) => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return (
    isRecord(value) &&
    !Object.hasOwn(value, "event") &&
    isId(value.id) &&
    Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0
  );
}

function isFilter(value: unknown): value is ObjectFilter {
  return isRecord(value) && isValue(value);
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant":
    case "literal":
      return "value" in value && isValue(value.value);
    case "object-property":
      return isRecord(value.object) && isId(value.object.id) && isId(value.property);
    case "object-attribute":
      return isRecord(value.object) && isId(value.object.id) && isId(value.attribute);
    case "linked":
    case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count":
      return isId(value.subject) && (value.filter === undefined || isFilter(value.filter));
    default:
      return false;
  }
}

function parseArgs(value: unknown): EffectReadyArgs {
  if (!isRecord(value)) throw new TypeError("effect.ready args must be an object");
  for (const [key, argument] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key)) throw new TypeError(`Invalid effect.ready argument: ${key}`);
    // 表达式只能按形状校验（值在结算时才求值）；直接给出的字面值在此处即完全校验。
    if (isExpr(argument)) continue;
    if (!isValue(argument)) throw new TypeError(`Invalid effect.ready argument: ${key}`);
    if (key === "amount" &&
        (typeof argument !== "number" || !Number.isSafeInteger(argument) || argument < 0)) {
      throw new TypeError("effect.ready amount must be a nonnegative safe integer");
    }
    if (key === "objects") parseSelection(argument);
    if (key === "linkKey" && !isId(argument)) {
      throw new TypeError("effect.ready linkKey must be a non-empty string");
    }
  }
  return value as unknown as EffectReadyArgs;
}

const argsSchema: Schema<EffectReadyArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

/** `Expr` 经 `ctx.evaluate` 求值（取值时机即调用时，契约 3.6）；字面值原样使用。 */
function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : (argument as Value);
}

function selectionBound(value: unknown, label: "min" | "max"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`effect.ready choose selection ${label} must be a nonnegative safe integer`);
  }
  return value;
}

function parseSelection(value: Value): ResolvedSelection {
  if (isRef(value)) return { kind: "refs", refs: [{ id: value.id, zoneEntryId: value.zoneEntryId }] };
  // 便捷简写：裸字符串就是 TargetSpec id（等价于 { kind: "target", id }）。
  if (isId(value)) return { kind: "target", id: value };
  if (Array.isArray(value)) {
    if (!value.every(isRef)) {
      throw new TypeError("effect.ready objects must contain only object references");
    }
    return { kind: "refs", refs: value as readonly ObjectRef[] };
  }
  if (!isRecord(value)) {
    throw new TypeError("effect.ready objects must be a selection descriptor or object reference(s)");
  }
  // A pronoun is an immutable event referent, not a TargetSpec/PickSpec or a
  // free-form record. Keep the selector to its sole legal spelling here; the
  // shared selector resolver owns the binding and incarnation checks.
  if (Object.keys(value).length === 1 && Object.hasOwn(value, "event") && value.event === "it") {
    return { kind: "event", role: "it" };
  }
  switch (value.kind) {
    case "source":
      return { kind: "source" };
    case "target":
    case "pick":
      if (!isId(value.id)) {
        throw new TypeError(`effect.ready ${value.kind} selection requires a non-empty id`);
      }
      return { kind: value.kind, id: value.id };
    case "query":
      if (!isFilter(value.filter)) {
        throw new TypeError("effect.ready query selection requires a filter");
      }
      return { kind: "query", filter: value.filter };
    case "choose": {
      if (!isId(value.id)) {
        throw new TypeError("effect.ready choose selection requires a non-empty id");
      }
      if (!isFilter(value.filter)) {
        throw new TypeError("effect.ready choose selection requires a filter");
      }
      const min = value.min === undefined ? undefined : selectionBound(value.min, "min");
      const max = value.max === undefined ? undefined : selectionBound(value.max, "max");
      if (min !== undefined && max !== undefined && min > max) {
        throw new TypeError("effect.ready choose selection min must not exceed max");
      }
      if (value.prompt !== undefined && !isId(value.prompt)) {
        throw new TypeError("effect.ready choose selection prompt must be a non-empty string");
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
        return { kind: "refs", refs: value.objects as readonly ObjectRef[] };
      }
      throw new TypeError("effect.ready objects must be a selection descriptor or object reference(s)");
  }
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

/** 保序去重：同一对象（同一 zoneEntryId）在一次结算里只重置一次。 */
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

/** 集合查询与选择选项需要与调用顺序无关的稳定顺序（确定性）。 */
function sortedRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  return distinctRefs(refs).sort((left, right) => {
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return left.zoneEntryId - right.zoneEntryId;
  });
}

function assertAmount(value: Value | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("effect.ready amount must be a nonnegative safe integer");
  }
  return value;
}

function assertLinkKey(value: Value | undefined): string {
  if (value === undefined) return "readied";
  if (!isId(value)) throw new TypeError("effect.ready linkKey must be a non-empty string");
  return value;
}

/** Resolve only the legal event pronoun through the shared fail-closed seam. */
function resolveEventRef(ctx: ResolveContext, selection: { readonly role: "it" }): ObjectRef {
  const refs = resolveObjectSelector(
    { event: selection.role },
    { context: ctx, linked: (key) => ctx.linked(key) }
  );
  if (refs.length !== 1) throw new Error("effect.ready event:it must resolve exactly one object");
  const [ref] = refs;
  // The shared resolver returns exactly one frozen event referent or throws
  // MissingInformation. This guard protects the primitive's non-null contract
  // without adding any fallback identity.
  if (ref === undefined) throw new Error("effect.ready event:it resolved no object");
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

/** 非法的 `select-objects` 答案在这里拒绝；无答案时 `ctx.choose` 抛 AwaitChoice 由事务回滚重问。 */
function askSelection(ctx: ResolveContext, choice: PendingChoice): ObjectRef[] {
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: choice.id,
    type: "select-objects",
    chooser: ctx.controller,
    visibility: "public",
    options: choice.options,
    min: choice.min,
    max: choice.max,
    ...(choice.prompt === undefined ? {} : { prompt: choice.prompt })
  });
  const valid =
    Array.isArray(answer) &&
    answer.length >= choice.min &&
    answer.length <= choice.max &&
    answer.every(
      (ref, index) =>
        isRef(ref) &&
        choice.options.some((option) => sameRef(option, ref)) &&
        !answer.slice(0, index).some((previous) => isRef(previous) && sameRef(previous, ref))
    );
  if (!valid) throw new TypeError("Invalid effect.ready choice answer");
  return (answer as readonly ObjectRef[]).map((ref) => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

const effectReady = {
  op: "effect.ready",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectReadyArgs): InstructionResult {
    const rawSelection = args.objects === undefined ? undefined : evaluateArgument(ctx, args.objects);
    const selection =
      rawSelection === undefined ? ({ kind: "source" } as const) : parseSelection(rawSelection);
    // Validate the frozen event binding even for amount 0: a missing or forged
    // pronoun is unavailable input, not an empty optional selection.
    const eventRef = selection.kind === "event" ? resolveEventRef(ctx, selection) : undefined;
    const amount = assertAmount(args.amount === undefined ? undefined : evaluateArgument(ctx, args.amount));
    const linkKey = assertLinkKey(args.linkKey === undefined ? undefined : evaluateArgument(ctx, args.linkKey));
    const linkedValue = (refs: readonly ObjectRef[]): Value => ({
      count: refs.length,
      objects: refs.map(refValue)
    });

    // amount 0：不选择、不提交动作，但仍完整校验参数形状。
    if (amount === 0) {
      const value = linkedValue([]);
      ctx.link(linkKey, value);
      return { status: "executed", events: [], linkedValues: { [linkKey]: value } };
    }

    /** 目标 / pick / 派生引用在指令开始结算时全部失效 → ignored（359.3.e.6–e.9）。 */
    const currentRefs = (refs: readonly ObjectRef[]): ObjectRef[] | null => {
      const usable = distinctRefs(refs).filter((ref) => ctx.object(ref) !== null);
      return usable.length === 0 ? null : usable;
    };

    let candidates: ObjectRef[] = [];
    let choice: PendingChoice | null = null;
    switch (selection.kind) {
      case "source": {
        const usable = currentRefs([ctx.source.ref]);
        if (usable === null) return { status: "ignored", reason: "mistargeted" };
        candidates = usable;
        break;
      }
      case "target": {
        const usable = currentRefs(ctx.targets(selection.id));
        if (usable === null) return { status: "ignored", reason: "mistargeted" };
        candidates = usable;
        break;
      }
      case "pick": {
        const usable = currentRefs(ctx.picks(selection.id).filter(isRef));
        if (usable === null) return { status: "ignored", reason: "mistargeted" };
        candidates = usable;
        break;
      }
      case "refs": {
        const usable = currentRefs(selection.refs);
        if (usable === null) return { status: "ignored", reason: "mistargeted" };
        candidates = usable;
        break;
      }
      case "event": {
        // The frozen event identity is authoritative only while that exact
        // incarnation still exists. Never use lastKnown or the event snapshot
        // to resurrect a departed object.
        const usable = currentRefs([eventRef!]);
        if (usable === null) return { status: "ignored", reason: "mistargeted" };
        candidates = usable;
        break;
      }
      case "query": {
        candidates = sortedRefs(ctx.query(selection.filter).map((object) => object.ref));
        break;
      }
      case "choose": {
        const options = sortedRefs(ctx.query(selection.filter).map((object) => object.ref));
        const requestedMax = selection.max ?? 1;
        const requestedMin = selection.min ?? requestedMax;
        const max = Math.min(requestedMax, amount, options.length);
        // 359.3.e.11：能部分执行就尽可能执行；一个合法选择都没有才是 negated
        // impossible（359.3.e.6、355.10.f 的 must 型指令）。
        if (max === 0 && requestedMin > 0) {
          return { status: "negated", reason: "impossible", events: [] };
        }
        if (max === 0) {
          candidates = [];
          break;
        }
        choice = {
          id: selection.id,
          options,
          min: Math.min(requestedMin, max),
          max,
          ...(selection.prompt === undefined ? {} : { prompt: selection.prompt })
        };
        break;
      }
    }

    if (choice !== null) candidates = askSelection(ctx, choice);
    if (candidates.length > amount) candidates = candidates.slice(0, amount);

    const events: GameEvent[] = [];
    const readied: ObjectRef[] = [];
    let negated: "replaced" | "impossible" | null = null;
    for (const ref of candidates) {
      const snapshot = ctx.object(ref);
      // 前一条动作让该引用失效（例如替代效果移走了对象）：不再操作它。
      if (snapshot === null) continue;
      // 416.1.b/416.1.c：已就绪对象不能再次重置，什么也不发生。
      if (!snapshot.exhausted) continue;
      const outcome = ctx.perform({ type: "ready", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        negated ??= outcome.status === "replaced" ? "replaced" : "impossible";
      } else if (ctx.object(ref) !== null) {
        readied.push(ref);
      }
    }

    const value = linkedValue(readied);
    ctx.link(linkKey, value);
    if (negated !== null) return { status: "negated", reason: negated, events };
    return { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<EffectReadyArgs>;

export default effectReady;
