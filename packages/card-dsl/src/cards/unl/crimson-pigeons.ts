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
 * - Attacker designation 不是 ObjectSnapshot 特征（契约 3.8 才要求 combatRole: \"attacker\" | \"defender\" | null，
 *   当前 effects/contract.ts 与 layers/filter.ts 都没有该字段/键），因此“我在攻击时”无法判定。
 * - 没有把卡牌 static 能力注册成图层持续效果的消费方：layers/engine.ts 的 conditionMatches 只识别
 *   always/never/type/has-tag/has-keyword，其余 Condition（含 compare/count）一律返回 true——
 *   条件接线前声明它会变成“无条件 +2”，按红线不近似实现。
 * - “another unit” 的同地点/排除锚点（sameLocationAs、 exclude）在图层过滤器里没有实现
 *   （layers/filter.ts 不读这两个键），计数会落到 0 或把自身算进去。
 * 依赖：契约 3.8（combatRole）、RIFT-91 后续（图层条件与卡牌持续效果注册、同地点/排除锚点）。
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
    "三处缺口（均不近似实现）：(1) “while I'm attacking” 需要 Attacker designation（807.1.d、466.2.c.3、740.2.c 的 in combat 定义），" +
    "而该身份不是 ObjectSnapshot 特征——契约 3.8 才要求增加 combatRole: \\\"attacker\\\" | \\\"defender\\\" | null，" +
    "当前 effects/contract.ts 与 layers/filter.ts 都没有该字段/键。" +
    "(2) 没有把卡牌 static 能力注册成图层持续效果的消费方，且 layers/engine.ts 的 conditionMatches 只识别 " +
    "always/never/type/has-tag/has-keyword，其余 Condition（含本卡的 compare/count）一律返回 true——" +
    "在条件接线前声明该 static 会变成“无条件 +2 [M]”，按红线不近似实现。" +
    "(3) “with another unit” 的 sameLocationAs / exclude / other 锚点在图层过滤器里没有实现（layers/filter.ts 不读这些键），" +
    "计数会落到 0 或把自身算进去。依赖：契约 3.8（combatRole）与 RIFT-91 后续（图层条件、锚点、卡牌持续效果注册）。",
  abilities,
  sourceText: "I have +2 :rb_might: while I'm attacking with another unit."
} satisfies CardProgram;
