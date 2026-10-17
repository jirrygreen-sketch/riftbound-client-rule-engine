import type { CardProgram } from "../../ir/index.js";

/**
 * Xin Zhao, Vigilant — sfd-176-221 (CR v1.5 815.1.b/c, 364.3, 369.3).
 * Tank assignment priority and condition-gated entry are separate blockers.
 * Generic lifecycle/replacement binding exists; the enter branch must evaluate
 * the condition with the correct source incarnation before changing entry state.
 */
export default {
  canonicalCardId: "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Tank 的 continuous.combat 声明尚未被 combat/base-combat-allocation.ts 消费，815.1.b/815.1.c 的先向 Tank 分配致命战斗伤害不能执行。(2) 带条件的就绪入场（364.3/369.3）在 replacement/bind.ts 的 matchesEnterAction 命中后直接返回 true，绕过 ability.condition；必须在替代入场前求值其他友方 Base 单位 count>=2（RIFT-359）。exclude:self 还需与进入对象的当前 incarnation 一致，不能沿用登记时 hostRef。通用替代注册与生命周期绑定已存在；谓词和 effect.ready 的局部测试不证明条件入场或 Tank 完成。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { source: "self", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "units",
          filter: {
            type: "unit",
            controller: "self",
            zone: "board",
            location: "base",
            exclude: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      },
      with: [
        {
          id: "xin-zhao-vigilant.enter-ready",
          op: "effect.ready",
          args: { objects: { kind: "constant", value: { kind: "source" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "I enter ready if you have two or more other units in your base."
} satisfies CardProgram;
