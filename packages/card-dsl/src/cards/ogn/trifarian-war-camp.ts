import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian War Camp — CR v1.5 053.3, 190.6, 479.4, 652.2.c.
 * 复核 2026-10-17：静态绑定把 here 解析成来源的 LocationRef 并注册算术光环，
 * 但图层匹配仍按对象引用比较 location，光环打不到同一战场的单位。
 */
export default {
  canonicalCardId: "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units here have +1 Might」（CR 053.3、479.4）在图层取不到作用对象（2026-10-17 复核）：" +
    "programs/statics.ts::staticFilter 已把 sameLocationAs:self 解析成来源的 LocationRef 并注册 ContinuousEffectSpec，" +
    "但 layers/filter.ts::matchesObjectFilter 对结构化 location 用对象引用比较（实测同一位置对象为 true、" +
    "值相等的两个 {type:'battlefield',id} 对象为 false），而图层快照复制位置对象，" +
    "因此注册后的 +1 打不到本战场任何单位（实测同战场单位 Might 仍为 2、5）。" +
    "需按 battlefield id / base player 比较 LocationRef 的位置值。" +
    "整卡等待 here 范围内的值匹配修复与真实加成的执行验证。",
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
