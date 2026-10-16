import type { Expr, ObjectRef } from "@riftbound/card-dsl";
import type {
  ChoiceVisibility,
  GameEvent,
  InstructionDef,
  InstructionResult,
  PlayerId,
  ResolveContext,
  Schema,
  Value
} from "../contract.js";

/**
 * effect.draw —— 抽牌（Draw X，CR v1.5 §414）。
 *
 * 规则依据（Core Rules v1.5 条目号）：
 * - 414.1 / 414.1.a：抽一张牌就是把一张牌从某个区域拿到手牌；未特别说明时从
 *   Main Deck 顶部抽取。因此本原语只提交 `{ type: "draw" }` 游戏动作，不自己
 *   挑牌、不看牌面，也不决定“牌库顶”是哪张（区域顺序由内核拥有）。
 * - 414.2 / 414.2.b：抽牌是受限动作，只有游戏效果指示时才能执行；本原语对应
 *   “效果指示抽牌”，回合 Draw Phase 的流程抽牌属于 turn/，不在本文件。
 * - 414.3：官方格式为 “Draw X.”，X 在本原语里经 ctx.evaluate(amount) 在结算时取值。
 * - 414.4 / 432.1.a / 432.2：牌库不足时尽可能抽、执行 Burn Out、再补抽剩余数量。
 *   空牌库、Burn Out 的替代/连续结算与隐藏信息投影全部归内核；本原语只读取
 *   GameAction 的实际结果（如实际抽到的张数），不在本文件实现 Burn Out。
 * - 108.7.b / 108.7.c / 108.7.e：抽到的牌进入 Hand（私有信息）；手牌数量是公开信息。
 *   本原语不把牌面信息写进链接值，避免绕过内核的隐私投影。
 * - 355.7 / 355.10.e：目标（target）与非目标选择（pick）语义不同；pick 不触发
 *   “成为目标”相关触发，因此 pick 的结果只经 ctx.picks() 读取。
 * - 359.3.e.5–e.8：结算时目标全部失效的指令不执行（ignored）；部分目标失效时
 *   只用仍然有效的目标继续执行。
 * - 359.3.e.11 / 359.3.e.13：能部分执行就部分执行；由先前指令移动过区域的对象可
 *   以“回看”其最后已知信息（例如“其控制者抽 2”）。
 * - 359.3.e.14.a–b：链接指令的目标被忽略时，后续链接指令也被忽略；单纯动作被
 *   否定（replaced/skipped）不阻止后续不直接引用该动作的链接指令。
 * - 124：对象跨非棋盘区域移动后是新的对象，旧 zoneEntryId 引用失效；本原语对
 *   target 引用只承认结算时仍有效的引用。
 *
 * 参数（argsSchema 校验的是 EffectIR 形状，值一律是 card-dsl Expr）：
 * - amount: Expr（必填）—— 结算时经 ctx.evaluate 求值，必须得到非负安全整数。
 *   0 表示“抽 0 张”：不提交任何 GameAction，直接 executed 并把 0 写入链接值。
 * - target?: string —— TargetSpec 的 id，经 ctx.targets(id) 读取目标引用。本原语
 *   用这些引用来锚定“这条抽牌指令作用于哪些对象”：全部引用失效（对象已离区、
 *   旧 zoneEntryId）→ ignored（reason "mistargeted"）；部分失效时只用仍有效的
 *   引用，并取这些对象当前控制者作为抽牌者（“其控制者抽 N”的封闭式写法）。
 *   注意：如果对象是被*先前指令*杀掉/移走的（如 ogn-213-298 Hidden Blade 的
 *   “Its controller draws 2”），该环节的 Cards 文本应改经 player + linked
 *   表达式读取链接值（359.3.e.13 回看 + 359.3.e.14 链接指令），而不是让本指令
 *   重新校验一个已经失效的目标。
 * - pick?: string —— PickSpec 的 id，经 ctx.picks(id) 读取非目标选择。条目可以是
 *   PlayerId 字符串，也可以是 ObjectRef（取其当前控制者，已离区则取最后已知
 *   控制者；355.10.a 指出手牌等非公开区域的牌不是 target，这类“选择手牌/其他
 *   隐藏对象的控制者”应走 pick 而不是 target）。pick 不是目标，不触发“成为目标”
 *   相关触发。
 * - player?: PlayerId | Expr —— 显式抽牌者。Expr 求值结果可以是 PlayerId 字符串、
 *   ObjectRef（取当前/最后已知控制者），或它们的数组（候选者）。“其控制者抽 N”
 *   的链接指令写法即 player = linked-value（该对象引用），359.3.e.13 的回看正是
 *   本路径读取 lastKnown 的依据。省略 player、pick、target 时默认 ctx.controller
 *   （CR 190.6.d 的隐含 “you”）。
 * - choice?: { id, chooser?, visibility?, prompt? } —— 当候选抽牌者多于一个时，
 *   经 ctx.choose() 挂起询问（type "mode"，options 为候选 PlayerId，重放式）。
 *   无 choice 且候选多于一个 → negated（impossible，选择不明确）；候选只有一个
 *   时不提问，直接使用该玩家。
 * - linkKey?: string —— 实际抽到张数的链接键，默认 "drawn"；另固定写入
 *   "drawnTo"（实际抽牌者），供 “if you do” / “that player” 引用。
 *
 * 与相近原语的边界：
 * - effect.zone / move-zone：把某张已知对象移到手牌是区域移动，不是抽牌；抽牌
 *   没有“选哪张”的自由度（414.1.a），所以本原语不接受对象选择。
 * - effect.inspect（look / search）与 effect.reveal：查看、挑选、展示牌面信息；
 *   本原语不看也不展示任何牌面，牌库顶选择与隐私投影归内核。
 * - effect.recycle / mill / channel：不同区域、不同目的地、不同 GameAction；
 *   本原语只走封闭集合里的 "draw"。
 * - effect.damage 的 “deal N. Draw N.” 这类多指令卡：两条指令各自独立；抽牌
 *   不受伤害动作是否被替代影响，除非它通过 linkedTo 直接引用该动作。
 *
 * 结果（契约 3.3 / 3.6 原语规则 1–3）：
 * - 全部 perform done → executed；链接实际张数（"drawn"，内核返回结果优先，
 *   否则回退到请求数量）与实际抽牌者（"drawnTo"）。
 * - target 引用全部失效 → ignored（reason "mistargeted"）。
 * - 任一 perform replaced/prevented/impossible → negated；reason 映射：
 *   replaced → "replaced"，prevented → "skipped"，impossible → "impossible"。
 * - 确定性：不读时间、不用随机；唯一的选择入口是 ctx.choose()。
 * - 只经 ResolveContext 读写：读 targets/picks/player/object/lastKnown/evaluate，
 *   写只通过 perform({ type: "draw" }) 与 link；不直接改状态、不推进优先权。
 */

/** 抽牌者选择的挂起式询问配置（候选多于一个时使用）。 */
export interface EffectDrawChoice {
  /** 稳定的重放请求 id（引擎以它为 ChoiceRequest id）。 */
  readonly id: string;
  /** 做出选择的玩家；Expr 求值为 PlayerId，默认 ctx.controller。 */
  readonly chooser?: Expr;
  /** 选择的可见性，默认 "public"（抽牌者身份不是隐藏信息）。 */
  readonly visibility?: ChoiceVisibility;
  /** 展示给玩家的提示文本。 */
  readonly prompt?: string;
}

/** effect.draw 的 EffectIR 参数；值一律为 card-dsl Expr 或静态 id。 */
export interface EffectDrawArgs {
  /** 抽牌数量，结算时求值的 Expr（非负安全整数）。 */
  readonly amount: Expr;
  /** TargetSpec id；目标引用锚定本指令并决定默认抽牌者（其控制者）。 */
  readonly target?: string;
  /** PickSpec id；非目标选择的抽牌者候选（PlayerId 或 ObjectRef）。 */
  readonly pick?: string;
  /** 显式抽牌者：PlayerId 字符串或求值为 PlayerId / ObjectRef / 其数组的 Expr。 */
  readonly player?: PlayerId | Expr;
  /** 候选多于一个时的重放式选择配置。 */
  readonly choice?: EffectDrawChoice;
  /** 实际抽到张数的链接键，默认 "drawn"。 */
  readonly linkKey?: string;
}

const EXPR_KINDS: ReadonlySet<string> = new Set([
  "constant",
  "literal",
  "object-property",
  "object-attribute",
  "linked-value",
  "linked",
  "count"
]);

const ARG_KEYS: ReadonlySet<string> = new Set([
  "amount",
  "target",
  "pick",
  "player",
  "choice",
  "linkKey"
]);

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

function parseChoice(value: unknown): EffectDrawChoice {
  if (!isRecord(value)) throw new TypeError("effect.draw choice must be an object");
  if (!isId(value.id)) throw new TypeError("effect.draw choice.id must be a non-empty string");
  if (value.chooser !== undefined && !isExpr(value.chooser)) {
    throw new TypeError("effect.draw choice.chooser must be an Expr");
  }
  if (value.visibility !== undefined && value.visibility !== "public" &&
      value.visibility !== "chooser-only" &&
      !(Array.isArray(value.visibility) && value.visibility.every(isId))) {
    throw new TypeError("effect.draw choice.visibility is invalid");
  }
  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    throw new TypeError("effect.draw choice.prompt must be a string");
  }
  const extra = Object.keys(value).filter(key =>
    !["id", "chooser", "visibility", "prompt"].includes(key));
  if (extra.length > 0) {
    throw new TypeError(`Invalid effect.draw choice argument: ${extra[0]}`);
  }
  return value as unknown as EffectDrawChoice;
}

function parseArgs(value: unknown): EffectDrawArgs {
  if (!isRecord(value)) throw new TypeError("effect.draw args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.has(key)) throw new TypeError(`Invalid effect.draw argument: ${key}`);
  }
  if (!isExpr(value.amount)) throw new TypeError("effect.draw args.amount must be an Expr");
  const sources = [value.target, value.pick, value.player].filter(entry => entry !== undefined);
  if (sources.length > 1) {
    throw new TypeError("effect.draw accepts only one of target, pick, or player");
  }
  if (value.target !== undefined && !isId(value.target)) {
    throw new TypeError("effect.draw args.target must be a non-empty TargetSpec id");
  }
  if (value.pick !== undefined && !isId(value.pick)) {
    throw new TypeError("effect.draw args.pick must be a non-empty PickSpec id");
  }
  if (value.player !== undefined && !isId(value.player) && !isExpr(value.player)) {
    throw new TypeError("effect.draw args.player must be a PlayerId or an Expr");
  }
  if (value.choice !== undefined) parseChoice(value.choice);
  if (value.linkKey !== undefined && !isId(value.linkKey)) {
    throw new TypeError("effect.draw args.linkKey must be a non-empty string");
  }
  if (value.linkKey === "drawnTo") {
    throw new TypeError("effect.draw args.linkKey cannot shadow the reserved \"drawnTo\" key");
  }
  return value as unknown as EffectDrawArgs;
}

const argsSchema: Schema<EffectDrawArgs> = {
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

/** 把 player/pick 表达式结果规范化为候选抽牌者；非法形状返回 null。 */
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

/** 解析唯一抽牌者；target 全部失效 → ignored，形状/选择非法 → impossible。 */
function resolveRecipient(ctx: ResolveContext, args: EffectDrawArgs): RecipientResolution {
  let candidates: PlayerId[] | null;
  if (args.target !== undefined) {
    const current = ctx.targets(args.target).filter(ref => ctx.object(ref) !== null);
    if (current.length === 0) return { status: "ignored" };
    candidates = current.map(ref => controllerOf(ctx, ref));
  } else if (args.pick !== undefined) {
    candidates = playerCandidates(ctx, ctx.picks(args.pick));
  } else if (args.player !== undefined) {
    const value = typeof args.player === "string" ? args.player : ctx.evaluate(args.player);
    candidates = playerCandidates(ctx, value);
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

const effectDraw = {
  op: "effect.draw",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectDrawArgs): InstructionResult {
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

    const linkKey = args.linkKey ?? "drawn";
    const events: GameEvent[] = [];
    let drawn = 0;
    if (amount > 0) {
      const outcome = ctx.perform({ type: "draw", player: recipient.player, amount });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        return { status: "negated", reason: negatedReason(outcome.status), events };
      }
      drawn = typeof outcome.result === "number" && Number.isSafeInteger(outcome.result) &&
        outcome.result >= 0 ? outcome.result : amount;
    }

    const linkedValues: Record<string, Value> = { drawnTo: recipient.player };
    linkedValues[linkKey] = drawn;
    ctx.link(linkKey, drawn);
    ctx.link("drawnTo", recipient.player);
    return { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<EffectDrawArgs>;

export default effectDraw;
