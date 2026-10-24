/**
 * effect.exhaust — 横置（Exhaust），作为效果执行。
 *
 * 规则依据（CR v1.5）：415（Exhaust）、415.1（横置把 Board 上的非法术 Game Object
 * 标记为 "spent"）、415.1.b（已横置的对象不能被再次横置）、415.1.c（对已横置对象下
 * 横置指令时不再发生任何额外事情）、415.2（Exhausted 是可被引用、可被条件读取的
 * 状态）、415.3/415.3.a（这是 Limited Action）、415.4/415.5（横置作为费用时必须能
 * 完成——那是 cost.exhaust 的边界）、055/055.1（能做多少做多少，全部无法执行时结算
 * 仍然发生）、359.3.e.5–e.8（目标在结算时失效：相关指令被忽略；部分目标失效时只对
 * 仍合法的目标执行）；107（The Board 包含 Bases、Battlefield Zone、Facedown Zones、
 * Legend Zone）；124/128（对象离区后旧引用失效，只能取最后已知信息）。
 *
 * 参数（argsSchema 在解释器求值前校验 IR 形状）：
 * - target?: string — TargetSpec id，或 CardProgram 使用的 `"source"` 对象指代。
 *   TargetSpec 集合经 ctx.targets(id) 读取（Finalize 锁定、Resolve 重验后仍合法的
 *   目标），用于 "Exhaust an enemy legend." 这类目标式文本（355.10.g）；
 *   `"source"` 精确绑定能力来源的当前 zone entry，不创建对象目标（355.10.c）。
 * - pick?: string — PickSpec id。非目标选择经 ctx.picks(id) 读取（v1.5 的 pick 不触发
 *   "成为目标"相关触发，契约 3.4）。
 * - choose?: { id, filter?, chooser?, visibility?, prompt? } — 非目标选择：先用
 *   ctx.query(filter)（filter 缺省 {}）取当前 Board 对象，再经 ctx.choose 以 type
 *   "select-objects" 请求选择。id 是稳定的重放请求 id；chooser 缺省为能力控制者；
 *   visibility 缺省 "public"。选项按 (id, zoneEntryId) 排序以保证确定性。当本次要
 *   横置的数量为 0，或恰好等于全部可用选项（选择已被唯一确定）时不提问。
 *   target / pick / choose 必须恰好给出一个。
 * - amount?: Expr — 本次最多横置多少个对象；结算时经 ctx.evaluate 求值（取值时机即
 *   调用时，契约 3.6），必须是非负安全整数，否则本指令 negated(impossible)。超过可用
 *   数时按 CR 055 横置尽可能多；0 表示 "up to N" 里选了 0 个（355.13）：不提交任何
 *   动作，但指令仍然 executed（实际横置数为 0）。缺省值：target / pick 为全部可用
 *   对象（目标系统已决定数量，如 "Exhaust all friendly units"）；choose 为 1（结算时
 *   由玩家选定的非目标选择默认是单数，如 355.10.g "Ready a legend" / "Exhaust an
 *   enemy legend"，此时作者必须给出 amount 才能表达复数选择）。
 * - linkKey?: Expr — 链接值键名，结算时求值，缺省 "exhausted"。求值结果不是非空字符串
 *   时本指令 negated(impossible)：链接键是作者侧的静态配置，不是可缺失的信息，
 *   与 effect.attach / effect.token 对非法键的处理一致。
 *
 * 语义边界（本原语不做的事）：
 * - 只做"作为效果执行"的横置（RIFT-9 语义边界）。作为费用/支付代价的横置属于
 *   cost.exhaust 与 finalized 费用计划 pay：[E] 激活费用（415.3.a、415.5）、标准移动
 *   的横置费用（144.2）、"as an additional cost ..., exhaust a friendly unit"
 *   （415.4，如 rad-029-167 Life from Stone、ogn-048-298 Meditation）、触发式能力里
 *   "[do X] to [do Y]" 内的代价式横置（355.10.c.1）都不是本原语。费用场景下横置
 *   失败会让能力无法成立/费用未支付，而本原语只表达结算时的状态改变。
 * - 入场即横置是入场状态规定，不是一次横置动作：143.4/143.4.a（单位横置入场）、
 *   184.1/185.2.d（token 入场状态，如 "play a Gold gear token exhausted"）、805.6
 *   （Accelerate 的入场替代，"It does not enter exhausted and then become ready"）。
 *   这些属于 create-token / replacement.enter；先创建再补横置不等价，会多产生一次
 *   "成为横置"事件并错过入场替代。
 * - "when it becomes exhausted" 之类触发与 "for each exhausted unit" 之类条件读取
 *   （415.2）由 trigger.state / condition.* 与图层负责；本原语只提交动作、写链接值。
 * - 目标合法性重验（如"已横置"作为目标条件时结算失效，359.3.e.4 的示例）属于
 *   target.query 与 Finalize/Resolve 的目标系统；本原语只做动作自身的状态检查。
 * - 逆动作 Ready（416.1–416.3）属于 effect.ready；本原语不提供 ready 参数。
 * - 不直接改 exhausted 状态、不推进优先权、不入链：唯一写路径是 perform({type:"exhaust"})。
 *
 * 结果（契约 3.3 / 3.6 原语规则 2）：
 * - target 集合为空，或其对象全部已离区/不在 Board（旧 zoneEntryId、移入非 Board 区域）
 *   → ignored(mistargeted)（359.3.e.2/e.5/e.6）。部分失效时只横置仍合法的目标
 *   （359.3.e.8）。
 * - amount 求值为 null（引用了不存在的链接值，或引用了位置/区域/状态已改变、信息不再
 *   可用的对象，如 "exhaust up to its Might" 而该单位已离场）→ ignored(linked-ignored)
 *   （359.3.e.12：这类检查返回 null，基于它的指令被职责为 Ignored）。
 * - pick / choose 没有可用的当前 Board 对象 → negated(impossible)（非目标选择没有
 *   "选错目标"语义，与 effect.attach / effect.token 一致）。
 * - 任一 perform 返回 replaced / prevented / impossible → negated（replaced 记
 *   replaced，prevented / impossible 记 impossible）；其余动作照常提交，实际结果仍
 *   写入链接值（CR 055）。
 * - 全部 done → executed。已横置的对象（415.1.b/c）不提交动作：横置对它们"不再发生
 *   任何额外事情"，所以既不算实际横置数，也不单独算错（与 effect.attach 对已附着
 *   对象的 no-effect execution 一致）。
 * - 链接值（executed 与 negated 都写入实际结果，供 "if you do" 与后续链接指令判断）：
 *   - <linkKey> = { count, objects, alreadyExhausted }
 *   - <linkKey>.count、<linkKey>.objects 与上面同值，便于链接表达式直接引用。
 *   count 只统计真正从 ready 变为 exhausted 的对象（415.1.b/c 情形下为 0），
 *   alreadyExhausted 记录选中的合法对象里已经横置的数量。
 *
 * 用到的 GameAction：仅 `exhaust`（契约 3.6 封闭集合，场上类别）。不新增动作。
 */
import type {
  ChoiceVisibility,
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectFilter,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Schema,
  Value,
  ZoneId
} from "../contract.js";

export interface EffectExhaustChoice {
  readonly id: string;
  readonly filter?: ObjectFilter;
  readonly chooser?: PlayerId;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
}

/** Args accepted before expression evaluation. */
export interface EffectExhaustArgs {
  readonly target?: string;
  readonly pick?: string;
  readonly choose?: EffectExhaustChoice;
  readonly amount?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | {
    readonly kind: "choose";
    readonly id: string;
    readonly filter: ObjectFilter;
    readonly chooser: PlayerId;
    readonly visibility: ChoiceVisibility;
    readonly prompt?: string;
  };

const ARGUMENTS = new Set(["target", "pick", "choose", "amount", "linkKey"]);
const CHOICE_ARGUMENTS = new Set(["id", "filter", "chooser", "visibility", "prompt"]);

/**
 * CR 107 把 Bases、Battlefield Zone、Facedown Zones 与 Legend Zone 归入 The Board，
 * 108 列出 Chain、Trash、Hand、Main Deck、Rune Deck、Banishment 等非 Board 区域。
 * 契约的 ZoneId 目前没有 legend-zone/champion-zone 成员（见回复里的契约变更请求），
 * 所以这里用"不属于已知非 Board 区域"来表达 415.1 的"Board 上"，将来契约补上
 * Legend Zone 时无需改动本原语。
 */
const NON_BOARD_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "chain"
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

function isIdString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isIdString(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": return isRef(value.object) && isIdString(value.property);
    case "object-attribute": return isRef(value.object) && isIdString(value.attribute);
    case "linked": case "linked-value":
      return isIdString(value.instructionId) && (value.key === undefined || isIdString(value.key));
    case "count":
      return isIdString(value.subject) && (value.filter === undefined ||
        isRecord(value.filter) && isValue(value.filter));
    default: return false;
  }
}

function isVisibility(value: unknown): value is ChoiceVisibility {
  return value === "public" || value === "chooser-only" ||
    Array.isArray(value) && value.length > 0 && value.every(isIdString);
}

function parseArgs(value: unknown): EffectExhaustArgs {
  if (!isRecord(value)) throw new TypeError("effect.exhaust args must be an object");
  const selectors = ["target", "pick", "choose"].filter(key => value[key] !== undefined);
  if (selectors.length !== 1) {
    throw new TypeError("effect.exhaust requires exactly one of target, pick, or choose");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid effect.exhaust argument: ${key}`);
    if (key === "target" || key === "pick") {
      if (!isIdString(entry)) throw new TypeError(`effect.exhaust ${key} must be a spec id string`);
      continue;
    }
    if (key === "amount" || key === "linkKey") {
      if (!isExpr(entry)) throw new TypeError(`effect.exhaust ${key} must be an Expr`);
      continue;
    }
    if (!isRecord(entry) || !isIdString(entry.id)) {
      throw new TypeError("effect.exhaust choose requires a stable non-empty choice id");
    }
    for (const [name, choiceValue] of Object.entries(entry)) {
      if (!CHOICE_ARGUMENTS.has(name)) throw new TypeError(`Invalid effect.exhaust choose argument: ${name}`);
      if (name === "filter" && !(isRecord(choiceValue) && isValue(choiceValue))) {
        throw new TypeError("effect.exhaust choose filter must be an object filter");
      }
      if (name === "chooser" && !isIdString(choiceValue)) {
        throw new TypeError("effect.exhaust choose chooser must be a player id");
      }
      if (name === "visibility" && !isVisibility(choiceValue)) {
        throw new TypeError("effect.exhaust choose visibility is invalid");
      }
      if (name === "prompt" && !isIdString(choiceValue)) {
        throw new TypeError("effect.exhaust choose prompt must be a non-empty string");
      }
    }
  }
  return value as unknown as EffectExhaustArgs;
}

const argsSchema: Schema<EffectExhaustArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

function sameRef(left: ObjectRef | null, right: ObjectRef): boolean {
  return left?.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

/** CR 415.1：只有 Board 上的非法术 Game Object 能被横置。 */
function isExhaustible(ctx: ResolveContext, ref: ObjectRef): boolean {
  const snapshot = ctx.object(ref);
  return snapshot !== null && !NON_BOARD_ZONES.has(snapshot.zone) &&
    !snapshot.types.includes("spell");
}

function toSelection(ctx: ResolveContext, args: EffectExhaustArgs): Selection {
  // `source` is an ObjectSelector in CardProgram IR, not a TargetSpec id. A
  // bare TargetSpec id remains supported for authored targeted abilities.
  if (args.target === "source") return { kind: "source" };
  if (args.target !== undefined) return { kind: "target", id: args.target };
  if (args.pick !== undefined) return { kind: "pick", id: args.pick };
  const choice = args.choose!;
  return {
    kind: "choose",
    id: choice.id,
    filter: choice.filter ?? {},
    chooser: choice.chooser ?? ctx.controller,
    visibility: choice.visibility ?? "public",
    ...(choice.prompt === undefined ? {} : { prompt: choice.prompt })
  };
}

function selectionRefs(ctx: ResolveContext, selection: Selection): readonly ObjectRef[] {
  if (selection.kind === "source") return [ctx.source.ref];
  if (selection.kind === "target") return ctx.targets(selection.id);
  if (selection.kind === "pick") return ctx.picks(selection.id).filter(isRef);
  const refs = ctx.query(selection.filter).map(object => object.ref);
  // 选择选项的顺序必须确定，不依赖 Map/query 的枚举顺序。
  return [...refs].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 :
    left.zoneEntryId - right.zoneEntryId);
}

function distinct(refs: readonly ObjectRef[]): ObjectRef[] {
  const unique: ObjectRef[] = [];
  for (const ref of refs) {
    if (unique.some(seen => sameRef(seen, ref))) continue;
    unique.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  }
  return unique;
}

function evaluateAmount(value: Value | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError("effect.exhaust amount must evaluate to a non-negative integer");
  }
  return value;
}

function isAnswer(value: unknown, options: readonly ObjectRef[], wanted: number): value is ObjectRef[] {
  return Array.isArray(value) && value.length === wanted && value.every(isRef) &&
    value.every((ref, index) => options.some(option => sameRef(option, ref)) &&
      value.slice(0, index).every(previous => !sameRef(previous, ref)));
}

const effectExhaust = {
  op: "effect.exhaust",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectExhaustArgs): InstructionResult {
    const events: GameEvent[] = [];
    const exhausted: Value[] = [];
    let count = 0;

    const linkKey = args.linkKey === undefined ? "exhausted" : ctx.evaluate(args.linkKey);
    if (!isIdString(linkKey)) return { status: "negated", reason: "impossible", events: [] };
    const linkReceipt = (alreadyExhausted: number): Record<string, Value> => {
      const receipt: Value = { count, objects: exhausted, alreadyExhausted };
      return {
        [linkKey]: receipt,
        [`${linkKey}.count`]: count,
        [`${linkKey}.objects`]: exhausted
      };
    };
    const writeLinks = (alreadyExhausted: number): Record<string, Value> => {
      const values = linkReceipt(alreadyExhausted);
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    // NegatedInstructionResult 没有 linkedValues 字段（契约 3.3），但实际结果仍要写进
    // ctx.link："if you do" 与后续链接指令要按 CR 055 看到已经发生的那部分结果。
    const negate = (reason: "replaced" | "impossible", alreadyExhausted = 0): InstructionResult => {
      writeLinks(alreadyExhausted);
      return { status: "negated", reason, events: [...events] };
    };

    const selection = toSelection(ctx, args);
    const selected = distinct(selectionRefs(ctx, selection));
    const exhaustible = selected.filter(ref => isExhaustible(ctx, ref));
    if (exhaustible.length === 0) {
      // 359.3.e.2/e.5/e.6：目标全部失效（离区/旧 zoneEntryId/不在 Board）→ ignored；
      // 非目标选择没有"选错目标"语义，按 359.3.e.6 记 negated。
      if (selection.kind === "target") return { status: "ignored", reason: "mistargeted" };
      return negate("impossible");
    }
    // 415.1.b/415.1.c：已横置的对象不能被再次横置，也不会产生任何额外事情。
    const eligible = exhaustible.filter(ref => ctx.object(ref)?.exhausted === false);
    const alreadyExhausted = exhaustible.length - eligible.length;

    let evaluated: Value | undefined;
    try {
      evaluated = args.amount === undefined ? undefined : ctx.evaluate(args.amount);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negate("impossible", alreadyExhausted);
      }
      throw error;
    }
    // 359.3.e.12：引用位置/区域/状态已改变、信息不再可用的对象时该检查为 null，
    // 基于它的指令被忽略（linked-ignored），而不是当成 0 或报 impossible。
    if (evaluated === null) return { status: "ignored", reason: "linked-ignored" };

    let wanted: number;
    try {
      wanted = Math.min(evaluateAmount(
        evaluated,
        selection.kind === "choose" ? 1 : eligible.length
      ), eligible.length);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negate("impossible", alreadyExhausted);
      }
      throw error;
    }

    let chosen: ObjectRef[];
    if (selection.kind === "choose" && wanted > 0 && wanted < eligible.length) {
      const answer = ctx.choose<readonly ObjectRef[]>({
        id: selection.id,
        type: "select-objects",
        options: eligible,
        min: wanted,
        max: wanted,
        chooser: selection.chooser,
        visibility: selection.visibility,
        ...(selection.prompt === undefined ? {} : { prompt: selection.prompt })
      });
      if (!isAnswer(answer, eligible, wanted)) return negate("impossible", alreadyExhausted);
      chosen = answer.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
    } else {
      chosen = eligible.slice(0, wanted);
    }

    let reason: "replaced" | "impossible" | null = null;
    for (const ref of chosen) {
      const outcome = ctx.perform({ type: "exhaust", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        reason ??= outcome.status === "replaced" ? "replaced" : "impossible";
        continue;
      }
      if (ctx.object(ref)?.exhausted === true) {
        count += 1;
        exhausted.push(refValue(ref));
      }
    }
    if (reason !== null) return negate(reason, alreadyExhausted);

    const values = writeLinks(alreadyExhausted);
    return { status: "executed", events: [...events], linkedValues: values };
  }
} satisfies InstructionDef<EffectExhaustArgs>;

export default effectExhaust;
