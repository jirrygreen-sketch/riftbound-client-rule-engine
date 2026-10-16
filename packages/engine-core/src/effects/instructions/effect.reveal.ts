import type { Expr } from "@riftbound/card-dsl";
import type {
  ActionOutcome,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";

/**
 * effect.reveal — 展示信息（Reveal，CR v1.5 §425）。
 *
 * 参数：
 * - player: Expr → PlayerId。在谁的私有/秘密区域里取牌展示（CR 425.3 “Reveal cards from [zone].”）。
 * - zone: Expr → ZoneId。被展示的区域（"deck"=Main Deck、"hand" 等；默认 "deck"）。
 * - count: Expr → number。展示张数；省略时按 CR 425.3.a 展示该区域当前全部卡牌。
 *   注意：ResolveContext 不暴露区域内顺序（“牌库顶”），候选顺序即 ctx.query 的返回顺序；
 *   需要严格“顶 N 张”语义时，目标选取应由 TargetSpec/target.query 承担（见契约变更请求）。
 * - target: string（TargetSpec id）。改为展示 ctx.targets(target) 锁定的对象；提供时忽略 player/zone/count。
 *   结算时重验引用：目标全部失效（对象已离区、旧 zoneEntryId）→ 本指令 ignored（契约 3.6 原语规则 2）。
 * - picker: Expr → PlayerId。CR 425.4 语义：从被展示的牌中挑出 pickCount 张（默认 1）成为本指令真正展示的子集。
 *   选择经 ctx.choose()（select-objects，options=候选引用、min=max=pickCount），缺答案时按契约挂起、带答案整体重跑。
 *   展示是公开信息（CR 425.1：presenting to all players），故选择请求 visibility 恒为 "public"。
 *
 * 语义边界（谁可见与展示有效期）：
 * - Reveal = 向全体玩家展示（CR 425.1），没有“只展示给部分玩家”的形态；私下查看是 look，
 *   展示特征快照是 show-off（分别由 effect.inspect / Show Off 原语承担），玩家自愿展示私牌不是 Reveal（CR 425.2.b）。
 * - Revealed 是临时状态而非区域，卡牌停留在原区域（CR 425.1.a / 425.1.a.2），本原语只提交
 *   perform({ type: "reveal" }) 信息动作，不做任何区域移动。
 * - 未指定期限时，Revealed 状态持续到该法术/异能结算结束（CR 425.1.a.3）；有效期由引擎的
 *   结算范围承载，本原语不写持续状态。CR 425.4 的“展示中可操作这些牌”由链接值支撑（见下）。
 * - Reveal 是 Limited Action（CR 425.2）：只能展示确有卡牌存在的区域；空区域（张数为 0）无可展示，
 *   对应动作 impossible → 本指令 negated。
 *
 * 结果（契约 3.6 原语规则 2）：
 * - 全部 perform done → executed，并把被展示对象写入链接值 ctx.link("revealed", ObjectRef[])
 *   （与返回值 linkedValues.revealed 相同），供 “if you do”/后续指令（从被展示的牌中选择、回收其余等）引用；
 *   张数边界（0、超过可用数）以链接值中的实际张数为准（参照 CR 425.3 示例按实际可用张数执行）。
 * - 任一 perform 为 replaced/prevented/impossible → negated。
 * - 目标形态下目标全部失效 → ignored（reason: "mistargeted"）。
 *
 * 确定性：不读时间、不用随机；挑牌只经 ctx.choose()。
 */

/** Raw args as authored in EffectIR; validated by argsSchema. */
export interface EffectRevealArgs {
  readonly player?: Expr;
  readonly zone?: Expr;
  readonly count?: Expr;
  readonly target?: string;
  readonly picker?: Expr;
  readonly pickCount?: Expr;
}

const DEFAULT_ZONE = "deck";
const KNOWN_ZONES: ReadonlySet<string> = new Set([
  "hand",
  "deck",
  "rune-deck",
  "trash",
  "banishment",
  "board",
  "rune-zone",
  "chain"
]);

function isExpr(value: unknown): value is Expr {
  return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

const argsSchema: Schema<EffectRevealArgs> = {
  parse(value: unknown): EffectRevealArgs {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("effect.reveal: args must be an object");
    }
    const record = value as Record<string, unknown>;
    const args: Record<string, unknown> = {};
    for (const key of ["player", "zone", "count", "picker", "pickCount"] as const) {
      const expr = record[key];
      if (expr !== undefined) {
        if (!isExpr(expr)) throw new Error("effect.reveal: " + key + " must be an Expr");
        args[key] = expr;
      }
    }
    if (record.target !== undefined) {
      if (typeof record.target !== "string" || record.target.length === 0) {
        throw new Error("effect.reveal: target must be a non-empty TargetSpec id");
      }
      args.target = record.target;
    }
    return args as EffectRevealArgs;
  }
};

function evaluatePlayerId(ctx: ResolveContext, expr: Expr, label: string): PlayerId {
  const value = ctx.evaluate(expr);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("effect.reveal: " + label + " must evaluate to a player id");
  }
  return value;
}

function evaluateZone(ctx: ResolveContext, expr: Expr): string {
  const value = ctx.evaluate(expr);
  if (typeof value !== "string" || !KNOWN_ZONES.has(value)) {
    throw new Error("effect.reveal: zone must evaluate to a known zone, got " + String(value));
  }
  return value;
}

function evaluateCount(ctx: ResolveContext, expr: Expr, label: string): number {
  const value = ctx.evaluate(expr);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("effect.reveal: " + label + " must evaluate to a non-negative integer");
  }
  return value;
}

function negatedFrom(outcome: ActionOutcome): InstructionResult {
  const status = outcome.status;
  return {
    status: "negated",
    reason: status === "replaced" ? "replaced" : status === "prevented" ? "skipped" : "impossible",
    events: [...outcome.events]
  };
}

function execute(ctx: ResolveContext, args: EffectRevealArgs): InstructionResult {
    let candidates: ObjectRef[];
    if (args.target !== undefined) {
      const targets = ctx.targets(args.target);
      const live = targets.filter(ref => ctx.object(ref) !== null);
      // 契约 3.6 原语规则 2：目标全部失效（对象已离区、旧 zoneEntryId）→ ignored。
      if (targets.length > 0 && live.length === 0) {
        return { status: "ignored", reason: "mistargeted" };
      }
      candidates = live;
    } else {
      const player = args.player === undefined ? ctx.controller : evaluatePlayerId(ctx, args.player, "player");
      const zone = args.zone === undefined ? DEFAULT_ZONE : evaluateZone(ctx, args.zone);
      const available = ctx.query({ owner: player, zone }).map(snapshot => snapshot.ref);
      // CR 425.3.a：未指明张数时展示该区域当前全部卡牌；指明张数时按实际可用张数执行。
      candidates = args.count === undefined ? available : available.slice(0, evaluateCount(ctx, args.count, "count"));
    }

    let revealed = candidates;
    if (args.picker !== undefined) {
      const picker = evaluatePlayerId(ctx, args.picker, "picker");
      const pickCount = args.pickCount === undefined ? 1 : evaluateCount(ctx, args.pickCount, "pickCount");
      if (pickCount > 0) {
        if (candidates.length < pickCount) {
          // 被展示的牌不足约定张数：无合法选项，选择不可能 → negated。
          return { status: "negated", reason: "impossible", events: [] };
        }
        const choiceId = "effect.reveal:pick:" + picker;
        const picked = ctx.choose<ObjectRef[]>({
          id: choiceId,
          type: "select-objects",
          chooser: picker,
          visibility: "public",
          options: candidates,
          min: pickCount,
          max: pickCount,
          prompt: "Choose " + pickCount + " of the revealed card(s) to reveal."
        });
        const selection = Array.isArray(picked) ? picked : [picked];
        revealed = selection.map(pick => {
          const match = candidates.find(ref => sameRef(ref, pick));
          if (!match) throw new Error("effect.reveal: picked object " + pick.id + " is not among the candidates");
          return match;
        });
      }
    }

    const events: GameEvent[] = [];
    const performed: ObjectRef[] = [];
    for (const ref of revealed) {
      // CR 425.1：Reveal 是向全体玩家展示 → 不传 viewers。
      const outcome = ctx.perform({ type: "reveal", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") return negatedFrom(outcome);
      performed.push(ref);
    }
    if (performed.length === 0) {
      // CR 425.2：Reveal 是 Limited Action；空区域没有可展示的牌 → impossible → negated。
      return { status: "negated", reason: "impossible", events };
    }

    const linked = performed.map(refValue);
    ctx.link("revealed", linked);
    return { status: "executed", events, linkedValues: { revealed: linked } };
}

// 注册表生成器要求默认导出字面量含静态字符串 op。
const definition = {
  op: "effect.reveal",
  argsSchema,
  execute
} satisfies InstructionDef<EffectRevealArgs>;
export default definition;
