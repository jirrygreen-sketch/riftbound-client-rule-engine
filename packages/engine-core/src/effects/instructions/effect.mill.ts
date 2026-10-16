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

/**
 * effect.mill — Burn / 卡库到弃牌区（把一名玩家主牌库顶的若干张牌放进其弃牌区）。
 *
 * 规则依据（Core Rules v1.5 条目号）：
 * - 441.1：Burning 就是“把一名玩家主牌库顶的牌移动到其弃牌区”这一动作；本原语即该动作。
 * - 441.2 / 441.2.a：动作格式为 "Burn X."，X 是要烧的牌数；本原语把 X 当结算时求值的
 *   amount，不在 IR 里预先结算。
 * - 441.3 / 441.3.a：Burning 是 Limited Action，只有游戏效果或费用指示时才执行；本原语
 *   只覆盖“效果指示烧牌”，回合流程、费用支付等不在这里。
 * - 441.4：作为效果的一部分，玩家必须尽可能多地烧牌；牌库不足时先烧光、触发 Burn Out，
 *   再继续烧剩余数量。Burn Out 的回收、随机化、计分与重烧全部归内核（432.1.b、
 *   432.2.a–d、432.3.x），本原语只读取 GameAction 的实际结果，把“不足”当成功而不是失败。
 * - 441.1.a："When you burn" 触发在烧牌发生之后结算；触发与进链是时点/触发管线的职责，
 *   本原语只在动作完成后写入链接值，不自己发触发、不往链上加项。
 * - 108.4.d / 108.4.e：主牌库张数是 Public Information，牌的先后顺序是 Secret Information；
 *   本原语只在引擎内部读写真实区域顺序，不做面向玩家的信息投影（投影归服务端）。
 * - 124 / 124.1：牌离开主牌库进入弃牌区（非棋盘区域）后成为新对象，旧 zoneEntryId 失效；
 *   所以本原语在动作前按真实区域顺序取引用、动作后只保留确实离区的引用，后续 "the burned
 *   card" / "that card" 类指令依赖 359.3.e.13 的回看（look back）读取最后已知特征。
 * - 355.7 / 355.10.a / 355.10.c / 355.10.e / 355.10.f：选中具体对象才是 Target；隐藏区域
 *   里的牌、由玩家（含其他玩家）选择的对象、以及“必须完成”的指示都不是 Target，走 pick。
 *   牌库顶的牌不可被选为目标，所以本原语不通过 Target 选择“烧哪几张牌”。
 * - 359.3.e.5–e.8：目标在结算时部分失效则只用仍合法的部分继续执行；全部失效则整条指令
 *   不执行（ignored）。
 * - 359.3.e.11：能部分执行就部分执行；因此牌库不足不是 negated。
 * - 190.6.d：省略 player / target / pick 时，隐含的 "you" 取 ctx.controller。
 *
 * 参数（值一律为 card-dsl Expr，结算时经 ctx.evaluate 求值；同时兼容解释器已求值的字面值，
 * 两种调用约定都支持）：
 * - amount（必填）：要烧的牌数，求值结果必须是非负安全整数。0 表示 "Burn 0"：不提交任何
 *   GameAction，直接 executed 并链接 0；负数 / 非整数 / 非数字 → negated（impossible）。
 * - target（可选）：TargetSpec id，经 ctx.targets(id) 读取 Finalize 锁定、Resolve 重验后仍
 *   合法的目标。目标只提供“谁来烧”：取仍合法目标的控制者作为候选烧牌者（对应 "its
 *   controller burns N" / "that player burns N" 这类写法，359.3.e.13 的回看）。引用全部失效
 *   （对象已离区、旧 zoneEntryId）→ ignored（reason "mistargeted"，契约 3.6 原语规则 2）。
 * - pick（可选）：PickSpec id，经 ctx.picks(id) 读取非目标选择；条目可以是 PlayerId 字符串，
 *   也可以是 ObjectRef（取其当前控制者，已离区则取最后已知控制者）。pick 不是 Target，不触发
 *   “成为目标”相关触发（355.10.c/e/f、契约 3.4）。
 * - player（可选）：显式烧牌者。求值结果可以是 PlayerId 字符串、ObjectRef（取其当前 / 最后
 *   已知控制者），或它们的数组（候选者）。
 * - choice（可选）：候选烧牌者多于一个时经 ctx.choose() 挂起询问（type "mode"，options 为候选
 *   PlayerId，重放式）。缺省 chooser 为 ctx.controller，缺省 visibility 为 "public"。没有
 *   choice 而候选多于一个 → negated（impossible，选择不明确）；候选只有一个时不提问。
 * - target / pick / player 三者互斥；都不给时烧牌者为 ctx.controller（190.6.d 的隐含 "you"）。
 *
 * 链接值（ctx.link，写入实际结果供 "if you do" / "that card" 引用）：
 * - burned：本次动作中确实离开主牌库顶的卡引用数组，按“从顶到底”的燃烧顺序排列；
 * - burnedCount：实际燃烧张数，取内核返回的真实张数（缺失时回退为观察到的离区张数）；
 * - burnedCard：本轮最上面的一张被烧的卡（Burn 1 的 "the burned card" / "that card" 场景），
 *   没有烧到牌时为 null；多张时用 burned 数组；
 * - burnedPlayer：实际烧牌（牌库被烧）的玩家。
 * 由于 124 让被烧的牌成为新对象，这些引用在后续指令里只能经 359.3.e.13 回看最后已知特征
 * （例如 ven-108-166 的 "the burned card's Might"）。若本次烧牌触发了 Burn Out，回收后继续
 * 燃烧的部分由内核完成，本原语无法枚举那部分新引用；此时 burnedCount 仍是内核返回的真实
 * 张数，而 burned 只包含动作开始时就在主牌库顶、并被观察到离区的那些卡。
 *
 * 与相近原语的边界：
 * - effect.zone / move-zone：移动“已被指名的对象”到指定区域；隐藏的主牌库顶不能当目标，也
 *   不得用 query 推断区域内顺序（RIFT-66 契约：牌库顶 / 底只能用 zoneSlice）。
 * - effect.draw：主牌库顶 → 手牌；本原语是主牌库顶 → 弃牌区。
 * - effect.recycle：把牌放回牌库底部；方向相反。
 * - effect.channel：符文牌库顶 → 棋盘符文区；不同区域、不同目的地。
 * - effect.discard：从手牌弃牌；effect.inspect / effect.reveal：查看 / 展示牌面，不移动。
 * - "put the top N cards of your Main Deck into your trash"（sfd-212-221 Minefield 等）与
 *   441.1 的 Burning 是同一动作，同样走本原语；结算差异只在卡面文字格式。
 *
 * 结果（契约 3.3、3.6 原语规则 1–3）：
 * - 全部 perform done → executed，实际结果写入 ctx.link；
 * - 任一 perform 为 replaced / prevented / impossible → negated（reason 映射：replaced →
 *   "replaced"，prevented → "skipped"，impossible → "impossible"）；
 * - 目标（target）引用全部失效 → ignored（reason "mistargeted"）；
 * - 确定性：不读时间、不用随机；唯一的选择入口是 ctx.choose()，同一输入与同一答案必得同一结果。
 * - 只经 ResolveContext 读写：读 targets / picks / object / lastKnown / zoneSlice / evaluate / player，
 *   写只通过 perform({ type: "mill" }) 与 link；不直接改状态、不推进优先权。
 */

/** 候选烧牌者多于一个时的挂起式询问配置。 */
export interface EffectMillChoice {
  /** 稳定的重放请求 id（引擎以它为 ChoiceRequest id）。 */
  readonly id: string;
  /** 做出选择的玩家（Expr 或 PlayerId），缺省 ctx.controller。 */
  readonly chooser?: Expr | PlayerId;
  /** 选择的可见性，缺省 "public"（烧牌者身份不是隐藏信息）。 */
  readonly visibility?: ChoiceVisibility;
  /** 展示给玩家的提示文本。 */
  readonly prompt?: string;
}

/** effect.mill 的 EffectIR 参数；Expr 与解释器已求值的字面值都接受。 */
export interface EffectMillArgs {
  /** 要烧的牌数（Burn X 的 X），结算时求值的非负安全整数。 */
  readonly amount: Expr | Value;
  /** TargetSpec id；取仍合法目标的控制者作为候选烧牌者。 */
  readonly target?: Expr | string;
  /** PickSpec id；非目标选择，条目为 PlayerId 或 ObjectRef。 */
  readonly pick?: Expr | string;
  /** 显式烧牌者：PlayerId、ObjectRef，或其数组，也可是求值的 Expr。 */
  readonly player?: Expr | Value;
  /** 候选多于一个时的重放式选择配置。 */
  readonly choice?: Expr | EffectMillChoice;
}

const ARG_KEYS: readonly string[] = ["amount", "target", "pick", "player", "choice"];
const CHOICE_KEYS: readonly string[] = ["id", "chooser", "visibility", "prompt"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string" && value.kind.length > 0;
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && value.length > 0;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isPlayerId(value.id) &&
    Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isVisibility(value: unknown): value is ChoiceVisibility {
  return value === "public" || value === "chooser-only" ||
    (Array.isArray(value) && value.every(isPlayerId));
}

function reject(message: string): never {
  throw new TypeError("effect.mill args: " + message);
}

function checkSpecId(value: unknown, field: string): void {
  if (isExpr(value)) return;
  if (!isPlayerId(value)) reject(field + " must be a TargetSpec / PickSpec id or an Expr");
}

function checkPlayer(value: unknown, field: string): void {
  if (isExpr(value) || isPlayerId(value)) return;
  if (Array.isArray(value)) {
    if (value.length === 0) reject(field + " must not be an empty candidate list");
    if (!value.every(entry => isPlayerId(entry) || isObjectRef(entry))) {
      reject(field + " must contain only PlayerId or ObjectRef candidates");
    }
    return;
  }
  if (isObjectRef(value)) return;
  reject(field + " must be a PlayerId, ObjectRef, candidate list, or Expr");
}

function checkChoice(value: unknown): void {
  if (isExpr(value)) return;
  if (!isRecord(value)) reject("choice must be an object or an Expr");
  for (const key of Object.keys(value)) {
    if (!CHOICE_KEYS.includes(key)) reject("Invalid effect.mill choice argument: " + key);
  }
  if (!isPlayerId(value.id)) reject("choice.id must be a non-empty string");
  if (value.chooser !== undefined && !isExpr(value.chooser) && !isPlayerId(value.chooser)) {
    reject("choice.chooser must be a PlayerId or an Expr");
  }
  if (value.visibility !== undefined && !isVisibility(value.visibility)) {
    reject("choice.visibility is invalid");
  }
  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    reject("choice.prompt must be a string");
  }
}

function parseArgs(value: unknown): EffectMillArgs {
  if (!isRecord(value)) reject("args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.includes(key)) reject("Invalid effect.mill argument: " + key);
  }
  if (!isExpr(value.amount) && !isNonNegativeInteger(value.amount)) {
    reject("amount must be an Expr or a nonnegative safe integer");
  }
  if (value.target !== undefined) checkSpecId(value.target, "target");
  if (value.pick !== undefined) checkSpecId(value.pick, "pick");
  if (value.player !== undefined) checkPlayer(value.player, "player");
  if (value.choice !== undefined) checkChoice(value.choice);
  const sources = [value.target, value.pick, value.player].filter(entry => entry !== undefined);
  if (sources.length > 1) reject("accepts only one of target, pick, or player");
  return value as unknown as EffectMillArgs;
}

const argsSchema: Schema<EffectMillArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

/** Expr 经 ctx.evaluate 求值（取值时机即调用时，契约 3.6）；已求值的字面值原样返回。 */
function evaluateValue(ctx: ResolveContext, value: Expr | Value): Value {
  return isExpr(value) ? ctx.evaluate(value) : value;
}

function controllerOf(ctx: ResolveContext, ref: ObjectRef): PlayerId {
  return ctx.object(ref)?.controller ?? ctx.lastKnown(ref).controller;
}

function cloneRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

/** 把 player / pick 表达式结果规范化为候选烧牌者；非法形状返回 null。 */
function playerCandidates(ctx: ResolveContext, value: unknown): PlayerId[] | null {
  if (value === undefined || value === null) return null;
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return null;
  const players: PlayerId[] = [];
  for (const entry of entries) {
    if (isPlayerId(entry)) players.push(entry);
    else if (isObjectRef(entry)) players.push(controllerOf(ctx, entry));
    else return null;
  }
  return players;
}

interface ResolvedChoice {
  readonly id: string;
  readonly chooser: PlayerId;
  readonly visibility: ChoiceVisibility;
  readonly prompt?: string;
}

/** 解析 choice 配置（Expr 先求值）；非法形状返回 null → impossible。 */
function resolveChoice(ctx: ResolveContext, raw: Expr | EffectMillChoice | undefined): ResolvedChoice | null {
  if (raw === undefined) return null;
  const value = isExpr(raw) ? ctx.evaluate(raw) : raw;
  if (!isRecord(value) || !isPlayerId(value.id)) return null;
  let chooser = ctx.controller;
  if (value.chooser !== undefined) {
    const evaluated = isExpr(value.chooser) ? ctx.evaluate(value.chooser) : value.chooser;
    if (!isPlayerId(evaluated)) return null;
    chooser = evaluated;
  }
  const visibility = value.visibility === undefined ? "public" : value.visibility;
  if (!isVisibility(visibility)) return null;
  if (value.prompt !== undefined && typeof value.prompt !== "string") return null;
  return {
    id: value.id,
    chooser,
    visibility,
    ...(value.prompt === undefined ? {} : { prompt: value.prompt })
  };
}

type MillerResolution =
  | { readonly status: "resolved"; readonly player: PlayerId }
  | { readonly status: "ignored" }
  | { readonly status: "impossible" };

/**
 * 解析唯一烧牌者：target 引用全部失效 → ignored；形状 / 候选 / 选择非法 → impossible。
 */
function resolveMiller(ctx: ResolveContext, args: EffectMillArgs): MillerResolution {
  let candidates: PlayerId[] | null;
  if (args.target !== undefined) {
    const specId = evaluateValue(ctx, args.target);
    if (!isPlayerId(specId)) return { status: "impossible" };
    const locked = ctx.targets(specId);
    const live = locked.filter(ref => ctx.object(ref) !== null);
    // 359.3.e.7：目标全部失效 ⇒ 本指令不执行。
    if (live.length === 0) return { status: "ignored" };
    candidates = live.map(ref => controllerOf(ctx, ref));
  } else if (args.pick !== undefined) {
    const specId = evaluateValue(ctx, args.pick);
    if (!isPlayerId(specId)) return { status: "impossible" };
    candidates = playerCandidates(ctx, ctx.picks(specId));
  } else if (args.player !== undefined) {
    candidates = playerCandidates(ctx, evaluateValue(ctx, args.player));
  } else {
    candidates = [ctx.controller];
  }
  if (candidates === null || candidates.length === 0) return { status: "impossible" };
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { status: "resolved", player: unique[0]! };
  const choice = resolveChoice(ctx, args.choice);
  if (choice === null) return { status: "impossible" };
  const answer = ctx.choose<PlayerId>({
    id: choice.id,
    type: "mode",
    options: unique,
    chooser: choice.chooser,
    visibility: choice.visibility,
    ...(choice.prompt === undefined ? {} : { prompt: choice.prompt })
  });
  if (!isPlayerId(answer) || !unique.includes(answer)) return { status: "impossible" };
  return { status: "resolved", player: answer };
}

/** 写入链接值并返回 executed 结果（实际结果同时回填到 linkedValues）。 */
function executed(
  ctx: ResolveContext,
  player: PlayerId,
  burned: readonly ObjectRef[],
  count: number,
  events: GameEvent[]
): InstructionResult {
  const burnedValues = burned.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
  const linkedValues: Record<string, Value> = {
    burned: burnedValues,
    burnedCount: count,
    burnedCard: burnedValues.length > 0 ? burnedValues[0]! : null,
    burnedPlayer: player
  };
  for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
  return { status: "executed", events, linkedValues };
}

function execute(ctx: ResolveContext, args: EffectMillArgs): InstructionResult {
  const resolution = resolveMiller(ctx, args);
  if (resolution.status === "ignored") return { status: "ignored", reason: "mistargeted" };
  if (resolution.status === "impossible") return { status: "negated", reason: "impossible", events: [] };

  const amountValue = evaluateValue(ctx, args.amount);
  if (!isNonNegativeInteger(amountValue)) {
    return { status: "negated", reason: "impossible", events: [] };
  }
  const player = resolution.player;

  // 441.2.a：Burn 0 什么都不做，仍然是成功结算。
  if (amountValue === 0) {
    return executed(ctx, player, [], 0, []);
  }

  // 441.4：牌库不足时尽可能多地烧；此处按真实区域顺序取候选引用（zoneSlice，不用 query）。
  // 未知玩家不属于“能部分执行”的情形：该玩家不存在时牌库也不存在 → negated（impossible）。
  let candidates: ObjectRef[];
  try {
    candidates = ctx.zoneSlice(player, "deck", "top", amountValue).map(snapshot => cloneRef(snapshot.ref));
  } catch (error) {
    // amount 已校验过，剩下的抛出原因只有“未知玩家”（没有主牌库）。
    if (!(error instanceof Error)) throw error;
    return { status: "negated", reason: "impossible", events: [] };
  }
  const outcome = ctx.perform({ type: "mill", player, amount: amountValue });
  const events: GameEvent[] = [...outcome.events];
  if (outcome.status !== "done") {
    return {
      status: "negated",
      reason: outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible",
      events
    };
  }

  // 124：离区后旧引用失效；只保留动作后确实不在原区域的引用，即观察到的被烧牌。
  const burned = candidates.filter(ref => ctx.object(ref) === null);
  const count = isNonNegativeInteger(outcome.result) ? outcome.result : burned.length;
  return executed(ctx, player, burned, count, events);
}

export default {
  op: "effect.mill",
  argsSchema,
  execute
} satisfies InstructionDef<EffectMillArgs>;
