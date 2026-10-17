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
 * Status: judge-required. Current source audit:
 * Static Might binding and sameLocationAs/exclude queries are present.
 * Both the host and another friendly unit must be attackers at the same
 * battlefield; the CardProgram snapshot/layer path still lacks that binding.
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
    "缺 CardProgram 路径的 Attacker designation 快照接线（CR 466.2.c.3/807.1.d）：combat/derived-might.ts 的 canonical 攻击者推导尚未提供给本卡 static 条件。layers/filter.ts 仍忽略 combatRole，且 controller:controller 未解析为能力控制者；sameLocationAs/exclude 锚点本身已可查询。",
  abilities,
  sourceText: "I have +2 :rb_might: while I'm attacking with another unit."
} satisfies CardProgram;
