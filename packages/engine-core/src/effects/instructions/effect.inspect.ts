import type { Expr, ObjectRef, Value } from "@riftbound/card-dsl";
import type {
  ActionOutcome,
  InstructionDef,
  InstructionResult,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Schema,
  ZoneId
} from "../contract.js";

/**
 * effect.inspect —— 查看 / 搜索卡库（Look at / Search，RIFT-9 原语清单第 57 项）。
 *
 * 语义（对应核心规则 v1.5 条目）：
 * - 128.3 / 128.4：牌库与对手手牌中的牌对查看者是 Secret / Private，因此本原语产生的
 *   "look" 动作与所有 choose 请求都只对该玩家可见（chooser-only），对手与观战者不得看到
 *   牌面；这正是"私有选项"边界的来源。
 * - 432.1.c：指示查看的张数超过牌库剩余张数时，尽可能多地查看，不触发 Burn Out；
 *   查看期间牌仍视为处于原区域（Reminder，牌不被移出牌库，旧 ObjectRef 全程有效）。
 * - 423.4：范围（top N / 整个区域 / pick 指定集合）确定后，由执行该动作的玩家在范围内
 *   选择具体牌；范围之外的牌本原语看不到，也不会被 choose 的选项暴露。
 * - 选择与重放：结算中需要玩家决定时通过 ctx.choose() 挂起（AwaitChoice），引擎回滚
 *   本指令事务并提问；带着答案重跑时必须得到相同结果（契约 3.6 原语规则 1：确定性）。
 *
 * 与相近原语的边界：
 * - 本原语只负责"看"（信息获取）与"在范围内选择"，任何区域移动都由后续指令完成：
 *   抽走用 effect.draw，回收用 effect.recycle，放回并排序用 effect.order / choice.order，
 *   展示给其他玩家用 effect.reveal。本原语自身不移动任何牌。
 * - picks（v1.5 pick）与 targets 不同：通过 args.picksSpecId 读取的牌不是"目标"，
 *   不触发"成为目标"相关触发（契约 3.4）；args.targetSpecId 读取的才是目标。
 * - "失败查询"边界：牌库为空 / 范围内无牌不是错误——按 432.1.c 看 0 张并返回 executed
 *   （linkedCount 为 0）；只有 GameAction 被替代 / 阻止 / 不可能（如目标玩家不存在）
 *   才 negated；目标引用全部失效（对象已离区）才 ignored。
 *
 * 结果链接值（供 "if you do" 等后续指令经 ctx.linked() 读取）：
 * - linkedKey（默认 "inspected"）：实际查看的牌数（number）。
 * - pickedKey（默认 "inspected-picked"）：实际查看的牌的 ObjectRef 列表；若本指令包含
 *   选择步骤，则被选中牌的引用另写入 linkedPickKey（默认 "inspected-pick"）。查看期间牌
 *   不离区（432.1.c Reminder），引用在后续指令移动它们之后才失效。
 *
 * 失败查询的已知缺口（契约变更请求，见任务回复）：封闭 GameAction 集合中没有"枚举牌库
 * 前 N 张"的动作；将 ObjectRef[] 作为 look 的 result 返回需要契约团队裁决，目前 result
 * 仅携带实际张数，集合经 QueryablePool 解析（真实内核的缺口见该接口注释）。
 */

/** 查看范围：top（牌库顶 N 张）/ zone（整个区域）/ picks（v1.5 pick 指定的集合）。 */
export type InspectScope = "top" | "zone" | "picks";

export interface InspectArgs {
  /** 执行查看的玩家；Expr 求值结果必须是 PlayerId（字符串）。 */
  readonly player: Expr;
  /**
   * 被查看的区域。Expr 求值结果为 ZoneId（默认 "deck"）或
   * { owner: PlayerId, zone: ZoneId } —— 搜索对手区域（如 "search their hand"）时使用后者；
   * 隐私边界（128.3/128.4）由内核的 look 动作负责落实。
   */
  readonly zone?: Expr;
  /** 范围，Expr 求值结果为 InspectScope；缺省：给出 amount 为 "top"，否则为 "zone"。 */
  readonly scope?: Expr;
  /** 查看张数（scope "top" 时使用）；Expr 求值为非负整数，超出牌库按 432.1.c 尽可能查看。 */
  readonly amount?: Expr;
  /** TargetSpec id：把目标当作查看集合（"look at target's hand"一类）；经 ctx.targets() 取。 */
  readonly targetSpecId?: Expr;
  /** PickSpec id：把 v1.5 pick 的结果当作查看集合；非目标，不触发目标相关触发。 */
  readonly picksSpecId?: Expr;
  /** 查看后是否要求玩家从中选择；Expr 求值为 boolean（默认 false：纯查看不提问）。 */
  readonly choose?: Expr;
  /** 选择范围；Expr 求值为 { min, max }（默认 { min: 0, max: 全部 }）。 */
  readonly chooseCount?: Expr;
  /** 写回 ctx.link 的张数链接键（默认 "inspected"）。 */
  readonly linkedKey?: Expr;
  /** 写回 ctx.link 的已查看牌链接键（默认 "inspected-picked"）。 */
  readonly pickedKey?: Expr;
  /** 有选择步骤时写回 ctx.link 的选中牌链接键（默认 "inspected-pick"）。 */
  readonly choosePicksKey?: Expr;
}

export interface ResolvedInspectArgs {
  readonly player: PlayerId;
  readonly pool: { readonly owner: PlayerId; readonly zone: ZoneId };
  readonly scope: InspectScope;
  readonly amount: number | null;
  readonly targetSpecId: string | null;
  readonly picksSpecId: string | null;
  readonly choose: boolean;
  readonly chooseMin: number;
  readonly chooseMax: number | null;
  readonly linkedKey: string;
  readonly pickedKey: string;
  readonly choosePicksKey: string;
}

const DEFAULT_LINKED_KEY = "inspected";
const DEFAULT_PICKED_KEY = "inspected-picked";
const DEFAULT_CHOOSE_PICKS_KEY = "inspected-pick";
const INSPECT_ZONES: readonly ZoneId[] = ["hand", "deck", "rune-deck", "trash", "banishment"];
const INSPECT_SCOPES: readonly InspectScope[] = ["top", "zone", "picks"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: Value | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value: Value | undefined): number | null {
  const num = asNumber(value);
  return num === null ? null : Math.max(0, Math.trunc(num));
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && typeof value.zoneEntryId === "number";
}

/**
 * 契约 3.6 的 ctx.query() 不保证返回顺序，也没有"牌库顶 N 张"的读取面；区域内顺序
 * 敏感的查询（top N / 牌库顶）依赖内核额外实现本接口：objects 按区域顺序（牌库顶在
 * 前）枚举全部对象，或 queryZoneTop(owner, zone, n) 直接返回前 N 张。参考测试内核
 * （RIFT-46）两者都未实现；缺失时 scope "top" 退化为整个区域——张数语义（432.1.c 的
 * as-many-as-possible）与隐私边界不受影响，仅"只看到前 N 张"的范围收窄不可表达。
 * 属契约变更请求事项（见任务回复）。
 */
export interface QueryablePool {
  readonly objects?: readonly ObjectSnapshot[];
  queryZoneTop?(owner: PlayerId, zone: ZoneId, amount: number): ObjectSnapshot[];
}
function resolvePoolCandidates(ctx: ResolveContext, args: ResolvedInspectArgs): ObjectRef[] {
  if (args.scope === "picks" && args.picksSpecId !== null) {
    return ctx.picks(args.picksSpecId).filter(isObjectRef);
  }
  if (args.targetSpecId !== null) {
    return ctx.targets(args.targetSpecId);
  }
  const pool = ctx.query({ owner: args.pool.owner, zone: args.pool.zone });
  if (args.scope !== "top") {
    return pool.map(object => object.ref);
  }
  const queryable = ctx as ResolveContext & QueryablePool;
  const topAmount = args.amount ?? 0;
  if (typeof queryable.queryZoneTop === "function") {
    return queryable.queryZoneTop(args.pool.owner, args.pool.zone, topAmount).map(object => object.ref);
  }
  if (Array.isArray(queryable.objects)) {
    const ordered = queryable.objects.filter(
      object => object.owner === args.pool.owner && object.zone === args.pool.zone
    );
    return ordered.slice(0, args.amount ?? ordered.length).map(object => object.ref);
  }
  // 读取面缺失时的退化：整池（见 QueryablePool 注释）。
  return pool.map(object => object.ref);
}

function resolveZone(
  value: Value | undefined,
  viewer: PlayerId
): { readonly owner: PlayerId; readonly zone: ZoneId } {
  if (typeof value === "string" && (INSPECT_ZONES as readonly string[]).includes(value)) {
    return { owner: viewer, zone: value as ZoneId };
  }
  if (isRecord(value)) {
    const owner = value.owner;
    const zone = value.zone;
    if (
      typeof owner === "string" &&
      typeof zone === "string" &&
      (INSPECT_ZONES as readonly string[]).includes(zone)
    ) {
      return { owner, zone: zone as ZoneId };
    }
  }
  return { owner: viewer, zone: "deck" };
}

function resolveArgs(ctx: ResolveContext, args: InspectArgs): ResolvedInspectArgs {
  const playerValue = ctx.evaluate(args.player);
  if (typeof playerValue !== "string" || playerValue.length === 0) {
    throw new TypeError("effect.inspect: args.player must evaluate to a PlayerId string");
  }
  const player = playerValue;
  const scopeValue = args.scope === undefined ? undefined : ctx.evaluate(args.scope);
  const amount = args.amount === undefined ? null : asCount(ctx.evaluate(args.amount));
  const scope: InspectScope =
    typeof scopeValue === "string" && (INSPECT_SCOPES as readonly string[]).includes(scopeValue)
      ? (scopeValue as InspectScope)
      : amount !== null
        ? "top"
        : "zone";
  const chooseValue = args.choose === undefined ? undefined : ctx.evaluate(args.choose);
  const chooseCountValue = args.chooseCount === undefined ? undefined : ctx.evaluate(args.chooseCount);
  const chooseMin =
    isRecord(chooseCountValue) && typeof chooseCountValue.min === "number"
      ? Math.max(0, Math.trunc(chooseCountValue.min))
      : 0;
  const chooseMaxRaw =
    isRecord(chooseCountValue) && typeof chooseCountValue.max === "number"
      ? Math.max(0, Math.trunc(chooseCountValue.max))
      : null;
  const linkedKeyValue = args.linkedKey === undefined ? undefined : ctx.evaluate(args.linkedKey);
  const pickedKeyValue = args.pickedKey === undefined ? undefined : ctx.evaluate(args.pickedKey);
  const choosePicksKeyValue = args.choosePicksKey === undefined ? undefined : ctx.evaluate(args.choosePicksKey);
  const targetSpecValue = args.targetSpecId === undefined ? undefined : ctx.evaluate(args.targetSpecId);
  const picksSpecValue = args.picksSpecId === undefined ? undefined : ctx.evaluate(args.picksSpecId);
  return {
    player,
    pool: resolveZone(args.zone === undefined ? undefined : ctx.evaluate(args.zone), player),
    scope,
    amount,
    targetSpecId: typeof targetSpecValue === "string" ? targetSpecValue : null,
    picksSpecId: typeof picksSpecValue === "string" ? picksSpecValue : null,
    choose: chooseValue === undefined ? false : Boolean(chooseValue),
    chooseMin,
    chooseMax: chooseMaxRaw !== null && chooseMaxRaw >= chooseMin ? chooseMaxRaw : null,
    linkedKey: typeof linkedKeyValue === "string" && linkedKeyValue.length > 0 ? linkedKeyValue : DEFAULT_LINKED_KEY,
    pickedKey: typeof pickedKeyValue === "string" && pickedKeyValue.length > 0 ? pickedKeyValue : DEFAULT_PICKED_KEY,
    choosePicksKey:
      typeof choosePicksKeyValue === "string" && choosePicksKeyValue.length > 0
        ? choosePicksKeyValue
        : DEFAULT_CHOOSE_PICKS_KEY
  };
}

function negated(outcome: ActionOutcome & { readonly status: "replaced" | "prevented" | "impossible" }): InstructionResult {
  return {
    status: "negated",
    reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
    events: [...outcome.events]
  };
}

const argsSchema: Schema<InspectArgs> = {
  parse(value: unknown): InspectArgs {
    if (!isRecord(value)) {
      throw new TypeError("effect.inspect: args must be an object");
    }
    if (!isRecord(value.player)) {
      throw new TypeError("effect.inspect: args.player must be an Expr");
    }
    return value as unknown as InspectArgs;
  },
  safeParse(value: unknown) {
    try {
      return { success: true as const, data: argsSchema.parse(value) };
    } catch (error) {
      return { success: false as const, error };
    }
  }
};

export default {
  op: "effect.inspect",
  argsSchema,
  execute(ctx: ResolveContext, rawArgs: InspectArgs): InstructionResult {
    const args = resolveArgs(ctx, rawArgs);

    // 目标全部失效（对象已离区，旧 zoneEntryId）→ ignored；后续链接指令同样 ignored。
    if (args.targetSpecId !== null) {
      const targets = ctx.targets(args.targetSpecId);
      if (targets.every(ref => ctx.object(ref) === null)) {
        return { status: "ignored", reason: "mistargeted" };
      }
    }

    // 查看集合：目标 / pick / 区域查询（scope "top" 的张数经候选数与 432.1.c 共同收敛）。
    const candidates = resolvePoolCandidates(ctx, args)
      .map(ref => ctx.object(ref))
      .filter((object): object is ObjectSnapshot => object !== null);
    const lookAmount =
      args.scope === "top" && args.amount !== null
        ? Math.min(args.amount, candidates.length)
        : candidates.length;
    const looked = candidates.slice(0, lookAmount);

    const events = [];
    let linkedCount = 0;
    if (looked.length > 0) {
      // 私有查看：128.3/128.4，牌不离区，内核仅向 viewer 披露牌面。
      const outcome = ctx.perform({ type: "look", objects: looked.map(object => object.ref), player: args.player });
      if (outcome.status !== "done") {
        return negated(outcome);
      }
      events.push(...outcome.events);
      linkedCount = asNumber(outcome.result) ?? looked.length;
    }

    // 423.4：范围内的具体选择由执行查看的玩家作出，且选项只有查看者可见。被查看集合
    // 保持原区域顺序；被选中的牌（玩家随后要回收 / 放回 / 移动的那些）单独链接到
    // choosePicksKey，供 effect.recycle / effect.order 等后续指令消费。
    let chosen = looked;
    if (args.choose) {
      const options = looked.map(object => object.ref);
      const min = Math.min(args.chooseMin, options.length);
      const max = Math.min(args.chooseMax ?? options.length, options.length);
      if (options.length > 0 && max > 0) {
        const selected = ctx.choose<ObjectRef[]>({
          id: `effect.inspect:select:${args.player}:${args.pool.owner}:${args.pool.zone}`,
          type: "select-objects",
          chooser: args.player,
          visibility: "chooser-only",
          options,
          min,
          max
        });
        chosen = (Array.isArray(selected) ? selected : []).filter(isObjectRef)
          .map(ref => ctx.object(ref))
          .filter((object): object is ObjectSnapshot => object !== null);
      } else {
        chosen = [];
      }
    }

    const asRefs = (objects: readonly ObjectSnapshot[]): Value =>
      objects.map(object => ({ id: object.ref.id, zoneEntryId: object.ref.zoneEntryId }));
    const linkedValues: Record<string, Value> = {
      [args.linkedKey]: linkedCount,
      [args.pickedKey]: asRefs(looked)
    };
    if (args.choose) {
      linkedValues[args.choosePicksKey] = asRefs(chosen);
    }
    for (const [key, value] of Object.entries(linkedValues)) {
      ctx.link(key, value);
    }
    return { status: "executed", events, linkedValues };
  }
};


