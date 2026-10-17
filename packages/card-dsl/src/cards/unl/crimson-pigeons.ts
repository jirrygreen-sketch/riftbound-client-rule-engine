import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Crimson Pigeons (unl-154-219) — Unit, Order, tags Bird/Noxus.
 * energy 3（power: null，无印刷力量费）, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-154-219，逐字）：
 *   I have +2 :rb_might: while I'm attacking with another unit.
 *
 * 规则依据（CR v1.5）：
 * - 143.2.a / 479.4：Might 的增减在算术层生效；+2 是条件式持续修正（364.3 的条件式被动能力），
 *   用 static 能力的 continuous.might + condition 表达。
 * - 807.1.d / 466.2.c.3：攻击者身份（Attacker designation）由 Combat 赋予；740.2.c 的“in combat”
 *   定义要求该单位在战斗中的战场上具有战斗身份。
 * - “with another unit” 需要按“攻击者集合中还有另一个由你控制的单位”来求值：本卡用
 *   count + sameLocationAs/exclude 的锚点记录该条件（355.10.d：此类按特征程序化选出的集合不取目标）。
 *
 * status = judge-required（缺口不近似实现）：
 * - ObjectSnapshot 已有 combatRole 字段，但 combat/ 尚未在攻击/防守指定时可靠地产生它，
 *   因此“我在攻击时”仍无法判定。
 * - CardProgram 的 static → layers 绑定已合入，且 compare/count 条件会经过 evaluateCondition；
 *   但层查询的 ObjectFilter 消费方仍忽略 combatRole，导致条件会把非攻击者也计入。
 * - “another unit” 的 sameLocationAs / exclude 锚点本身可由解释器查询消费，
 *   但静态条件的 combatRole 与 controller-relative 组合仍缺少完整的图层过滤语义。
 * 依赖：combat designation producer，以及 layers/filter.ts 对 combatRole 与静态相对条件的消费（RIFT-359 后续）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-attacking-units",
        filter: {
          // “with another unit”：同一战场上的另一个己方单位（740.1.a 的 friendly 定义、
          // 355.9.c 的 another 惯例），并由战斗身份限定为攻击者（466.2.c.3 / 740.2.c）。
          type: "unit",
          controller: "controller",
          zone: "board",
          sameLocationAs: "self",
          exclude: "self",
          combatRole: "attacker"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-202a6a8d0996a1526ced8874bdc194188d33ba1a216fb691a29e5fd4a678afd7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（均不近似实现）：(1) “while I'm attacking” 需要 Attacker designation（807.1.d、466.2.c.3、740.2.c），" +
    "ObjectSnapshot 虽已有 combatRole 字段，但 combat/ 尚未在攻击指定时可靠地产生它。" +
    "(2) CardProgram 的 static → layers 绑定与 compare/count 条件求值已合入；但 layers/filter.ts 的 ObjectFilter 消费仍忽略 combatRole，" +
    "会把非攻击者计入条件。" +
    "(3) sameLocationAs / exclude 的锚点查询可执行，但 combatRole 与 controller-relative 组合的静态过滤语义仍未完成。" +
    "依赖：combat designation producer 与 layers/filter.ts 对 combatRole 的消费（RIFT-359 后续）。",
  abilities,
  sourceText: "I have +2 :rb_might: while I'm attacking with another unit."
} satisfies CardProgram;
