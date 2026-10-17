import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian War Camp — CR v1.5 053.3, 190.6, 479.4, 652.2.c.
 * The static lifecycle now registers this arithmetic aura and binds here to
 * the battlefield LocationRef. The layer matcher still compares that object
 * by reference; it must compare location values before the aura is executable.
 */
export default {
  canonicalCardId: "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units here have +1 Might」（CR 053.3、479.4）仍缺静态 here 作用域的值比较：programs/statics.staticFilter 已把 sameLocationAs:self 绑定成来源的 LocationRef，并已注册/解绑 ContinuousEffectSpec；" +
    "但 layers/filter.matchesObjectFilter 对结构化 location 使用对象引用比较，而层快照复制位置对象，不能匹配同一战场的单位。需按 battlefield id / base player 比较 LocationRef 的位置值。" +
    "静态绑定已将 sameLocationAs:self 解析为来源位置；整卡等待 here 范围内真实加成的值匹配修复与执行验证。",
  sourceText: "Units here have +1 :rb_might:. (This includes attackers.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 053.3 + 740.1.a: every unit (both controllers) at this Battlefield.
        // The static binder resolves this anchor; location matching needs value equality.
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
