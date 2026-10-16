/**
 * effect.stun — 施加 Stunned 状态（Stun），作为效果执行。
 *
 * 规则依据（CR v1.5）：424（Stun）；424.1（Stunning 是选择 Board 上一个或多个 Unit 并
 * 把它们渲染为 Stunned 的动作）；424.1.a（Stunned 是二元状态）；424.1.a.1（已 Stunned
 * 的 Unit 不能被再次 Stunned；选择已 Stunned 的单位仍然合法，只是不会发生任何事）；
 * 424.1.a.2（Stunned 在回合结束清理的 3d 步骤失去，见 continuous.duration）；424.1.b
 * （Stunned 单位在战斗伤害步骤不贡献 Might，见 continuous.combat 与 467）；424.1.c
 * （Stunned 单位仍必须被分配至少等于其完整 Might 的伤害才会被消灭）；424.2 / 424.2.a
 * （Limited Action：只有游戏效果指示时才能 Stun）；107（The Board）；108（Non-Board
 * Zones）；124 / 124.1 / 124.2（状态只属于当次入区的对象，换区后旧引用失效）；
 * 055 / 055.1（能做多少做多少）；355.5 / 355.5.a（"Stun a unit at a battlefield" 是
 * 结算前的 Choice，"Kill all gear" 这类按条件过滤的不是 Choice）；
 * 355.13（"up to" 允许选择 0 个）；359.3.e.5–e.9（目标在结算时失效与 Mistargeting）；
 * 359.3.e.11（可部分执行时尽可能执行）；359.3.e.12（引用不再可用的信息时该检查返回
 * null，基于它的指令被 Ignored）；412.4 / 412.5（"when you stun" 的责任与归因）；
 * 719.4 / 719.4.a（顶层卡被 Stun 不影响附着卡的状态）。
 *
 * 参数（argsSchema 在解释器求值前校验 IR 形状）：
 * - target?: string — TargetSpec id。目标集合经 ctx.targets(id) 读取（Finalize 锁定、
 *   Resolve 重验后仍合法的目标），用于 "Stun an enemy unit at a battlefield." 这类
 *   目标式文本（355.5 / 355.5.a、355.10.g；如 ven-120-166 Masa, Crashing Thunder、
 *   rad-121-167 One-Two Punch、ogn-220-298 Facebreaker、ogn-262-298 Zenith Blade）。
 * - pick?: string — PickSpec id。非目标选择经 ctx.picks(id) 读取（v1.5 的 pick 不触发
 *   "成为目标"相关触发，契约 3.4）。
 * - choose?: { id, filter?, chooser?, visibility?, prompt? } — 非目标选择：先用
 *   ctx.query(filter)（filter 缺省 {}）取当前对象，再经 ctx.choose 以 type
 *   "select-objects" 请求选择。id 是稳定的重放请求 id；chooser 缺省为能力控制者；
 *   visibility 缺省 "public"。选项按 (id, zoneEntryId) 排序以保证确定性。当本次要
 *   Stun 的数量为 0，或恰好等于全部可用选项（选择已被唯一确定）时不提问。
 *   target / pick / choose 必须恰好给出一个。
 * - amount?: Expr — 本次最多 Stun 多少个对象；结算时经 ctx.evaluate 求值（取值时机即
 *   调用时，契约 3.6），必须是非负安全整数，否则本指令 negated(impossible)。超过可用
 *   数时按 CR 055 / 359.3.e.11 尽可能多；0 表示 "up to N" 里选了 0 个（355.13）：不提交
 *   任何动作，但指令仍然 executed（实际 Stun 数为 0）。已 Stunned 的对象（424.1.a.1）
 *   不占用该额度，也不作为 choose 选项：额度只落在仍可被 Stun 的对象上。缺省值：
 *   target / pick 为全部合法对象（目标系统已决定数量，如 "Stun all enemy units."）；
 *   choose 为 1（结算时由玩家选定的非目标选择默认是单数，如 "[Stun] a unit." 的
 *   choose 形式）。
 * - linkKey?: Expr — 链接值键名，结算时求值，缺省 "stunned"。求值结果不是非空字符串时
 *   本指令 negated(impossible)：链接键是作者侧的静态配置，不是可缺失的信息，与
 *   effect.exhaust / effect.attach 对非法键的处理一致。
 *
 * 语义边界（本原语不做的事）：
 * - 只做"作为效果执行"的 Stun（RIFT-9 语义边界）。Stunned 状态的持续期与清除
 *   （424.1.a.2 的回合结束 3d 清理）属于 continuous.duration 与时点/清理流程；"Stunned
 *   单位不贡献战斗伤害"（424.1.b）与"仍需致命伤害才会被消灭"（424.1.c）分别由
 *   continuous.combat、effect.damage 与杀伤清理表达；本原语只提交一次状态改变动作。
 * - "When you stun an enemy unit ..." 之类触发（412.4 的责任、412.5 的归因）由
 *   trigger.state 订阅 unit-stunned 时点处理，本原语只写链接值供后续链接指令读取。
 * - 与 effect.exhaust / effect.ready 的区别：Stunned 与 Exhausted 是两个独立状态
 *   （124.2）。Stun 一个单位不会横置它，反之亦然（415 与 424 是两条不同的动作），
 *   本原语也不提供 exhausted 参数。
 * - 与替代效果的边界：unl-134-219 Existential Dread 的 "If it's already stunned,
 * return it to its owner's hand instead." 是条件分支，应写成 condition（读 alreadyStunned /
 * count）加 effect.zone / replacement 的组合，由调用方装配；本原语只如实上报自己这次
 * 动作的结果（已 Stunned 的对象按 424.1.a.1 不再发生任何事，不提交动作）。
 * - 附着关系：719.4 / 719.4.a 规定顶层卡的 Exhausted/Ready 等状态不影响附着卡，
 *   本原语因此只对选中的对象本身提交动作。
 * - 入场即 Stunned 之类状态规定必须由 create-token / replacement.enter 表达；先创建
 *   再补一次 Stun 不等价，会多产生一次 "成为 Stunned" 事件并错过入场替代。
 * - 不直接改 state、不推进优先权、不往链上加项：唯一写路径是 perform({type: "stun"})。
 *
 * 结果（契约 3.3 / 3.6 原语规则 2；v1.5 055、359.3.e.5–e.12）：
 * - target 集合为空，或其对象全部已离区（旧 zoneEntryId）或不再是 Board 上的 Unit
 *   （424.1）→ ignored(mistargeted)（359.3.e.2/e.5/e.6/e.7）。部分失效时只对仍合法的
 *   目标执行（359.3.e.8）。非目标选择（pick / choose）没有"选错目标"语义，同样的空集
 *   情况记 negated(impossible)。
 * - amount 求值为 null（引用了不存在的链接值，或引用了位置/区域/状态已改变、信息不再
 *   可用的对象）→ ignored(linked-ignored)（359.3.e.12：这类检查返回 null，基于它的
 *   指令被忽略（Ignored），而不是当成 0）。
 * - 任一 perform 返回 replaced / prevented / impossible → negated（replaced 记
 *   replaced，prevented / impossible 记 impossible）；其余动作照常提交，实际结果仍写入
 *   链接值（CR 055）。
 * - 全部 done → executed。已 Stunned 的对象（424.1.a.1）不提交动作：对它们"不再发生任何
 *   额外事情"，所以既不算实际 Stun 数，也不单独算错（与 effect.exhaust 对已横置对象的
 *   no-effect execution 一致），数量记入 alreadyStunned（目标 / pick 路径；choose 路径
 *   不会把它们放进选项，但被选对象在提问与重放之间被 Stun 时仍会计入）。
 * - 链接值（executed 与 negated 都写入实际结果，供 "if you do" 与后续链接指令判断）：
 *   - <linkKey> = { count, objects, alreadyStunned }
 *   - <linkKey>.count、<linkKey>.objects 与上面同值，便于链接表达式直接引用。
 *   count 只统计真正从非 Stunned 变为 Stunned 的对象；alreadyStunned 记录本次结算中被
 *   实际选中且结算时已经处于 Stunned 的数量。
 * - 确定性：只经 ResolveContext 读取，不读时间、不用随机；集合查询与选择选项按
 *   id/zoneEntryId 排序，target 按 Finalize 锁定顺序，保证同等输入下结果一致。
 *
 * 用到的 GameAction：仅 stun（契约 3.6 封闭集合，场上类别）。不新增动作，也不修改契约。
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

/** 结算时才发起的非目标选择（choose 参数）。 */
export interface EffectStunChoice {
  readonly id: string;
  readonly filter?: ObjectFilter;
  readonly chooser?: PlayerId;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
}

/** effect.stun 的参数；见文件头 JSDoc。 */
export interface EffectStunArgs {
  readonly target?: string;
  readonly pick?: string;
  readonly choose?: EffectStunChoice;
  readonly amount?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
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

const ARGUMENTS: ReadonlySet<string> = new Set(["target", "pick", "choose", "amount", "linkKey"]);
const CHOICE_ARGUMENTS: ReadonlySet<string> = new Set(["id", "filter", "chooser", "visibility", "prompt"]);

/**
 * CR 108 列出 Chain、Trash、Hand、Main Deck、Rune Deck、Banishment 等非 Board 区域。
 * 契约的 ZoneId 目前没有 legend-zone / facedown-zone 成员（与 effect.exhaust 同样的
 * 缺口，见最终回复），所以这里用"不属于已知非 Board 区域"来表达 424.1 的"Board 上"，
 * 将来契约补上这些成员时无需改动本原语的判断方向。
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

function parseArgs(value: unknown): EffectStunArgs {
  if (!isRecord(value)) throw new TypeError("effect.stun args must be an object");
  const selectors = ["target", "pick", "choose"].filter(key => value[key] !== undefined);
  if (selectors.length !== 1) {
    throw new TypeError("effect.stun requires exactly one of target, pick, or choose");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError("Invalid effect.stun argument: " + key);
    if (key === "target" || key === "pick") {
      if (!isIdString(entry)) throw new TypeError("effect.stun " + key + " must be a spec id string");
      continue;
    }
    if (key === "amount" || key === "linkKey") {
      if (!isExpr(entry)) throw new TypeError("effect.stun " + key + " must be an Expr");
      continue;
    }
    if (!isRecord(entry) || !isIdString(entry.id)) {
      throw new TypeError("effect.stun choose requires a stable non-empty choice id");
    }
    for (const [name, choiceValue] of Object.entries(entry)) {
      if (!CHOICE_ARGUMENTS.has(name)) throw new TypeError("Invalid effect.stun choose argument: " + name);
      if (name === "filter" && !(isRecord(choiceValue) && isValue(choiceValue))) {
        throw new TypeError("effect.stun choose filter must be an object filter");
      }
      if (name === "chooser" && !isIdString(choiceValue)) {
        throw new TypeError("effect.stun choose chooser must be a player id");
      }
      if (name === "visibility" && !isVisibility(choiceValue)) {
        throw new TypeError("effect.stun choose visibility is invalid");
      }
      if (name === "prompt" && !isIdString(choiceValue)) {
        throw new TypeError("effect.stun choose prompt must be a non-empty string");
      }
    }
  }
  return value as unknown as EffectStunArgs;
}

const argsSchema: Schema<EffectStunArgs> = {
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

/** CR 424.1：只有 Board 上的 Unit 能被 Stun。 */
function isStunnable(ctx: ResolveContext, ref: ObjectRef): boolean {
  const snapshot = ctx.object(ref);
  return snapshot !== null && !NON_BOARD_ZONES.has(snapshot.zone) &&
    snapshot.types.includes("unit");
}

function toSelection(ctx: ResolveContext, args: EffectStunArgs): Selection {
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
    throw new RangeError("effect.stun amount must evaluate to a non-negative integer");
  }
  return value;
}

function isAnswer(value: unknown, options: readonly ObjectRef[], wanted: number): value is ObjectRef[] {
  return Array.isArray(value) && value.length === wanted && value.every(isRef) &&
    value.every((ref, index) => options.some(option => sameRef(option, ref)) &&
      value.slice(0, index).every(previous => !sameRef(previous, ref)));
}

export default {
  op: "effect.stun",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectStunArgs): InstructionResult {
    const events: GameEvent[] = [];
    const stunned: Value[] = [];
    let count = 0;

    const linkKey = args.linkKey === undefined ? "stunned" : ctx.evaluate(args.linkKey);
    if (!isIdString(linkKey)) return { status: "negated", reason: "impossible", events: [] };
    const linkReceipt = (alreadyStunned: number): Record<string, Value> => {
      const receipt: Value = { count, objects: stunned, alreadyStunned };
      return {
        [linkKey]: receipt,
        [linkKey + ".count"]: count,
        [linkKey + ".objects"]: stunned
      };
    };
    const writeLinks = (alreadyStunned: number): Record<string, Value> => {
      const values = linkReceipt(alreadyStunned);
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    // NegatedInstructionResult 没有 linkedValues 字段（契约 3.3），但实际结果仍要写进
    // ctx.link："if you do" 与后续链接指令要按 CR 055 / 359.3.e.11 看到已经发生的部分。
    const negate = (reason: "replaced" | "impossible", alreadyStunned = 0): InstructionResult => {
      writeLinks(alreadyStunned);
      return { status: "negated", reason, events: [...events] };
    };

    const selection = toSelection(ctx, args);
    const selected = distinct(selectionRefs(ctx, selection));
    const candidates = selected.filter(ref => isStunnable(ctx, ref));
    if (candidates.length === 0) {
      // 359.3.e.2/e.5/e.6/e.7：目标全部失效（离区/旧 zoneEntryId/不再匹配）→ ignored；
      // 非目标选择没有"选错目标"语义，同样的空集记 negated(impossible)。
      if (selection.kind === "target") return { status: "ignored", reason: "mistargeted" };
      return negate("impossible");
    }
    // 424.1.a.1：已 Stunned 的 Unit 不能再被 Stunned。选择它们仍然合法，但它们"不再发生
    // 任何额外事情"，因此不占用 amount 的额度（055 / 359.3.e.11：能做多少做多少）。
    const eligible = candidates.filter(ref => ctx.object(ref)?.stunned === false);
    const alreadyStunned = candidates.length - eligible.length;

    let evaluated: Value | undefined;
    try {
      evaluated = args.amount === undefined ? undefined : ctx.evaluate(args.amount);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negate("impossible", alreadyStunned);
      }
      throw error;
    }
    // 359.3.e.12：引用位置/区域/状态已改变、信息不再可用的对象时该检查返回 null，
    // 基于它的指令被忽略（linked-ignored），而不是当成 0。
    if (evaluated === null) return { status: "ignored", reason: "linked-ignored" };

    let wanted: number;
    try {
      wanted = Math.min(
        evaluateAmount(evaluated, selection.kind === "choose" ? 1 : eligible.length),
        eligible.length
      );
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negate("impossible", alreadyStunned);
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
      if (!isAnswer(answer, eligible, wanted)) return negate("impossible", alreadyStunned);
      chosen = answer.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
    } else {
      chosen = eligible.slice(0, wanted);
    }

    let reason: "replaced" | "impossible" | null = null;
    for (const ref of chosen) {
      // 选择之后该引用可能已经失效（124：换区即成为新对象）：不再操作它。
      const snapshot = ctx.object(ref);
      if (snapshot === null) continue;
      const outcome = ctx.perform({ type: "stun", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        reason ??= outcome.status === "replaced" ? "replaced" : "impossible";
        continue;
      }
      if (ctx.object(ref)?.stunned === true) {
        count += 1;
        stunned.push(refValue(ref));
      }
    }
    if (reason !== null) return negate(reason, alreadyStunned);

    const values = writeLinks(alreadyStunned);
    return { status: "executed", events: [...events], linkedValues: values };
  }
} satisfies InstructionDef<EffectStunArgs>;
