/**
 * effect.reveal — Reveal（CR v1.5 425.1–425.4.a、432.1.c）。
 *
 * 参数（target、pick、区域查询三种来源互斥）：
 * - target: TargetSpec id，经 ctx.targets() 读取已锁定并重验的目标；全失效时 ignored。
 * - pick: PickSpec id，经 ctx.picks() 读取非目标对象。牌库顶 N 张必须由上游
 *   target.query 按真实牌库顺序提供这些引用，不能从 ctx.query 的返回顺序推断。
 * - player: Expr → PlayerId，区域的所有者，默认 ctx.controller。
 * - zone: Expr → ZoneId，默认 hand；省略 count 时展示区域当时的全部牌（425.3.a）。
 * - count: Expr → 非负安全整数，区域查询最多展示的张数；不足时尽可能执行，
 *   不触发 Burn Out（432.1.c）。手牌的真子集经 ctx.choose() 由所有者私下选择；
 *   牌库等其他区域的真子集必须改用 pick，避免近似实现“牌库顶”或泄露秘密信息。
 * - choiceId: 上游提供的本指令唯一、稳定的选择 id；需要 choose 时必填，避免
 *   多条指令带答案重跑时复用答案。无需选择时不询问。
 *
 * 语义边界：Reveal 将私有/秘密信息向全体玩家公开（128.3–128.5、425.1、
 * 425.2.a），不支持私下查看（look / effect.inspect）或 Show Off 特征快照。
 * 选择展示哪些手牌发生在公开之前，选项和答案仅选择者可见；从已经展示的牌中
 * 挑选并移动由后续原语处理（425.4.a），不在此处执行。
 * 卡牌仍在原区域，原引用和牌库顺序均不变（425.1.a.2、425.3）。候选集合仅取
 * 一次，后加入区域的牌不会被展示（425.3.a.1）。只提交无 viewers 的 reveal
 * 动作，表示全体可见。默认 Revealed 有效期由动作内核负责，到当前法术/异能
 * 结算结束（425.1.a.3）；现有 GameAction 无期限字段，显式期限暂不支持，
 * 不接受 duration 参数，也不以永久状态或其他期限近似。参考内核仅记录动作，
 * 不模拟可见性及到期清理，这两项需由协调者补充内核验证。
 *
 * 所有动作 done → executed；任一 replaced/prevented/impossible → negated，
 * 仍尽可能展示其余对象（055、契约 3.6）。没有可展示对象时 negated/impossible。
 * 无论 executed 或 negated，都链接实际 done 的 revealed: ObjectRef[] 与
 * revealedCount: number，供后续指令及 “if you do” 使用；ignored 不写链接。
 */
import type { Expr } from "@riftbound/card-dsl";
import { disclosedRefs, isInspectExpression } from "./effect.inspect.js";
import type {
  ActionOutcome,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  ObjectSnapshot,
  ResolveContext,
  Schema,
  Value,
  ZoneId
} from "../contract.js";

export interface EffectRevealArgs {
  readonly target?: string;
  readonly pick?: string;
  readonly player?: Expr;
  readonly zone?: Expr;
  readonly count?: Expr;
  readonly choiceId?: string;
}

const ZONES: ReadonlySet<string> = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"
]);
const ARG_KEYS = new Set(["target", "pick", "player", "zone", "count", "choiceId"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id)
    && typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

const argsSchema: Schema<EffectRevealArgs> = {
  parse(value: unknown): EffectRevealArgs {
    if (!isRecord(value)) throw new Error("effect.reveal: args must be an object");
    for (const key of Object.keys(value)) {
      if (!ARG_KEYS.has(key)) throw new Error("effect.reveal: unsupported argument " + key);
    }
    for (const key of ["player", "zone", "count"] as const) {
      if (value[key] !== undefined && !isInspectExpression(value[key])) {
        throw new Error("effect.reveal: " + key + " must be an Expr");
      }
    }
    for (const key of ["target", "pick", "choiceId"] as const) {
      if (value[key] !== undefined && !isId(value[key])) {
        throw new Error("effect.reveal: " + key + " must be a non-empty id");
      }
    }
    if (value.target !== undefined && value.pick !== undefined) {
      throw new Error("effect.reveal: target and pick are mutually exclusive");
    }
    if ((value.target !== undefined || value.pick !== undefined)
      && ["player", "zone", "count", "choiceId"].some(key => value[key] !== undefined)) {
      throw new Error("effect.reveal: target/pick cannot be combined with zone selection arguments");
    }
    if (value.choiceId !== undefined && value.count === undefined) {
      throw new Error("effect.reveal: choiceId requires count");
    }
    return { ...value } as EffectRevealArgs;
  }
};

function evaluatedId(ctx: ResolveContext, expr: Expr, label: string): string {
  const value = ctx.evaluate(expr);
  if (!isId(value)) throw new Error("effect.reveal: " + label + " must evaluate to a non-empty id");
  return value;
}

function evaluatedCount(ctx: ResolveContext, expr: Expr): number {
  const value = ctx.evaluate(expr);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("effect.reveal: count must evaluate to a non-negative safe integer");
  }
  return value;
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function uniqueRefs(refs: readonly ObjectRef[]): ObjectRef[] {
  return refs.filter((ref, index) => refs.findIndex(other => sameRef(ref, other)) === index);
}

function zoneCandidates(ctx: ResolveContext, args: EffectRevealArgs): ObjectRef[] {
  const player = args.player === undefined ? ctx.controller : evaluatedId(ctx, args.player, "player");
  const zone = args.zone === undefined ? "hand" : evaluatedId(ctx, args.zone, "zone");
  if (!ZONES.has(zone)) throw new Error("effect.reveal: zone must evaluate to a known zone");
  const available = uniqueRefs(ctx.query({ owner: player, zone }).map(snapshot => snapshot.ref));
  if (args.count === undefined) return available;
  const count = evaluatedCount(ctx, args.count);
  if (count === 0) return [];
  if (count >= available.length) return available;
  if (zone !== "hand") {
    throw new Error("effect.reveal: a subset of this zone requires upstream ordered picks; query order is not deck order");
  }
  if (args.choiceId === undefined) throw new Error("effect.reveal: choiceId is required for hand selection");
  const picked = ctx.choose<readonly ObjectRef[]>({
    id: args.choiceId,
    type: "select-objects",
    chooser: player,
    visibility: "chooser-only",
    options: available,
    min: count,
    max: count,
    prompt: "Choose " + count + " card(s) from your hand to reveal."
  });
  if (!Array.isArray(picked) || picked.length !== count || !picked.every(isRef)
    || uniqueRefs(picked).length !== count || picked.some(ref => !available.some(candidate => sameRef(ref, candidate)))) {
    throw new Error("effect.reveal: answer must contain the requested number of distinct available object references");
  }
  return picked.map(ref => available.find(candidate => sameRef(ref, candidate))!);
}

function revealable(object: ObjectSnapshot): boolean {
  return object.faceDown || object.zone === "hand" || object.zone === "deck" || object.zone === "rune-deck";
}

function execute(ctx: ResolveContext, args: EffectRevealArgs): InstructionResult {
  let candidates: ObjectRef[];
  if (args.target !== undefined) {
    candidates = uniqueRefs(ctx.targets(args.target)).filter(ref => ctx.object(ref) !== null);
    if (candidates.length === 0) return { status: "ignored", reason: "mistargeted" };
  } else if (args.pick !== undefined) {
    const picked = ctx.picks(args.pick);
    if (!picked.every(isRef)) throw new Error("effect.reveal: pick must contain only object references");
    candidates = uniqueRefs(picked);
  } else {
    candidates = zoneCandidates(ctx, args);
  }

  const events: GameEvent[] = [];
  const performed: Value[] = [];
  let failure: Exclude<ActionOutcome["status"], "done"> | undefined = candidates.length === 0 ? "impossible" : undefined;
  for (const ref of candidates) {
    const object = ctx.object(ref);
    if (object === null || !revealable(object)) {
      failure ??= "impossible";
      continue;
    }
    const outcome = ctx.perform({ type: "reveal", object: ref });
    events.push(...outcome.events);
    if (outcome.status === "done") performed.push(...disclosedRefs([ref], outcome).map(actual => ({
      id: actual.id, zoneEntryId: actual.zoneEntryId
    })));
    else failure ??= outcome.status;
  }
  const linkedValues = { revealed: performed, revealedCount: performed.length };
  ctx.link("revealed", performed);
  ctx.link("revealedCount", performed.length);
  if (failure !== undefined) {
    return { status: "negated", reason: failure === "prevented" ? "skipped" : failure, events };
  }
  return { status: "executed", events, linkedValues };
}

// 注册表生成器要求默认导出字面量含静态字符串 op。
const definition = {
  op: "effect.reveal",
  argsSchema,
  execute
} satisfies InstructionDef<EffectRevealArgs>;
export default definition;
