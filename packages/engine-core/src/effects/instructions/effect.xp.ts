/**
 * effect.xp — 获得 XP（Gain XP，玩家 XP 资源）。
 *
 * 规则依据（Core Rules v1.5 条目号）：
 * - 728-730.2：XP 是玩家资源；获得 XP 就是增加该玩家已标记的 XP 值。减少 XP
 *   （花费）属于另一个方向，由 cost.xp / 支付计划负责，不在本原语。
 * - 729.1 / 729.2：XP 数量必须清晰标记，且是公开信息；本原语只提交动作并写
 *   链接值，标记方式与投影由内核拥有。
 * - 730.1 / 733：Gain X XP 把获得者的 XP 增加 X，结算时取值；XP 没有积累上限，
 *   因此本原语对数量不设上限，数量边界只有非负安全整数本身。
 * - 731 / 731.1：XP 不是 Game Object，不能被选为目标、横置或重置；因此本原语
 *   不为 XP 本身建立目标。target 参数沿用同类资源原语（effect.draw）的锚定用法：
 *   取指令已锁定且仍然有效的对象引用的当前控制者作为候选获得者。
 * - 732：多人模式里 XP 不共享；一次获得只作用于一个玩家，不把数量分摊给多人。
 * - 823.1.c.1：Hunt 的 When I conquer or hold, my controller gains X XP 是本原语
 *   最常见的调用点（例如 unl-117-219 Arachnoid Horror 的 [Hunt 2]）。
 * - 359.3.e.4-e.8：目标在结算时失效；部分失效时只用仍合法的目标继续执行，全部
 *   失效时指令不执行（ignored）。
 * - 359.3.e.11-e.13：能部分执行就部分执行；已离区的对象用最后已知信息回看，
 *   信息不再可用时不把 null 当成 0。
 * - 355.7：target 与 pick 语义不同；pick 不是目标，不触发成为目标相关触发，
 *   因此 pick 只经 ctx.picks() 读取。
 * - 190.6.d：指令没有指明玩家时的隐含 you 就是能力控制者（ctx.controller）。
 *   本原语不入链、不推进优先权，这些属于 chain/ 与 priority-focus/。
 *
 * args（值参数一律是 card-dsl Expr，结算时经 ctx.evaluate 求值）：
 * - amount（必填）：要获得的 XP 数量，结算时必须求值为非负安全整数。0 表示
 *   获得 0 XP：不提交动作，但按 executed 结算并链接 0（与 effect.draw /
 *   effect.channel 对 0 的处理一致）；其他非法值 negated(impossible)。
 * - player（可选）：获得者。可以写静态 PlayerId 字符串（与 effect.draw /
 *   effect.channel 一致），也可以写 Expr；Expr 求值为 PlayerId 字符串、ObjectRef
 *   （取当前控制者，已离区则取最后已知控制者）或它们的数组（候选者）。
 * - target（可选）：TargetSpec id，经 ctx.targets(id) 读取。仍然有效的目标仅用于
 *   锚定指令：取这些对象的当前控制者作为候选获得者；引用全部失效（对象已离区、
 *   旧 zoneEntryId）时 ignored(mistargeted)。XP 本身永远不是目标（731.1）。
 * - pick（可选）：PickSpec id，经 ctx.picks(id) 读取非目标选择；条目可以是
 *   PlayerId 字符串，也可以是 ObjectRef（取当前或最后已知控制者）。pick 不是
 *   目标，不触发成为目标相关触发（355.7）。
 * - choice（可选）：候选获得者多于一个时的重放式选择配置，经 ctx.choose 以
 *   type mode 提问。id 是稳定的重放请求 id；chooser 默认 ctx.controller，
 *   visibility 默认 public（729.2：XP 数量与获得者都是公开信息）。候选唯一时
 *   不提问；候选多于一个又没有 choice 时 negated(impossible)。
 * - linkKey（可选）：实际获得数量的链接键，默认 gained；另固定写入 gainedTo
 *   （实际获得者），供 if you do 与链接指令引用。linkKey 不得使用保留键
 *   gainedTo。
 *
 * 与相近原语的边界：
 * - cost.xp / spend-xp：730.2 的减少 XP 是费用与支付计划的领地；本原语只增加
 *   XP，不提供任何付费或花费入口。
 * - effect.draw / effect.channel / effect.damage：同为资源类效果原语，本原语沿用
 *   它们的实际结果加链接值写法，但不移动卡牌、不造成伤害、不推进回合。
 * - condition / continuous：读取 XP 做条件（Level、Wily Newtfish 等）属于 condition
 *   与图层；本原语只在成功结算后写链接值。
 * - 733：没有超过上限就无效的数量边界；任何非负安全整数都照常获得。
 *
 * 用到的 GameAction：只有 gain-xp（契约 3.6 封闭集合的资源类别）。不新增动作。
 *
 * 结果（契约 3.3 / 3.6 原语规则 1-3）：
 * - perform({ type: "gain-xp" }) 返回 done → executed；实际获得数量（内核返回结果
 *   优先，否则回退到请求数量）写入 ctx.link(linkKey)，获得者写入 gainedTo。
 * - 任一 perform 返回 replaced / prevented / impossible → negated；reason 映射：
 *   replaced → replaced，prevented → skipped，impossible → impossible。
 * - target 引用全部失效 → ignored(mistargeted)；非目标选择（pick / player 表达式）
 *   没有可用条目或形状非法 → negated(impossible)。
 * - 确定性：不读时间、不用随机；唯一的选择入口是 ctx.choose。
 * - 只经 ResolveContext 读写：读 targets / picks / object / lastKnown / evaluate，写只
 *   通过 perform({ type: "gain-xp" }) 与 link；不直接改状态、不推进优先权。
 */
import type {
  ChoiceVisibility,
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";

/** 获得者候选多于一个时的挂起式询问配置（type mode）。 */
export interface EffectXpChoice {
  /** 稳定的重放请求 id（引擎以它为 ChoiceRequest id）。 */
  readonly id: string;
  /** 做出选择的玩家；Expr 求值为 PlayerId，默认 ctx.controller。 */
  readonly chooser?: Expr;
  /** 选择的可见性，默认 public（729.2）。 */
  readonly visibility?: ChoiceVisibility;
  /** 展示给玩家的提示文本。 */
  readonly prompt?: string;
}

/** effect.xp 的 EffectIR 参数；值参数一律是 card-dsl Expr。 */
export interface EffectXpArgs {
  /** 获得的 XP 数量，结算时求值的 Expr（非负安全整数）。 */
  readonly amount: Expr;
  /** 获得者：静态 PlayerId 字符串，或求值为 PlayerId / ObjectRef / 其数组的 Expr。 */
  readonly player?: PlayerId | Expr;
  /** TargetSpec id；用其仍合法对象的控制者作为候选获得者。 */
  readonly target?: string;
  /** PickSpec id；非目标选择的获得者候选（PlayerId 或 ObjectRef）。 */
  readonly pick?: string;
  /** 候选多于一个时的重放式选择配置。 */
  readonly choice?: EffectXpChoice;
  /** 实际获得数量的链接键，默认 gained。 */
  readonly linkKey?: string;
}

const EXPR_KINDS: ReadonlySet<string> = new Set([
  "constant",
  "literal",
  "object-property",
  "object-attribute",
  "linked-value",
  "linked",
  "count",
  "arithmetic"
]);

const ARG_KEYS: ReadonlySet<string> = new Set([
  "amount",
  "player",
  "target",
  "pick",
  "choice",
  "linkKey"
]);

const CHOICE_KEYS: ReadonlySet<string> = new Set(["id", "chooser", "visibility", "prompt"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  return typeof value.kind === "string" && EXPR_KINDS.has(value.kind);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function parseChoice(value: unknown): EffectXpChoice {
  if (!isRecord(value)) throw new TypeError("effect.xp choice must be an object");
  for (const key of Object.keys(value)) {
    if (!CHOICE_KEYS.has(key)) throw new TypeError("Invalid effect.xp choice argument: " + key);
  }
  if (!isId(value.id)) throw new TypeError("effect.xp choice.id must be a non-empty string");
  if (value.chooser !== undefined && !isExpr(value.chooser)) {
    throw new TypeError("effect.xp choice.chooser must be an Expr");
  }
  if (value.visibility !== undefined && value.visibility !== "public" &&
      value.visibility !== "chooser-only" &&
      !(Array.isArray(value.visibility) && value.visibility.length > 0 && value.visibility.every(isId))) {
    throw new TypeError("effect.xp choice.visibility is invalid");
  }
  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    throw new TypeError("effect.xp choice.prompt must be a string");
  }
  return value as unknown as EffectXpChoice;
}

function parseArgs(value: unknown): EffectXpArgs {
  if (!isRecord(value)) throw new TypeError("effect.xp args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.has(key)) throw new TypeError("Invalid effect.xp argument: " + key);
  }
  if (!isExpr(value.amount)) throw new TypeError("effect.xp args.amount must be an Expr");
  const sources = [value.target, value.pick, value.player].filter(entry => entry !== undefined);
  if (sources.length > 1) {
    throw new TypeError("effect.xp accepts only one of target, pick, or player");
  }
  if (value.target !== undefined && !isId(value.target)) {
    throw new TypeError("effect.xp args.target must be a non-empty TargetSpec id");
  }
  if (value.pick !== undefined && !isId(value.pick)) {
    throw new TypeError("effect.xp args.pick must be a non-empty PickSpec id");
  }
  if (value.player !== undefined && !isId(value.player) && !isExpr(value.player)) {
    throw new TypeError("effect.xp args.player must be a PlayerId or an Expr");
  }
  if (value.choice !== undefined) parseChoice(value.choice);
  if (value.linkKey !== undefined && !isId(value.linkKey)) {
    throw new TypeError("effect.xp args.linkKey must be a non-empty string");
  }
  if (value.linkKey === "gainedTo") {
    throw new TypeError("effect.xp args.linkKey cannot shadow the reserved gainedTo key");
  }
  return value as unknown as EffectXpArgs;
}

const argsSchema: Schema<EffectXpArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

function controllerOf(ctx: ResolveContext, ref: ObjectRef): PlayerId {
  return ctx.object(ref)?.controller ?? ctx.lastKnown(ref).controller;
}

/** 把 player / pick 结果规范化为候选获得者；非法形状返回 null。 */
function playerCandidates(ctx: ResolveContext, value: unknown): PlayerId[] | null {
  if (value === undefined || value === null) return null;
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return null;
  const players: PlayerId[] = [];
  for (const entry of entries) {
    if (isId(entry)) {
      players.push(entry);
    } else if (isObjectRef(entry)) {
      players.push(controllerOf(ctx, entry));
    } else {
      return null;
    }
  }
  return players;
}

type RecipientResolution =
  | { readonly status: "resolved"; readonly player: PlayerId }
  | { readonly status: "ignored" }
  | { readonly status: "impossible" };

/** 解析唯一获得者；target 全部失效 → ignored，形状或选择非法 → impossible。 */
function resolveRecipient(ctx: ResolveContext, args: EffectXpArgs): RecipientResolution {
  let candidates: PlayerId[] | null;
  if (args.target !== undefined) {
    const current = ctx.targets(args.target).filter(ref => ctx.object(ref) !== null);
    if (current.length === 0) return { status: "ignored" };
    candidates = current.map(ref => controllerOf(ctx, ref));
  } else if (args.pick !== undefined) {
    candidates = playerCandidates(ctx, ctx.picks(args.pick));
  } else if (args.player !== undefined) {
    candidates = typeof args.player === "string"
      ? playerCandidates(ctx, args.player)
      : playerCandidates(ctx, ctx.evaluate(args.player));
  } else {
    candidates = [ctx.controller];
  }
  if (candidates === null || candidates.length === 0) return { status: "impossible" };
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { status: "resolved", player: unique[0]! };
  if (args.choice === undefined) return { status: "impossible" };
  const chooser = args.choice.chooser === undefined ? ctx.controller : ctx.evaluate(args.choice.chooser);
  if (!isId(chooser)) return { status: "impossible" };
  const answer = ctx.choose<PlayerId>({
    id: args.choice.id,
    type: "mode",
    options: unique,
    chooser,
    visibility: args.choice.visibility ?? "public",
    prompt: args.choice.prompt
  });
  if (!isId(answer) || !unique.includes(answer)) return { status: "impossible" };
  return { status: "resolved", player: answer };
}

function negatedReason(status: "replaced" | "prevented" | "impossible"):
  "replaced" | "skipped" | "impossible" {
  return status === "replaced" ? "replaced" : status === "prevented" ? "skipped" : "impossible";
}

export default {
  op: "effect.xp",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectXpArgs): InstructionResult {
    const recipient = resolveRecipient(ctx, args);
    if (recipient.status === "ignored") {
      return { status: "ignored", reason: "mistargeted" };
    }
    if (recipient.status === "impossible") {
      return { status: "negated", reason: "impossible", events: [] };
    }

    const amount = ctx.evaluate(args.amount);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    const linkKey = args.linkKey ?? "gained";
    const events: GameEvent[] = [];
    let gained = 0;
    // CR 730.1 / 733：获得 0 XP 不改变任何标记；不提交动作，仍按 executed 结算。
    if (amount > 0) {
      const outcome = ctx.perform({ type: "gain-xp", player: recipient.player, amount });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        return { status: "negated", reason: negatedReason(outcome.status), events };
      }
      gained = typeof outcome.result === "number" && Number.isSafeInteger(outcome.result) &&
        outcome.result >= 0 ? outcome.result : amount;
    }

    const linkedValues: Record<string, Value> = { gainedTo: recipient.player };
    linkedValues[linkKey] = gained;
    ctx.link(linkKey, gained);
    ctx.link("gainedTo", recipient.player);
    return { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<EffectXpArgs>;

