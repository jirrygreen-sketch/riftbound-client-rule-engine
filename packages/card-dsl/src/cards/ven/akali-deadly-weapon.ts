import type { CardProgram } from "../../ir/index.js";

/**
 * akali-deadly-weapon — M2 源码复核（2026-10-17）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 2 Energy + 1 Fury Power。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-7b24e8fb2cf27a115102e669fe4fd9219a98b10d2411cc5caf4bb1826db5e3c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "827.1.c.1 的 2 Energy + 1 Fury Power 印刷费用缺 KeywordAbility.params.cost → expandProgram → Empower.expand 接线；ObjectSnapshot 尚未声明 empowered（442.1.a），统一生产 Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通；442.1.a/828.1.b.1 的 continuous.might 门控及伤害替换已使用真实 empowered 计数，但 object-moved 的 move-location 事件缺起点/终点 LocationRef，movedToOrFrom 目标过滤也没有生产绑定，无法落实 449.1/449.2 的两个战场范围（458.1 排除 Recall）。",
  abilities: [
    // 印刷费 2 Energy + 1 Fury Power（827.1.c.1）见 judgeReason；不伪造启动能力。
    { kind: "keyword", keyword: "empower" },
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // 383.3.a / 契约 3.9：“you may deal …” 把被选指令包进 body。
          id: "akali.may-deal-damage",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Deal damage to a unit at a battlefield I moved to or from?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "akali.deal-damage-at-moved-battlefield",
                  op: "effect.damage",
                  args: {
                    // 442.1.a：“deal 1 … If I'm Empowered, deal 2 instead”。
                    // min(1, empowered) 只判断是否拥有该状态，不按可叠加次数增加伤害。
                    amount: {
                      kind: "arithmetic",
                      operator: "add",
                      operands: [
                        { kind: "constant", value: 1 },
                        {
                          kind: "arithmetic",
                          operator: "min",
                          operands: [
                            { kind: "constant", value: 1 },
                            { kind: "object-property", object: "self", property: "empowered" }
                          ]
                        }
                      ]
                    },
                    target: {
                      kind: "constant",
                      value: "akali.unit-at-moved-battlefield"
                    }
                  },
                  targets: [
                    {
                      id: "akali.unit-at-moved-battlefield",
                      // “a unit at a battlefield”：实际战场必须是我这次移动的起点或终点。
                      // 该锚点依赖移动时点的起点/终点载荷（449.1/449.2），描述性键
                      // movedToOrFrom 记录待接线的限制（见 judgeReason）。
                      filter: {
                        type: "unit",
                        zone: "board",
                        location: "battlefield",
                        movedToOrFrom: "self"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    },
    {
      // [Empowered][>] I have +1 :rb_might:（828.1.b.1 的依赖能力 + 479 算术图层）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        appliesTo: "self"
      },
      // 828.1.c：按宿主的实时状态计数判断依赖能力是否有效。
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "empowered" },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
    "When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n" +
    "[Empowered][>] I have +1 :rb_might:."
} satisfies CardProgram;
