import type { CardProgram } from "../../ir/index.js";

/**
 * Mister Root (unl-127-219) — Unit, Chaos, tags Fae / Ionia。
 * catalog：energy 2、power null（无印刷力量）、might 1。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-127-219，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost
 *   to have me enter ready.)
 *   When I move to a battlefield, gain 2 XP.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1/805.1.a/805.1.b）：单位上的可选附加费用关键词，费用固定为
 *   [1][C]（805.1.b.1：有域单位的 Power 只能与自身某一域匹配）；805.4 多个实例冗余。
 *   卡内只声明 `{ kind: "keyword", keyword: "accelerate" }`（契约 3.7 第 5 节），
 *   展开由 effects/keywords/Accelerate.ts 负责。
 * - “When I move to a battlefield”：421.1 / 449.1 / 449.2 定义 Move；458/458.1 规定 Recall
 *   不是 Move、不触发移动能力。封闭时点 object-moved（timing-points.ts，refs 421.1/449.1/
 *   449.2/458）用于“成功完成 Move”；“到战场”由内层 filter 的 source: self 与
 *   终点限定表达（见 judgeReason：该载荷与锚点当前不可判定）。
 * - “gain 2 XP”：effect.xp 已合入（730.1 / 733；获得者缺省为能力控制者，190.6.d）。
 *
 * status = judge-required（缺口不近似实现）：
 * - Accelerate 的 KeywordDef 与 replacement 绑定已合入，但 additional-cost 的 Finalize
 *   消费和“付费后才挂上替代”的延迟接线仍未完成：cost/cost-plan.ts 只消费调用方传入的
 *   optionalAdditional，而 accelerate.cost 静态效果在 programs/statics.ts 的 layerFor
 *   没有图层映射（实测 "Static ability kind accelerate.cost has no layer mapping"），
 *   programs/play.ts 产出的 draft 也不带 cost 字段，因此打出的单位拿不到可选附加费用。
 * - “When I move to a battlefield” 的触发在已合入代码里无法诚实订阅：
 *   events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 不含 object-moved，
 *   event: "object-moved" 会被 validateTriggerSpec 以 invalid-event-type 直接拒绝
 *   （实测注册抛错），任何等价拼写都无法注册；并且 events/action-adapter.ts 为
 *   move-location 生成的事件不填 fromZone/toZone（实测两个字段都是空），
 *   449.1/449.2 的起点终点与 458/458.1 的 Recall 排除都无从判定。
 * 已合入且可执行的是触发效果本体：golden 用解释器 + 参考内核真实执行 effect.xp（2 XP）。
 *
 * 依赖：Accelerate additional-cost/Finalize 接线、移动时点载荷与卡牌触发注册。
 */
export default {
  canonicalCardId:
    "card.hash-2f32c6395b7dc0bd6975c6b7bb280cc4c1c63da74289ee612c41dd38e92b8074",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-18 实测，均不近似实现）：" +
    "(1) [Accelerate] 的 KeywordDef 与 replacement 绑定已合入，但 additional-cost 的 Finalize 消费和 " +
    "805.2.b 的付费后延迟接线仍缺失：cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，" +
    "accelerate.cost 静态效果在 programs/statics.ts 的 layerFor 没有图层映射（实测 " +
    "\"Static ability kind accelerate.cost has no layer mapping\"），programs/play.ts 产出的 draft 也不带 cost；" +
    "805.1.b.1 的域匹配与 805.2.b/805.6 的付费条件因此都不生效。" +
    "(2) 「When I move to a battlefield」无法诚实订阅：events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 不含 " +
    "object-moved，event: \"object-moved\" 被 validateTriggerSpec 以 invalid-event-type 直接拒绝（实测注册抛错），" +
    "没有合法拼写；且 events/action-adapter.ts 为 move-location 生成的事件不填 fromZone/toZone（实测两者皆空），" +
    "449.1/449.2 的起点终点与 458/458.1 的 Recall 排除无从判定。" +
    "触发效果本体 effect.xp（730.1）已合入，golden 用解释器 + 参考内核真实执行；“gain 2 XP”不因上述缺口而近似。" +
    "依赖：Accelerate additional-cost/Finalize 接线、移动时点载荷与卡牌触发注册。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: {
          event: "object-moved",
          // 449.1/449.2：“移动到战场”的终点限定；该载荷当前不被填充（见 judgeReason）。
          toZone: "battlefield",
          // “I move”：来源即本卡的移动（458/458.1 的 Recall 排除同样依赖该锚点）。
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "mister-root.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "When I move to a battlefield, gain 2 XP."
} satisfies CardProgram;
