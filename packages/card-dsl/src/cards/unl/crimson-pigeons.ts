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
 * Status: judge-required. Re-checked 2026-10-18 by running the bound static
 * ability's own condition against the production binder and layer engine:
 * - The declaration binds as an arithmetic continuous.might +2 (probed) and the
 *   layer condition really evaluates. selectors.queryObjects consumes the
 *   sameLocationAs/exclude anchors, so a distant ally is correctly excluded and
 *   the location half is NOT the blocker.
 * - Blocker (1): the relative player is never resolved on this path.
 *   programs/statics.ts stores controller:"controller" literally, and the layer
 *   matcher compares that string against each object's controller value, so the
 *   "another unit you control" set is always empty: with a same-location friendly
 *   attacker present the condition still returns false and the +2 stays off.
 * - Blocker (2): the layer matcher does not read a combatRole key. Substituting a
 *   literal controller makes the count reach 1, but a *defender* ally at the same
 *   battlefield then also satisfies it (probed: condition true, +2 applied), so
 *   the attacker gate would be over-applied. characteristics.combatRole is the
 *   spelling the matcher does evaluate (probed: attacker true, defender false),
 *   but it is not interchangeable here without re-checking the whole filter.
 * - Blocker (3): there is no production Attacker designation producer.
 *   ObjectSnapshot carries combatRole and the reference kernel accepts it, but
 *   turn/combat flow never assigns it, and the scenario harness drops
 *   combatRole from its object config, so even a wired filter has no live data.
 * The merged condition therefore returns false rather than over-applying the +2.
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
      kind: "all",
      conditions: [
        {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "combatRole" },
          operator: "eq",
          right: { kind: "constant", value: "attacker" }
        },
        {
          kind: "compare",
          left: {
            kind: "count",
            subject: "other-attacking-units",
            filter: {
              // 355.10.d：同一战场上的另一个己方攻击单位，不取目标。
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
      ]
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-202a6a8d0996a1526ced8874bdc194188d33ba1a216fb691a29e5fd4a678afd7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处（2026-10-18 复核，均不近似实现）：" +
    "(1) 相对玩家解析（CR 355.9.c/740.1.a）：programs/statics.ts 把 controller: \"controller\" 原样存进图层 filter，" +
    "layers/filter.ts 的 matchesObjectFilter 按字面值与该对象的 controller 比较，因此“another unit you control”的集合恒为空；" +
    "实测同一战场上的己方攻击单位在场时条件仍为 false、+2 未生效。" +
    "(2) 攻击者身份的匹配消费（CR 466.2.c.3/807.1.d）：matchesObjectFilter 不读取 combatRole 键。" +
    "把 controller 换成字面量后计数可达 1，但同战场的 defender 也会满足 combatRole: \"attacker\"（实测条件 true、错误 +2）；" +
    "characteristics.combatRole 是匹配器确实求值的拼写（实测 attacker true / defender false），但改用它需要同时重核整个 filter，不能单独替换。" +
    "(3) 攻击者身份的生产来源（CR 740.2.c/466.2.c.3）：ObjectSnapshot 有 combatRole 字段、参考内核也能写入，" +
    "但 turn/flow.ts 与 combat/flow.ts 从未在攻击/防守指定时赋值，基础 evaluateExpression 也读不到 designation。" +
    "已合入并可执行：static continuous.might 的生产绑定与算术图层求值（探针确认可注册）、解释器 query 层的 sameLocationAs/exclude 锚点、" +
    "以及图层条件的真实求值（探针：条件返回 false，整卡目前不生效而不是错误生效）。RIFT-644 模板行已固定这些行为。",
  abilities,
  sourceText: "I have +2 :rb_might: while I'm attacking with another unit."
} satisfies CardProgram;
