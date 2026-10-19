import type { Expr, GameEvent, InstructionDef, ObjectFilter, ObjectRef, ResolveContext, Schema, Value } from "../contract.js";

/**
 * effect.kill —— 消灭（Kill）原语。
 *
 * 依据（Core Rules v1.5）：
 * - 429. Kill：消灭是永久物从场上进入弃牌堆的动作（429.1），只有起点在 Board 任一区域才算被消灭
 *   （429.2.a），且消灭不是移动的子集（429.2.b）。
 * - 429.1.a.1：本原语对应主动消灭（Active Kill），即游戏效果指令或卡牌/能力费用指示的消灭
 *   （"Kill Instruction"，429.1.a.1.a）。被动消灭（被动死因清理 / Lethal Damage，429.1.a.2、
 *   429.4、323.4）由回合清理流程负责，不走本原语。
 * - 429.3：消灭是受限动作（Limited Action），只有游戏效果指示时才能消灭。
 * - 429.6：官方格式为 "Kill [one or more permanents]"，如 "Kill an enemy unit."、
 *   "Kill this, [2]: Draw 1."（自身消灭费用）。
 *
 * 参数（args）：
 * - `target`?: string —— TargetSpec 的 id，经 `ctx.targets(id)` 取得结算时仍然合法的目标集合
 *   （目标选择在 Finalize 完成并触发"成为目标"类触发，见契约 3.4 picks 与 targets 的区分、
 *   卡牌如 ogn-229-298 Vengeance "Kill a unit."、unl-159-219 Soul Harvest）。
 * - `picks`?: string —— PickSpec 的 id，经 `ctx.picks(id)` 取得非目标选择的 ObjectRef
 *   （不触发"成为目标"触发，见 CR v1.5 与契约 3.4）。
 * - `objects`?: Expr —— 结算时求值为 `{ kind: "query", filter }`、
 *   `{ linked: id }`（也接受 `{ kind: "linked", id }`），或单个 ObjectRef。query 经 `ctx.query(filter)` 读取当前
 *   Board 特征集合（355.10.d），不经过目标锁定管线；linked 经 `ctx.linked(id)` 读取
 *   前序指令的实际结果。两者都只接受仍指向同一 zone incarnation 的 Board 对象。
 *   多对象集合的同步死亡由内核的 batch action 负责；本契约目前没有该能力，因此这里
 *   对多于一个对象的结果返回 negated(impossible)，不以逐条 kill 伪装同时死亡。
 * - `count`?: Expr —— 消灭数量。省略时消灭全部已解析对象；否则把已解析对象交给
 *   `ctx.choose`（select-objects）让玩家决定消灭哪些（重放式挂起，契约 3.6 choose），
 *   按选择顺序消灭。数量 0 时什么都不消灭（executed，0 个事件）；超过可用数按不可能处理
 *   （目标选择在 Finalize 已受 TargetSpec.max 约束，结算时数量无法满足视为不可能）。
 * - `self`?: boolean —— 为 true 时无视 target/picks，直接消灭能力来源 `ctx.source`
 *   （对应 "Kill this, ..." 费用结构，如 M1 unl-136-219 Scryer's Bloom、unl-161-219 Divining
 *   Shells，以及 unl-048-219 Trevor Snoozebottom 造出的 Temporary 衍生物的 "kill this"，CR 816.1.b）。
 * - `reason`?: string —— 消灭归因备注（429.5：消灭归因于包含消灭指令的卡牌或能力；
 *   费用消灭与效果消灭的区分由编译端用 `cost.sacrifice` / 本原语分开建模，见 RIFT-9 调研
 *   ability-templates.md cost.sacrifice 行）。仅作事件备注，不改变结算。
 *
 * 与相近原语的边界（"消灭与被替代的死亡分开"，RIFT-9 第 4 节）：
 * - 本原语只提交 `{ type: "kill" }` 游戏动作；动作是否被替代（如 CR 369.1 例 Zhonya's
 *   Hourglass "The next time a friendly unit would die, kill this instead"）由替代效果在动作执行
 *   前拦截。替代发生时本指令按契约 3.6 原语规则 2 返回 `negated`，不自己实现替代语义。
 * - 与 `effect.zone` 的区别：消灭（429.2.b "not a subset of Move"）走 kill 动作并触发死亡类
 *   时点/触发（如 Deathknell，429.1.a.1.b），区域移动不触发；与被动死亡（伤害清理）的区别
 *   见 429.1.a.2 / 323.4，本原语不处理。
 *
 * 结果（契约 3.6 原语规则 2、3.4 "被忽略与被否定的指令"）：
 * - 所有 `perform` 均 done → `executed`，并把实际消灭的对象引用数组写入 `ctx.link("killed")`，
 *   供 "if you do" 等后续指令读取（429.5.b 归因对象为能力来源 `ctx.source`）。
 * - 任一 `perform` 为 replaced/prevented/impossible → `negated`（reason 对应映射；
 *   契约无 "prevented" reason 值，prevented 按语义归入 "impossible"）。
 * - 目标全部失效（对象已离区、旧 zoneEntryId 引用经 `ctx.object` 取回 null）→ `ignored`
 *   （reason "mistargeted"，契约 3.4：目标选错 → ignored，其后链接指令也 ignored）。
 *
 * 确定性：不读时间、不用随机；选择一律经 `ctx.choose`，数量一律经 `ctx.evaluate` 求值。
 */

/** 对象来源：target、picks、query、linked 或 self。 */
export type KillSourceKind = "target" | "picks" | "query" | "linked" | "self";

/** 非目标的当前集合选择。 */
export type KillSelection =
  | { readonly kind: "query"; readonly filter: ObjectFilter }
  | { readonly kind: "linked"; readonly id: string; readonly key?: string };

/** effect.kill 的参数；见文件头 JSDoc。 */
export interface KillArgs {
  /** TargetSpec id；与 picks/self 至少提供一个（self 为 true 时可都省略）。 */
  readonly target?: string;
  /** PickSpec id；取得的对象必须是 ObjectRef。 */
  readonly picks?: string;
  /** 结算时的非目标集合选择；与 target/picks/self 互斥。 */
  readonly objects?: Expr | KillSelection | ObjectRef;
  /** 为 true 时消灭能力来源自身（"Kill this"）。 */
  readonly self?: boolean;
  /** 消灭数量；省略表示全部已解析对象。求值结果必须是非负整数。 */
  readonly count?: Expr;
  /** 归因备注，写入事件 details，不影响结算。 */
  readonly reason?: string;
}

/** 已解析出的待消灭对象及其来源。 */
interface ResolvedKillObject {
  readonly ref: ObjectRef;
  readonly via: KillSourceKind;
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

function isExpr(value: unknown): value is Expr {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly kind?: unknown };
  return typeof candidate.kind === "string" && EXPR_KINDS.has(candidate.kind);
}

function isObjectRef(value: unknown): value is ObjectRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly id?: unknown; readonly zoneEntryId?: unknown };
  return typeof candidate.id === "string" && candidate.id.length > 0 &&
    Number.isSafeInteger(candidate.zoneEntryId) && (candidate.zoneEntryId as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if ((!isRecord(value) && !Array.isArray(value)) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function parseSelection(value: unknown): KillSelection | ObjectRef {
  if (isObjectRef(value)) return value;
  if (!isRecord(value)) throw new Error("effect.kill args.objects must be a query, linked selector, or ObjectRef");
  if (value.kind === "query") {
    if (!isRecord(value.filter) || !isValue(value.filter)) {
      throw new Error("effect.kill query selection requires an object filter");
    }
    return { kind: "query", filter: value.filter as ObjectFilter };
  }
  if (value.kind === "linked") {
    const key = typeof value.key === "string" && value.key.length > 0 ? value.key : undefined;
    const id = typeof value.id === "string" ? value.id : key ??
      (typeof value.instructionId === "string" ? value.instructionId : undefined);
    if (id === undefined || id.length === 0) {
      throw new Error("effect.kill linked selection requires a non-empty id");
    }
    if (value.key !== undefined && key === undefined) {
      throw new Error("effect.kill linked selection key must be a non-empty string");
    }
    return { kind: "linked", id };
  }
  // ObjectSelector spelling used by the shared interpreter: { linked: id }.
  if (Object.keys(value).length === 1 && typeof value.linked === "string" && value.linked.length > 0) {
    return { kind: "linked", id: value.linked };
  }
  throw new Error("effect.kill args.objects must be a query, linked selector, or ObjectRef");
}

function isQuerySelection(value: KillSelection | ObjectRef): value is Extract<KillSelection, { kind: "query" }> {
  return !isObjectRef(value) && value.kind === "query";
}

function parseArgs(value: unknown): KillArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("effect.kill args must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const target = candidate.target;
  const picks = candidate.picks;
  const rawObjects = candidate.objects;
  const self = candidate.self;
  const count = candidate.count;
  const reason = candidate.reason;
  if (target !== undefined && typeof target !== "string") {
    throw new Error("effect.kill args.target must be a TargetSpec id string");
  }
  if (picks !== undefined && typeof picks !== "string") {
    throw new Error("effect.kill args.picks must be a PickSpec id string");
  }
  const objects = rawObjects === undefined ? undefined : isExpr(rawObjects) ? rawObjects : parseSelection(rawObjects);
  if (self !== undefined && typeof self !== "boolean") {
    throw new Error("effect.kill args.self must be a boolean");
  }
  if (count !== undefined && !isExpr(count)) {
    throw new Error("effect.kill args.count must be an Expr");
  }
  if (reason !== undefined && typeof reason !== "string") {
    throw new Error("effect.kill args.reason must be a string");
  }
  const hasSource = self === true || target !== undefined || picks !== undefined || objects !== undefined;
  if (!hasSource) {
    throw new Error("effect.kill requires args.target, args.picks, args.objects, or args.self: true");
  }
  if (objects !== undefined && (self === true || target !== undefined || picks !== undefined)) {
    throw new Error("effect.kill args.objects cannot be combined with another object source");
  }
  return { target, picks, objects, self, count, reason };
}

const argsSchema: Schema<KillArgs> = { parse: parseArgs };

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function linkedRefs(value: Value | undefined): ObjectRef[] {
  const refs: ObjectRef[] = [];
  const visit = (entry: unknown): void => {
    if (isObjectRef(entry)) refs.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (isRecord(entry)) {
      if (Array.isArray(entry.objects)) entry.objects.forEach(visit);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  const seen = new Set<string>();
  return refs.filter(ref => !seen.has(refKey(ref)) && seen.add(refKey(ref)));
}

function linkedValue(ctx: ResolveContext, selection: Extract<KillSelection, { kind: "linked" }>): Value | undefined {
  if (selection.key === undefined) return ctx.linked(selection.id);
  return ctx.linked(`${selection.id}.${selection.key}`) ??
    ctx.linked(selection.key) ??
    ctx.linked(selection.id);
}

/** effect.kill 原语定义；默认导出供 scripts/gen-registries.mjs 收集进 instructions 注册表。 */
export default {
  op: "effect.kill",
  argsSchema,
  execute(ctx, args) {
    const resolved: ResolvedKillObject[] = [];
    let evaluatedSelection: KillSelection | ObjectRef | undefined;
    if (args.self === true) {
      resolved.push({ ref: ctx.source.ref, via: "self" });
    }
    if (args.target !== undefined) {
      for (const ref of ctx.targets(args.target)) {
        resolved.push({ ref, via: "target" });
      }
    }
    if (args.picks !== undefined) {
      for (const pick of ctx.picks(args.picks)) {
        if (!isObjectRef(pick)) continue;
        resolved.push({ ref: pick, via: "picks" });
      }
    }
    if (args.objects !== undefined) {
      const selection = isExpr(args.objects) ? parseSelection(ctx.evaluate(args.objects)) : args.objects;
      evaluatedSelection = selection;
      if (isObjectRef(selection)) resolved.push({ ref: selection, via: "linked" });
      else if (selection.kind === "query") {
        const refs = ctx.query(selection.filter).map(object => object.ref).sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : left.zoneEntryId - right.zoneEntryId);
        for (const ref of refs) resolved.push({ ref, via: "query" });
      } else {
        for (const ref of linkedRefs(linkedValue(ctx, selection))) resolved.push({ ref, via: "linked" });
      }
    }

    // 429.2.a：只有当前在 Board 上的对象才能被消灭；引用已失效（离区后旧 zoneEntryId）
    // 或已不在场上的对象不计入。目标全部失效 → ignored（mistargeted，契约 3.4）。
    const seen = new Set<string>();
    const alive: ResolvedKillObject[] = resolved.filter(entry => {
      if (seen.has(refKey(entry.ref))) return false;
      seen.add(refKey(entry.ref));
      const snapshot = ctx.object(entry.ref);
      return snapshot !== null && snapshot.zone === "board";
    });
    if (alive.length === 0 && evaluatedSelection !== undefined && isQuerySelection(evaluatedSelection)) {
      ctx.link("killed", []);
      return { status: "executed", events: [], linkedValues: { killed: [] } };
    }
    if (alive.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }

    let selected: readonly ResolvedKillObject[] = alive;
    if (args.count !== undefined) {
      const evaluated = ctx.evaluate(args.count);
      if (typeof evaluated !== "number" || !Number.isInteger(evaluated) || evaluated < 0) {
        throw new Error(`effect.kill count must evaluate to a non-negative integer, got ${JSON.stringify(evaluated)}`);
      }
      if (evaluated === 0) {
        // 消灭 0 个：无事发生但指令成立，链接空数组供 "if you do" 判空。
        ctx.link("killed", []);
        return { status: "executed", events: [], linkedValues: { killed: [] } };
      }
      if (evaluated > alive.length) {
        return { status: "negated", reason: "impossible", events: [] };
      }
      if (evaluated === alive.length) {
        selected = alive;
      } else {
        const choice = ctx.choose<ObjectRef[]>({
          id: `effect.kill:${ctx.source.ref.id}:${ctx.timingPoint}`,
          type: "select-objects",
          chooser: ctx.controller,
          visibility: "public",
          options: alive.map(entry => entry.ref),
          min: evaluated,
          max: evaluated
        });
        const order = new Map(choice.map((ref, index) => [`${ref.id}:${ref.zoneEntryId}`, index] as const));
        selected = alive
          .filter(entry => order.has(`${entry.ref.id}:${entry.ref.zoneEntryId}`))
          .sort((a, b) => (order.get(`${a.ref.id}:${a.ref.zoneEntryId}`) ?? 0) - (order.get(`${b.ref.id}:${b.ref.zoneEntryId}`) ?? 0));
      }
    }

    // CR 370.1.a.2: all objects affected by one Kill Instruction die as one
    // event. ResolveContext exposes only a single-object kill action, so the
    // new query/linked set form cannot execute more than one current object.
    // Existing target/picks collections retain their established primitive
    // behavior while the shared batch contract is supplied by its owner.
    if (args.objects !== undefined && selected.length > 1) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    const events: GameEvent[] = [];
    const killed: ObjectRef[] = [];
    for (const entry of selected) {
      const outcome = ctx.perform({ type: "kill", object: entry.ref });
      events.push(...outcome.events);
      // 契约 3.6 原语规则 2：任一动作被替代/阻止/不可能 → negated。
      // "消灭与被替代的死亡分开"：替代语义由替代效果处理，本原语只如实上报。
      if (outcome.status !== "done") {
        return {
          status: "negated",
          reason: outcome.status === "replaced" ? "replaced" : "impossible",
          events
        };
      }
      killed.push(entry.ref);
    }

  ctx.link("killed", killed as unknown as Value);
  return {
    status: "executed",
    events,
    linkedValues: { killed: killed as unknown as Value }
  };
  }
} satisfies InstructionDef<KillArgs>;
