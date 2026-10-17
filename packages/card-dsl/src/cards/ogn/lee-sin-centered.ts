import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lee Sin, Centered (ogn-151-298) — Unit（能量 6，力量 **null（无印刷值）**，Might 6，Body；
 * Lee Sin/Ionia/Champion）。
 *
 * 原文：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to
 *   have me enter ready.)
 *   Other buffed friendly units at my battlefield have +2 :rb_might:.
 *
 * 注意：catalog 中 `power: null` 表示**没有印刷力量**，不是 0（cards/README.md 第 2 节
 * 与本任务红线）；本程序不在任何地方把它写成 0。
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate] 805：关键词声明（展开由 effects/keywords/Accelerate.ts 负责）。
 * - "Other buffed friendly units at my battlefield have +2 :rb_might:."：持续型
 *   被动能力（364/364.3："have +2" 是陈述事实），在 arithmetic 图层给"我在的战场上"、
 *   有 Buff 的、其他友方单位 +2 Might（703：每个 Buff 贡献 +1 Might，这里读的是"是否
 *   被 Buff"这一状态）。
 *
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入：RIFT-257 的 static 注册路径（programs/statics.ts 的 createEngineStaticBinder →
 *   layers engine）与 RIFT-258 的 continuous.might 算术层。
 * - 已合入且等价：「buffed」可用 ObjectFilter 的 characteristics 谓词表达——
 *   ObjectSnapshot 带 buffs 计数（702.2.a / 702.3：一个单位同时只有一个 Buff），
 *   layers/filter.ts 的 characteristicsMatch 逐键比较，实测 `characteristics: { buffs: 1 }`
 *   精确命中「有 Buff」的单位，只加成它。不需要新增 states 枚举值。
 * - 仍缺（缺口一，过滤器锚点）："at my battlefield" 需要以宿主**当前位置**为锚点。
 *   programs/statics.ts 的 staticFilter 会把 sameLocationAs "source" 折叠成
 *   `{ location: { type: "battlefield", id: … } }` 结构化值，而 layers/filter.ts 的 location
 *   比较只认字符串形式（`value.location !== object.location`，对象形式一律不等），实测该注册
 *   对任何对象都不匹配、光环完全不生效；只有写成 `location: "battlefield"` 才匹配（但那会连带
 *   命中其他战场）。
 * - 仍缺（缺口二，排除宿主）：程序声明的 exclude: "self"（364.3 的 other）被 staticFilter 以
 *   "Static exclude anchor needs a dynamic relative filter" 拒绝。
 * - 仍缺（缺口三，Accelerate 接线）：Accelerate 展开的 accelerate.cost 静态效果没有图层映射
 *   （layerFor 抛 "Static ability kind accelerate.cost has no layer mapping"），且卡程序没有把
 *   keyword 声明的可选附加费用接进打出流程的 optionalAdditional（programs/play.ts 对
 *   additional/keyword/optional 费用字段直接 judgeRequired）。与 ogn/legion-rearguard 同缺口。
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
    "持续 Might 修正仍不可执行，三处缺口：（1）“at my battlefield”（359.3.f.2）需要以宿主当前位置为锚点；" +
    "programs/statics.ts 的 staticFilter 把 sameLocationAs source 折叠成结构化 location 值，而 " +
    "layers/filter.ts 的 location 比较只认字符串形式，实测该注册不匹配任何对象、光环完全不生效。" +
    "(2) 程序声明的 exclude self（364.3 的 other）被 staticFilter 以 “Static exclude anchor needs a dynamic " +
    "relative filter” 拒绝。(3) Accelerate（805）展开的 accelerate.cost 静态效果无图层映射" +
    "（layerFor 抛 “Static ability kind accelerate.cost has no layer mapping”），且卡程序 keyword 的" +
    "可选附加费用未接进打出流程 optionalAdditional（programs/play.ts 对 additional/keyword/optional 费用字段直接拒绝）。" +
    "已合入并实测：RIFT-257 的 static 注册路径、RIFT-258 的 continuous.might；「buffed」（702.2.a/702.3）" +
    "可用 ObjectFilter 的 characteristics: { buffs: 1 } 精确表达（layers/filter.ts 的 characteristicsMatch），" +
    "不需要新增 states 枚举值。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "Other buffed friendly units at my battlefield have +2 :rb_might:."
} satisfies CardProgram;

export default program;
