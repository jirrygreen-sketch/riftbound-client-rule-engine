import type { Expr, GameEvent, InstructionDef, InstructionResult, ObjectFilter, ObjectRef, ObjectSnapshot, ResolveContext, Schema, Value } from "../contract.js";
import { bonusDamageForDeal, bonusDamageGrantsForDeal } from "../modifiers/query.js";
import type { ContinuousEffectRegistry } from "../../layers/duration.js";

/**
 * effect.damage — 造成 / 分配伤害（Deal Damage）。
 *
 * 目标集合（CR 355.5–355.14）二选一：
 * - target: string — 目标 TargetSpec 的 id；目标集合经 ctx.targets(id) 读取
 *   （Finalize 锁定、Resolve 重验后的仍合法目标）。这些目标在 Finalize 时
 *   已经发过 became-target（355.7），本原语不再发目标事件。
 * - objects?: Expr — 程序化非目标集合：求值结果为
 *   - { kind: "source" } — 效果来源对象（418.6.a 默认来源）；
 *   - { kind: "target" | "pick", id } — 已锁定目标 / 非目标 pick；
 *   - { kind: "query", filter } — 按特征程序化选出的集合（355.10.d）；
 *   - { kind: "choose", id, filter, min?, max? } — 结算时的非目标分辨率选择
 *    （355.10.e–f；选择者=效果控制者、公开可见、稳定 id、确定性排序）。
 *   - ObjectRef 或 ObjectRef[] — linked/前序指令已写出的引用集合（同
 *    effect.recycle objects 的非目标选择惯例）；非法引用像离区引用一样被过滤。
 *   目标描述符（target/pick）保持集合给定顺序；query/choose 按 id →
 *   zoneEntryId 推导性排序。该集合不是目标，不发 became-target（355.7/
 *   754.3.c），也支持已锁目标的 divide（355.14：分配选择 ≠ 锁定目标）。
 *
 * 参数（argsSchema 在解释器求值前校验 IR 形状）：
 * - amount: Expr — 结算时经 ctx.evaluate 求值的伤害基础数额（动态数额，
 *   如 "equal to its Might"，用 object-property / linked-value 等表达式；
 *   取值时机即调用时，契约 3.6）。
 * - source?: "self" | Expr — Deal 动作的来源。缺省为 "self"，即能力的来源对象
 *   （CR 418.6.a：未指定来源时，描述该 Deal 动作的效果即来源）。给出表达式
 *   时求值为 ObjectRef，用于 "它（某单位）造成伤害" 这类指定来源的卡牌
 *   （CR 418.6.b.3，如 sfd-107-221 Strike Down）。
 * - combat?: boolean — 是否为战斗伤害；透传给 GameAction "damage"（契约 3.6），
 *   效果原语通常为 false。
 * - bonus?: Expr — 本 Deal 动作获得的 Bonus Damage（CR 418.4 / 712–715）。
 *   每个目标分别加上该数额（715.2）；结果须为正，非正则不加（714.2）。
 * - divide?: true — 分配伤害（"split N damage"，CR 355.14）：每个目标分摊
 *   的数额到结算时才决定（355.14.e），因此在本原语受击集合确定后以
 *   type "number" 的 ctx.choose 逐目标挂起询问，选定为 effect 控制者；
 *   问完一次后重放时校验全部答案，任何非法答案都使本指令 negated
 *   （impossible），不会部分结算。objects（非目标集合）不可 divide：
 *   355.14 是对已锁定目标分配，非目标集合与分配目标语义不同。
 *
 * 语义边界（本原语不做的事）：
 * - 动态数额只在本原语内 evaluate；X 值的由来、Might 汇总（CR 142.4 相关
 *   计算）由表达式与图层系统负责。
 * - 同时伤害：对每个仍合法的目标分别提交一次 GameAction "damage"，对应
 *   CR 418.1.c（伤害分别标记在每个单位上）；418.1.d 的同时性由内核/事件
 *   管线表达（如合并为时点），原语不合并动作。
 * - Bonus Damage 的来源授予（如 Annie, Fiery "你的法术 +1"）通过
 *   `bonusDamageForDeal` 按 controller、Deal scope、source 汇总；
 *   显式 bonus 表达式保留为独立输入。两者相加后只施加一次（714），并在
 *   divide 前作用于总伤害（715.3）；没有实际 Deal 时不产生链接（715.4）。
 * - 超额分配（355.14.h，目标多于可分时由控制者裁撤目标）属于 target.many /
 *   目标系统职责；本原语只在答案非法（超出剩余、非正整数）时 negated。
 * - 0 与负数：CR 418.1.e/418.1.e.1 规定只有正整数伤害才会被造成。基础额
 *   加 bonus 后 ≤ 0 的伤害事件被跳过（不算 perform）；若因此没有任何
 *   perform 发生，本指令按契约 3.6 原语规则 2 返回 negated(impossible)。
 *
 * 结果（契约 3.3 / 3.6 原语规则 2）：
 * - target 集合为空或全部引用失效（对象已离区，旧 zoneEntryId）→ ignored。
 * - objects：query/choose 的空集合是合法的 no-effect executed（359.3.e.6–e.9），
 *   链接 dealt/dealtTo/dealtCount=0；choose 的 min>0 无候选 → negated
 *   (impossible)；target/pick 引用全部失效 → ignored（359.3.e.6/.9）。
 * - 任一 perform 为 replaced / prevented / impossible → negated（全部动作
 *   都已提交，由调用方/解释器决定后续链接指令照常执行）。
 * - 全部 done → executed；链接值：
 *   - dealt: 实际造成的伤害总量（供 "if you do" / 条件引用）
 *   - dealtTo: [{ target: ObjectRef, amount }] 每个目标实际受到的伤害
 *   - dealtCount: 实际受到伤害的目标数
 */

/** Args accepted before expression evaluation. */
export interface EffectDamageArgs {
  readonly amount: Expr;
  readonly target?: string;
  readonly objects?: Expr;
  readonly source?: "self" | Expr;
  readonly combat?: boolean;
  readonly bonus?: Expr;
  readonly divide?: true;
}

interface DamagePlanEntry {
  readonly target: ObjectRef;
  readonly amount: number;
}

/** A JSON-compatible record of damage actually dealt to one target. */
type DealtRecord = { readonly [key: string]: Value };

/** Non-target object set selector: same shapes as effect.heal's objects. */
type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "query"; readonly filter: ObjectFilter }
  | {
      readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter;
      readonly min: number; readonly max: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) &&
    typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId);
}

function isExpr(value: unknown): value is Expr {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Expr).kind === "string"
  );
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

function selection(value: unknown): Selection {
  if (isRecord(value)) {
    if (value.kind === "source") return { kind: "source" };
    if ((value.kind === "target" || value.kind === "pick") && isId(value.id)) {
      return { kind: value.kind, id: value.id };
    }
    if ((value.kind === "query" || value.kind === "choose") &&
        isRecord(value.filter) && isValue(value.filter)) {
      if (value.kind === "query") return { kind: "query", filter: value.filter };
      const max = value.max === undefined ? 1 : value.max;
      const min = value.min === undefined ? max : value.min;
      if (isId(value.id) && isAmount(min) && isAmount(max) && min <= max) {
        return { kind: "choose", id: value.id, filter: value.filter, min, max };
      }
    }
  }
  throw new TypeError("effect.damage args.objects must select source, target, pick, query, or choose");
}

function parseArgs(value: unknown): EffectDamageArgs {
  if (!isRecord(value)) {
    throw new Error("effect.damage args must be an object");
  }
  if (!isExpr(value.amount)) {
    throw new Error("effect.damage args.amount must be an Expr");
  }
  const hasTarget = value.target !== undefined;
  const hasObjects = value.objects !== undefined;
  if (hasTarget && hasObjects) {
    throw new Error("effect.damage args.target and args.objects are mutually exclusive");
  }
  if (hasTarget && (typeof value.target !== "string" || value.target.length === 0)) {
    throw new Error("effect.damage args.target must be a TargetSpec id string");
  }
  if (!hasTarget && !hasObjects) {
    throw new Error("effect.damage args.target must be a TargetSpec id string");
  }
  if (hasObjects && !isExpr(value.objects)) {
    throw new Error("effect.damage args.objects must be an Expr");
  }
  if (hasObjects && isRecord(value.objects)) {
    // Constant objects selectors are validated eagerly like effect.heal.
    const constantValue = (value.objects as { readonly value?: unknown }).value;
    if (value.objects.kind === "constant" || value.objects.kind === "literal") {
      selection(constantValue);
    }
  }
  if (
    value.source !== undefined &&
    value.source !== "self" &&
    !isExpr(value.source)
  ) {
    throw new Error("effect.damage args.source must be 'self' or an Expr");
  }
  if (value.combat !== undefined && typeof value.combat !== "boolean") {
    throw new Error("effect.damage args.combat must be a boolean");
  }
  if (value.bonus !== undefined && !isExpr(value.bonus)) {
    throw new Error("effect.damage args.bonus must be an Expr");
  }
  const divideValue = value.divide;
  const divide = divideValue === true ||
    (isRecord(divideValue) &&
      (divideValue.kind === "constant" || divideValue.kind === "literal") &&
      divideValue.value === true);
  if (divideValue !== undefined && !divide) {
    throw new Error("effect.damage args.divide must be true when present");
  }
  if (hasObjects && divideValue !== undefined) {
    throw new Error("effect.damage args.objects cannot be divided");
  }
  // The chain adapter preserves card-DSL literals for primitive-local
  // evaluation. Normalize the validated true literal before execute() checks
  // the primitive flag.
  return { ...value, ...(divideValue === undefined ? {} : { divide: true }) } as unknown as EffectDamageArgs;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function toNonNegativeInteger(value: Value): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : 0;
}

/**
 * The frozen primitive contract has no modifier-registry member yet. A host
 * may provide the same registry as a runtime capability; contexts without it
 * keep their prior behavior. The registry itself stays authoritative and is
 * never copied or mutated here.
 */
function continuousEffectsOf(ctx: ResolveContext): ContinuousEffectRegistry | null {
  const candidate = (ctx as ResolveContext & { readonly continuousEffects?: unknown }).continuousEffects;
  if (candidate === null || typeof candidate !== "object") return null;
  const registry = candidate as Partial<ContinuousEffectRegistry>;
  return typeof registry.active === "function" ? registry as ContinuousEffectRegistry : null;
}

function sourceScopeMatches(scope: unknown, source: ObjectRef): boolean {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return true;
  const expected = (scope as Record<string, unknown>).source;
  if (expected === undefined || expected === null || expected === "any" || expected === "all" ||
      expected === "self" || expected === "source") return true;
  return isObjectRef(expected) && sameRef(expected, source);
}

function explicitSourceScoped(scope: unknown): boolean {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return false;
  const value = (scope as Record<string, unknown>).source;
  return value !== undefined && value !== null && value !== "any" && value !== "all" &&
    value !== "self" && value !== "source";
}

function filterMatchesSource(filter: ObjectFilter, source: ObjectRef): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "objectId" && expected !== source.id) return false;
    if (key === "zoneEntryId" && expected !== source.zoneEntryId) return false;
  }
  return true;
}

function grantedBonusForDeal(
  ctx: ResolveContext,
  registry: ContinuousEffectRegistry,
  source: ObjectRef,
): number {
  const object = (ref: ObjectRef) => ctx.object(ref);
  const dealSource = ctx.object(source) ?? ctx.lastKnown(source);
  const common = { controller: ctx.controller, source, anchors: [dealSource] } as const;
  // Use the production query for the aggregate (CR 714). Grants with an
  // explicitly named source are subtracted and re-added only when they match,
  // because the generic query exposes instances but does not narrow scope.
  const allGeneric = bonusDamageGrantsForDeal(
    registry,
    { ...common, appliesTo: "deal-actions" },
    object,
  )
    .filter(grant => {
      const entry = registry.get(grant.id);
      return entry === undefined || filterMatchesSource(entry.effect.filter, source);
    });
  const genericTotal = bonusDamageForDeal(registry, { ...common, appliesTo: "deal-actions" }, object);
  const filteredOut = allGeneric.filter(grant => explicitSourceScoped(grant.scope) && !sourceScopeMatches(grant.scope, source))
    .reduce((sum, grant) => sum + grant.amount, 0);
  const generic = genericTotal - filteredOut;
  // The modifier query treats `deal-actions` and `any` as one scope. The card
  // DSL also carries the explicit controller spell/ability scope, so add only
  // grants that name that exact scope; this avoids double counting wildcards.
  const controllerScoped = bonusDamageGrantsForDeal(
    registry,
    { ...common, appliesTo: "controller-spells-and-abilities" },
    object,
  )
    .filter(grant => {
      const entry = registry.get(grant.id);
      return entry === undefined || filterMatchesSource(entry.effect.filter, source);
    })
    .filter(grant => grant.appliesTo === "controller-spells-and-abilities")
    .filter(grant => !explicitSourceScoped(grant.scope) || sourceScopeMatches(grant.scope, source))
    .reduce((sum, grant) => sum + grant.amount, 0);
  return generic + controllerScoped;
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function resolveObjectSet(ctx: ResolveContext, selected: Selection): readonly ObjectRef[] {
  const values = selected.kind === "source" ? [ctx.source.ref] :
    selected.kind === "target" ? ctx.targets(selected.id) :
      selected.kind === "pick" ? ctx.picks(selected.id) :
        ctx.query(selected.filter).map(object => object.ref);
  const refs: ObjectRef[] = [];
  for (const value of values) {
    if (!isObjectRef(value)) continue;
    const object = ctx.object(value);
    if (object?.zone === "board" && object.types.includes("unit") &&
        !refs.some(ref => sameRef(ref, value))) refs.push(value);
  }
  if (selected.kind === "query" || selected.kind === "choose") {
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 :
      left.zoneEntryId - right.zoneEntryId);
  }
  return refs;
}

function chooseTargets(ctx: ResolveContext, selected: Extract<Selection, { kind: "choose" }>, refs: readonly ObjectRef[]): readonly ObjectRef[] {
  const min = Math.min(selected.min, refs.length);
  const max = Math.min(selected.max, refs.length);
  if (max === 0) return [];
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selected.id, type: "select-objects", chooser: ctx.controller,
    visibility: "public", options: refs, min, max
  });
  if (!Array.isArray(answer) || answer.length < min || answer.length > max ||
      answer.some((ref, index) => !isObjectRef(ref) || !refs.some(option => sameRef(option, ref)) ||
        answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
    throw new TypeError("Invalid effect.damage choice answer");
  }
  return answer;
}

const argsSchema: Schema<EffectDamageArgs> = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
};

const effectDamage = {
  op: "effect.damage",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectDamageArgs): InstructionResult {
    // CR 418.6.a / 418.6.b：默认来源是描述该效果的对象本身。
    const sourceRef =
      args.source === undefined || args.source === "self"
        ? ctx.source.ref
        : ctx.evaluate(args.source);
    if (!isObjectRef(sourceRef)) {
      return { status: "negated", reason: "impossible", events: [] };
    }

    // 动态数额与 Bonus Damage（CR 714：多个 bonus 由传入表达式先行加总；
    // 714.2：非正 bonus 不生效；715.2：每个目标分别增加）。显式 bonus 是
    // 调用方提供的表达式；生产 registry 的授予另行汇总，二者是不同的
    // 数据源，同一个注册不会因两条路径而被重复计数。
    const base = toNonNegativeInteger(ctx.evaluate(args.amount));
    const explicitBonus = args.bonus === undefined ? 0 : toNonNegativeInteger(ctx.evaluate(args.bonus));
    const registry = continuousEffectsOf(ctx);
    const grantedBonus = registry === null ? 0 : grantedBonusForDeal(ctx, registry, sourceRef);
    const bonus = explicitBonus + grantedBonus;
    // CR 715.4: a Deal with a non-positive base amount performs no action, so
    // Bonus Damage is not applied merely to create a damage action. This guard
    // applies to explicit and registered bonuses alike.
    const perTarget = base <= 0 ? 0 : base + bonus;

    // 受击集合：target = Finalize/Resolve 后的锁定目标（355.7；355.14 只对
    // 这类已锁目标 divide）；objects = 程序化非目标集合（355.10.d/.e–f）或
    // linked/前序指令写出的 ObjectRef | ObjectRef[]（effect.recycle 惯例），
    // 不发 became-target。
    let selected: Selection | null = null;
    let targets: readonly ObjectRef[];
    const objectSet = args.objects === undefined ? undefined : ctx.evaluate(args.objects);
    if (Array.isArray(objectSet) || (objectSet !== undefined && isObjectRef(objectSet))) {
      const linkedRefs = (Array.isArray(objectSet) ? objectSet : [objectSet]).filter(isObjectRef);
      const seen = new Set<string>();
      targets = linkedRefs.filter((ref) => {
        const key = ref.id + ":" + ref.zoneEntryId;
        if (seen.has(key)) return false;
        seen.add(key);
        const object = ctx.object(ref);
        return object?.zone === "board" && object.types.includes("unit");
      });
    } else if (args.objects === undefined) {
      targets = ctx.targets(args.target!);
    } else {
      selected = selection(objectSet);
      targets = resolveObjectSet(ctx, selected);
      if (selected.kind === "choose") targets = chooseTargets(ctx, selected, targets);
    }

    // 引用重验：离区或旧 zoneEntryId 的对象不再受击。
    const valid = targets.filter((ref) => ctx.object(ref) !== null);
    if (valid.length === 0) {
      if (selected?.kind === "query" || (selected?.kind === "choose" && selected.min === 0)) {
        ctx.link("dealt", 0);
        ctx.link("dealtTo", []);
        ctx.link("dealtCount", 0);
        return {
          status: "executed",
          events: [],
          linkedValues: { dealt: 0, dealtTo: [], dealtCount: 0 }
        };
      }
      if (selected?.kind === "choose") {
        return { status: "negated", reason: "impossible", events: [] };
      }
      return { status: "ignored", reason: "mistargeted" };
    }

    let plan: DamagePlanEntry[];
    if (args.divide === true) {
      // CR 355.14.e：分摊数额到结算时才选择；355.14.f/.g：每个目标必须分到
      // 正整数。选择在重放时整体校验，非法则 negated，不部分结算。
      if (perTarget < valid.length) {
        return { status: "negated", reason: "impossible", events: [] };
      }
      const divided: DamagePlanEntry[] = [];
      let remaining = perTarget;
      for (let index = 0; index < valid.length; index += 1) {
        const slotsLeft = valid.length - index;
        const max = remaining - (slotsLeft - 1);
        const amount = ctx.choose<number>({
          id: "effect.damage:divide:" + index,
          type: "number",
          chooser: ctx.controller,
          visibility: "public",
          min: 1,
          max,
          prompt: "Divide damage among targets"
        });
        if (!Number.isInteger(amount) || amount < 1 || amount > max) {
          return { status: "negated", reason: "impossible", events: [] };
        }
        divided.push({ target: valid[index]!, amount });
        remaining -= amount;
      }
      plan = divided;
    } else {
      plan = valid.map((target) => ({ target, amount: perTarget }));
    }

    const events: GameEvent[] = [];
    const dealtTo: DealtRecord[] = [];
    let dealt = 0;
    let performed = 0;
    let negated: "replaced" | "impossible" | null = null;
    for (const entry of plan) {
      if (entry.amount <= 0) continue; // CR 418.1.e.1：非正伤害不造成，不算动作。
      performed += 1;
      const outcome = ctx.perform({
        type: "damage",
        source: sourceRef,
        target: entry.target,
        amount: entry.amount,
        combat: args.combat ?? false
      });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        negated = outcome.status === "prevented" ? "impossible" : outcome.status;
      } else {
        const amount = toNonNegativeInteger(outcome.result ?? entry.amount);
        dealt += amount;
        dealtTo.push({
          target: { id: entry.target.id, zoneEntryId: entry.target.zoneEntryId },
          amount
        });
      }
    }

    if (performed === 0 || negated !== null) {
      return { status: "negated", reason: negated ?? "impossible", events };
    }

    ctx.link("dealt", dealt);
    ctx.link("dealtTo", dealtTo);
    ctx.link("dealtCount", dealtTo.length);
    return {
      status: "executed",
      events,
      linkedValues: { dealt, dealtTo, dealtCount: dealtTo.length }
    };
  }
} satisfies InstructionDef<EffectDamageArgs>;

export default effectDamage;
