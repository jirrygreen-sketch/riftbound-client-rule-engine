import type { Expr, InstructionDef, InstructionResult, ObjectRef, ResolveContext, Schema, Value } from "../contract.js";

/**
 * effect.damage — 造成 / 分配伤害（Deal Damage）。
 *
 * 参数（argsSchema 在解释器求值前校验 IR 形状）：
 * - amount: Expr — 结算时经 ctx.evaluate 求值的伤害基础数额（动态数额，
 *   如 "equal to its Might"，用 object-property / linked-value 等表达式；
 *   取值时机即调用时，契约 3.6）。
 * - target: string — 目标 TargetSpec 的 id；目标集合经 ctx.targets(id) 读取
 *   （Finalize 锁定、Resolve 重验后的仍合法目标）。
 * - source?: "self" | Expr — Deal 动作的来源。缺省为 "self"，即能力的来源对象
 *   （CR 418.6.a：未指定来源时，描述该 Deal 动作的效果即来源）。给出表达式
 *   时求值为 ObjectRef，用于 "它（某单位）造成伤害" 这类指定来源的卡牌
 *   （CR 418.6.b.3，如 sfd-107-221 Strike Down）。
 * - combat?: boolean — 是否为战斗伤害；透传给 GameAction "damage"（契约 3.6），
 *   效果原语通常为 false。
 * - bonus?: Expr — 本 Deal 动作获得的 Bonus Damage（CR 418.4 / 712–715）。
 *   每个目标分别加上该数额（715.2）；结果须为正，非正则不加（714.2）。
 * - divide?: true — 分配伤害（"split N damage"，CR 355.14）：每个目标分摊
 *   的数额到结算时才决定（355.14.e），因此在本原语内以 type "number" 的
 *   ctx.choose 逐目标挂起询问，选定为 effect 控制者；问完一次后重放时
 *   校验全部答案，任何非法答案都使本指令 negated（impossible），不会
 *   部分结算。
 *
 * 语义边界（本原语不做的事）：
 * - 动态数额只在本原语内 evaluate；X 值的由来、Might 汇总（CR 142.4 相关
 *   计算）由表达式与图层系统负责。
 * - 同时伤害：对每个仍合法的目标分别提交一次 GameAction "damage"，对应
 *   CR 418.1.c（伤害分别标记在每个单位上）；418.1.d 的同时性由内核/事件
 *   管线表达（如合并为时点），原语不合并动作。
 * - Bonus Damage 的来源授予（如 Annie, Fiery "你的法术 +1"）由持续效果/
 *   图层系统算好后经 bonus 表达式传入；本原语只做加总（714）与施加（715.2）。
 * - 超额分配（355.14.h，目标多于可分时由控制者裁撤目标）属于 target.many /
 *   目标系统的职责；本原语只在答案非法（超出剩余、非正整数）时 negated。
 * - 0 与负数：CR 418.1.e/418.1.e.1 规定只有正整数伤害才会被造成。基础额
 *   加 bonus 后 ≤ 0 的伤害事件被跳过（不算 perform）；若因此没有任何
 *   perform 发生，本指令按契约 3.6 原语规则 2 返回 negated(impossible)。
 *
 * 结果（契约 3.3 / 3.6 原语规则 2）：
 * - 目标集合为空或全部引用失效（对象已离区，旧 zoneEntryId）→ ignored。
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
  readonly target: string;
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

function isObjectRef(value: unknown): value is ObjectRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ObjectRef).id === "string" &&
    typeof (value as ObjectRef).zoneEntryId === "number"
  );
}

function isExpr(value: unknown): value is Expr {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Expr).kind === "string"
  );
}

function parseArgs(value: unknown): EffectDamageArgs {
  if (typeof value !== "object" || value === null) {
    throw new Error("effect.damage args must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (!isExpr(candidate.amount)) {
    throw new Error("effect.damage args.amount must be an Expr");
  }
  if (typeof candidate.target !== "string" || candidate.target.length === 0) {
    throw new Error("effect.damage args.target must be a TargetSpec id string");
  }
  if (
    candidate.source !== undefined &&
    candidate.source !== "self" &&
    !isExpr(candidate.source)
  ) {
    throw new Error("effect.damage args.source must be 'self' or an Expr");
  }
  if (candidate.combat !== undefined && typeof candidate.combat !== "boolean") {
    throw new Error("effect.damage args.combat must be a boolean");
  }
  if (candidate.bonus !== undefined && !isExpr(candidate.bonus)) {
    throw new Error("effect.damage args.bonus must be an Expr");
  }
  if (candidate.divide !== undefined && candidate.divide !== true) {
    throw new Error("effect.damage args.divide must be true when present");
  }
  return candidate as unknown as EffectDamageArgs;
}

function toNonNegativeInteger(value: Value): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : 0;
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
    // 714.2：非正 bonus 不生效；715.2：每个目标分别增加）。
    const base = toNonNegativeInteger(ctx.evaluate(args.amount));
    const bonus = args.bonus === undefined ? 0 : toNonNegativeInteger(ctx.evaluate(args.bonus));
    const perTarget = base + bonus;

    // 目标重验：引用已失效（离区、旧 zoneEntryId）的目标被剔除。
    const targets = ctx.targets(args.target);
    const valid = targets.filter((ref) => ctx.object(ref) !== null);
    if (valid.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }

    let plan: DamagePlanEntry[];
    if (args.divide === true) {
      // CR 355.14.e：分摊数额到结算时才选择；355.14.f/.g：每个目标必须分到
      // 正整数。选择在重放时整体校验，非法则 negated，不部分结算。
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

    const events = [];
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
