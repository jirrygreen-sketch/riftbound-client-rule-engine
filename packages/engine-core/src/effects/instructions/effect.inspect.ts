import type { Expr, ObjectRef, Value } from "@riftbound/card-dsl";
import type {
  GameEvent, InstructionDef, InstructionResult, ObjectSnapshot, ResolveContext, Schema, ZoneId
} from "../contract.js";

/**
 * effect.inspect：私下查看限定范围，可从中进行非目标选择。
 *
 * 所有参数均为 card-dsl Expr，在结算时求值。player 是查看者；zone 为 hand / deck /
 * rune-deck / trash / banishment 或 { owner, zone }，默认查看者的主牌库。
 * scope 为 "zone"（整个区域）、"picks"
 * （picksSpecId 指定集合）、"top"（上游 picksSpecId 按牌库顶优先提供，取前 amount 张）。
 * TargetSpec id 经 ctx.targets() 读取，PickSpec id 经 ctx.picks() 读取；两者互斥，
 * pick 不是目标。不传 scope 时，有 amount 则为 top，否则有 picksSpecId 则为 picks，
 * 否则为 zone；amount 仅用于 top，须为非负安全整数。
 *
 * 核心规则 v1.5 128.3–128.4：look 仅向 player 披露，所有选择均为 chooser-only。
 * 128.6–128.6.a：按特征查询私有牌可以失败；chooseCount 默认 { min: 0, max: 范围大小 }。
 * 上游选择须保留该许可，不能要求玩家证明没有匹配牌。432.1.c：尽可能查看，不 Burn Out，
 * 不离开原区域。432.1.c.1：不足以完成后续强制选择时 negated，不降低最小选择数。
 * 437.1–437.4 / 817.1.b：提供 Predict / Vision 的查看与选择步骤；回收、排序、抽牌、
 * 公开展示分别由 effect.recycle / effect.order / effect.draw / effect.reveal 执行。
 *
 * choose 为 boolean，启用 select-objects；chooseCount 为 { min, max }。
 * 同一区域的多个查看指令应传各自唯一、稳定的 choiceId，默认值为
 * effect.inspect:select:<viewer>:<owner>:<zone>。链接参数指定写入 ctx.link 的键：
 * linkedKey（默认 inspected）记录实际查看张数，pickedKey（默认 inspected-picked）
 * 记录已查看引用，choosePicksKey（默认 inspected-pick）在 choose=true 时记录选中引用。
 * 空范围执行并链接 0 / 空列表，除非强制选择不可能。动作 replaced / prevented /
 * impossible 则 negated；目标全部失效则 ignored。
 *
 * 契约缺口：query() 不保证顺序，ObjectSnapshot 无牌库位置。非零 top 查看须由上游
 * 提供有序 picksSpecId；缺少时明确阻断（negated/impossible），不截取 query() 近似，
 * 也不读取 TestWorld 专属能力。自动发现牌库顶 N 张前，须由协调者补充有序查询/选择契约。
 */
export type InspectScope = "top" | "zone" | "picks";

export interface InspectArgs {
  readonly player: Expr;
  readonly zone?: Expr;
  readonly scope?: Expr;
  readonly amount?: Expr;
  readonly targetSpecId?: Expr;
  readonly picksSpecId?: Expr;
  readonly choose?: Expr;
  readonly chooseCount?: Expr;
  readonly choiceId?: Expr;
  readonly linkedKey?: Expr;
  readonly pickedKey?: Expr;
  readonly choosePicksKey?: Expr;
}

const ARG_NAMES = [
  "player", "zone", "scope", "amount", "targetSpecId", "picksSpecId", "choose",
  "chooseCount", "choiceId", "linkedKey", "pickedKey", "choosePicksKey"
] as const;
const ZONES: readonly ZoneId[] = ["hand", "deck", "rune-deck", "trash", "banishment"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0;
}

function isValue(value: unknown, active = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  if (!Array.isArray(value) && (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": return isRef(value.object) && isString(value.property);
    case "object-attribute": return isRef(value.object) && isString(value.attribute);
    case "linked": case "linked-value":
      return isString(value.instructionId) && (value.key === undefined || isString(value.key));
    case "count":
      return isString(value.subject) &&
        (value.filter === undefined || (isRecord(value.filter) && isValue(value.filter)));
    default: return false;
  }
}

function invalid(message: string): never {
  throw new TypeError(`effect.inspect: ${message}`);
}

const argsSchema: Schema<InspectArgs> = {
  parse(value: unknown): InspectArgs {
    if (!isRecord(value) || !isExpr(value.player)) invalid("player must be an Expr");
    for (const [key, expr] of Object.entries(value)) {
      if (!(ARG_NAMES as readonly string[]).includes(key)) invalid(`unknown argument ${key}`);
      if (expr !== undefined && !isExpr(expr)) invalid(`${key} must be an Expr`);
    }
    if (value.targetSpecId !== undefined && value.picksSpecId !== undefined) {
      invalid("targets and picks cannot both supply the inspect range");
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

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${name} must evaluate to a nonnegative safe integer`);
  }
  return value;
}

function string(value: unknown, name: string): string {
  if (!isString(value)) invalid(`${name} must evaluate to a nonempty string`);
  return value;
}

function resolveArgs(ctx: ResolveContext, args: InspectArgs, targetSpecId: string | null) {
  const evalOr = (expr: Expr | undefined, fallback: Value): Value =>
    expr === undefined ? fallback : ctx.evaluate(expr);
  const player = string(ctx.evaluate(args.player), "player");
  const zoneValue = evalOr(args.zone, "deck");
  const pool = typeof zoneValue === "string" ? { owner: player, zone: zoneValue } :
    isRecord(zoneValue) ? zoneValue : invalid("invalid zone");
  const owner = string(pool.owner, "zone.owner");
  const zone = pool.zone;
  if (typeof zone !== "string" || !(ZONES as readonly string[]).includes(zone)) invalid("invalid zone");
  const scope = evalOr(args.scope, args.amount !== undefined ? "top" : args.picksSpecId !== undefined ? "picks" : "zone");
  if (scope !== "top" && scope !== "zone" && scope !== "picks") invalid("invalid scope");
  const amount = args.amount === undefined ? null : count(ctx.evaluate(args.amount), "amount");
  if (scope === "top" && amount === null) invalid("top scope requires amount");
  if (scope !== "top" && amount !== null) invalid("amount is only valid for top scope");
  const picksSpecId = args.picksSpecId === undefined ? null : string(ctx.evaluate(args.picksSpecId), "picksSpecId");
  if (targetSpecId !== null && picksSpecId !== null) invalid("targets and picks are mutually exclusive");
  if (scope === "top" && targetSpecId !== null) invalid("top scope requires ordered picks, not targets");
  if (scope === "picks" && picksSpecId === null) invalid("picks scope requires picksSpecId");
  if (scope === "zone" && picksSpecId !== null) invalid("picksSpecId requires picks or top scope");
  const choose = evalOr(args.choose, false);
  if (typeof choose !== "boolean") invalid("choose must evaluate to a boolean");
  const boundsValue = args.chooseCount === undefined ? null : ctx.evaluate(args.chooseCount);
  const bounds = args.chooseCount === undefined ? null :
    isRecord(boundsValue) ? boundsValue : invalid("chooseCount must be { min, max }");
  const min = bounds === null ? 0 : count(bounds.min, "chooseCount.min");
  const max = bounds === null ? null : count(bounds.max, "chooseCount.max");
  if (max !== null && min > max) invalid("chooseCount.min exceeds max");
  const linkedKey = string(evalOr(args.linkedKey, "inspected"), "linkedKey");
  const pickedKey = string(evalOr(args.pickedKey, "inspected-picked"), "pickedKey");
  const choosePicksKey = string(evalOr(args.choosePicksKey, "inspected-pick"), "choosePicksKey");
  if (new Set([linkedKey, pickedKey, ...(choose ? [choosePicksKey] : [])]).size !== (choose ? 3 : 2)) {
    invalid("result link keys must be distinct");
  }
  return {
    player, owner, zone: zone as ZoneId, scope, amount, targetSpecId, picksSpecId,
    choose, min, max, linkedKey, pickedKey, choosePicksKey,
    choiceId: string(evalOr(args.choiceId, `effect.inspect:select:${player}:${owner}:${zone}`), "choiceId")
  };
}

const refsValue = (refs: readonly ObjectRef[]): Value =>
  refs.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
const refKey = (ref: ObjectRef): string => JSON.stringify([ref.id, ref.zoneEntryId]);

export default {
  op: "effect.inspect",
  argsSchema,
  execute(ctx: ResolveContext, rawArgs: InspectArgs): InstructionResult {
    const targetSpecId = rawArgs.targetSpecId === undefined ? null :
      string(ctx.evaluate(rawArgs.targetSpecId), "targetSpecId");
    const targets = targetSpecId === null ? null : ctx.targets(targetSpecId);
    // 目标全部失效时先忽略，避免对失效目标求值而把 ignored 错误变成参数错误。
    if (targets !== null && !targets.some(ref => ctx.object(ref) !== null)) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const args = resolveArgs(ctx, rawArgs, targetSpecId);
    const inRange = (object: ObjectSnapshot | null): object is ObjectSnapshot =>
      object !== null && object.owner === args.owner && object.zone === args.zone;
    if (targets !== null && !targets.some(ref => inRange(ctx.object(ref)))) {
      return { status: "ignored", reason: "mistargeted" };
    }
    if (args.scope === "top" && args.amount !== 0 && args.picksSpecId === null) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    // 区域查询是集合，不能推导牌库顺序。只有上游 picks 提供顺序；完整区域按引用稳定排序。
    const refs = args.amount === 0 ? [] : targets ?? (args.picksSpecId !== null
      ? ctx.picks(args.picksSpecId).filter(isRef)
      : ctx.query({ owner: args.owner, zone: args.zone }).map(object => object.ref)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.zoneEntryId - b.zoneEntryId));
    const seen = new Set<string>();
    const candidates = refs.filter(ref => {
      if (seen.has(refKey(ref)) || !inRange(ctx.object(ref))) return false;
      seen.add(refKey(ref));
      return true;
    });
    const inspected = args.scope === "top" ? candidates.slice(0, args.amount ?? 0) : candidates;
    const events: GameEvent[] = [];
    if (inspected.length > 0) {
      const outcome = ctx.perform({ type: "look", objects: inspected, player: args.player });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        return {
          status: "negated",
          reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
          events
        };
      }
    }

    let chosen: ObjectRef[] = [];
    if (args.choose) {
      const max = Math.min(args.max ?? inspected.length, inspected.length);
      if (args.min > max) return { status: "negated", reason: "impossible", events };
      if (max > 0) {
        const answer = ctx.choose<unknown>({
          id: args.choiceId, type: "select-objects", chooser: args.player,
          visibility: "chooser-only", options: inspected, min: args.min, max
        });
        const options = new Set(inspected.map(refKey));
        if (!Array.isArray(answer) || !answer.every(isRef) || answer.length < args.min ||
          answer.length > max || new Set(answer.map(refKey)).size !== answer.length ||
          !answer.every(ref => options.has(refKey(ref)))) invalid("invalid choice answer");
        chosen = answer;
      }
    }
    // look 完成表示查看了提交的全部引用；参考内核不像 draw 那样返回数字结果。
    // 查看不会改变区域或对象身份。
    const linkedValues: Record<string, Value> = {
      [args.linkedKey]: inspected.length,
      [args.pickedKey]: refsValue(inspected)
    };
    if (args.choose) linkedValues[args.choosePicksKey] = refsValue(chosen);
    for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
    return { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<InspectArgs>;
