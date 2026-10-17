import type { CardProgram } from "../../ir/index.js";

/**
 * Xin Zhao, Vigilant — sfd-176-221 (CR v1.5 815.1.b/c, 364.3, 369.3).
 * Re-verified 2026-10-17 against the merged engine. Tank assignment priority
 * and condition-gated entry remain current blockers; the condition and entry
 * rewrite both have merged consumers, but not in the same decision.
 * RIFT-678 retains the exact two-other-friendly-base-unit condition and tests
 * the satisfied entry plus false-condition boundaries in the template golden.
 */
export default {
  canonicalCardId: "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（复核 2026-10-17），均不近似实现：" +
    "(1) [Tank]（815.1.b/815.1.c）的 continuous.combat 声明仍无消费方：layers/ops 只持久化该 kind、不产生伤害分配优先规则，" +
    "combat/base-combat-allocation.ts 的其它路径只接受 keywordPriority: \"proven-none\"；" +
    "该事实接口不能提供本卡 Tank 的伤害分配优先信息，尚不能验证 815.1.c.2；不以手写 proven-none 回调充当 Tank 执行证据。" +
    "(2) 「I enter ready if ...」是 364.3/369.3 的条件入场替代，但 replacement/bind.ts 的 matchesEnterAction 只比对 filter（source:self、exhausted:true），" +
    "在命中后不调用 testCondition(ability.condition)；实测把 condition 换成恒假（1 == 2）后单位仍入场 ready。" +
    "同时 exclude:\"self\" 是注册时的 hostRef，进入路径的真实对象是新的 incarnation（zoneEntryId 已变），条件求值必须绑定进入对象的当前 incarnation；" +
    "replacements 的通用注册与 effect.ready 本体已可执行，但上述两条入场决策缺口使整卡不可执行。",
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
