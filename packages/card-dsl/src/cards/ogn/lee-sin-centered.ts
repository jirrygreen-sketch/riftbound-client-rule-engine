import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lee Sin, Centered (ogn-151-298), CR v1.5 359.3.f.2 / 364.2 / 478.1 / 702 / 805.
 * 当前复核：continuous.might 与 characteristics.buffs 谓词已可执行；缺动态战场锚点、
 * 排除宿主及 Accelerate 的费用计划生产方。印刷 power:null 保持无印刷值。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      filter: {
        type: "unit",
        controller: "controller",
        exclude: "self",
        sameLocationAs: "source",
        // 702.2.a / 702.3: "buffed" is the unit's Buff counter (an ObjectSnapshot field), so the
        // merged characteristics predicate expresses it exactly; no new states value is needed.
        characteristics: { buffs: 1 }
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 continuous.might 光环的动态过滤与 Accelerate 接线：(1) sameLocationAs source 被 staticFilter 固化成注册时的" +
    "结构化 location，layers/filter.ts 又按引用比较，不能跟随宿主当前战场（359.3.f.2）。" +
    "(2) exclude self 被 staticFilter 拒绝，无法表达原文 other（持续适用性见 478.1）；characteristics.buffs 已可表达 buffed，缺口不在 Buff 谓词。" +
    "(3) Accelerate 的 accelerate.cost 静态声明无图层映射，programs/play.ts 未从 keyword 生成 optionalAdditional，" +
    "无法在打出时支付额外 Body Power 并建立入场就绪的延迟替代（805.1.b/805.2.b/805.6）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "Other buffed friendly units at my battlefield have +2 :rb_might:."
} satisfies CardProgram;

export default program;
