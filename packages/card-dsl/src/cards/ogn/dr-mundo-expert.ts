import type { CardProgram } from "../../ir/index.js";

/**
 * Dr. Mundo, Expert (ogn-109-298) — Unit, 8 energy + 2 Mind power, Might 6，
 * 标签 Dr. Mundo / Zaun / Champion。
 *
 * 原文：My Might is increased by the number of cards in your trash.
 *      At the start of your Beginning Phase, recycle 3 from your trash.
 *
 * 规则依据（CR v1.5）：
 * - 「My Might is increased by N」是静态能力（364.2 陈述事实；479.1/479.2 的
 *   特征层加法），具有依赖关系时必须先算被引用对象——这里依赖的是「你垃圾场的
 *   牌数」这一动态计数，属于 479.4 图层依赖与动态取值（契约 3.4「图层依赖」）。
 * - 触发句用 "At the start of your Beginning Phase"，对应封闭时点
 *   "beginning-start"（timing-points.ts，ruleRefs 315.2.a.1）；"your" 指能力
 *   控制者 → filter 的 player/controller 选择 "controller"。
 * - 「recycle 3 from your trash」是 417.6 的 "Recycle X from [Zone]"：非目标
 *   选择（355.7），由 ability 控制者在该区域里选 3 张 → 已有 effect.recycle 的
 *   from 形式（zone + owner + amount，417.4 不足则尽量回收）。
 *
 * 状态：judge-required。2026-10-17 实测后只剩两个当前生产缺口：
 * 1. 静态 Might 的 amount 仍是 trash 计数表达式（CR 479.4），LayerEngine 不重算它：
 *    programs/statics.ts 会把静态 amount 交给 layers/engine.ts；其 numberValue → valueOf 只解析 constant/literal、
 *    object-property/object-attribute、ref 与 add/subtract/multiply，遇到
 *    { kind: "count" } 直接返回对象本身，非数值即按 fallback 0 处理。
 *    带一张 trash 牌的实测结果是 Might 6（未加成），把同一条注册换成
 *    constant 1 后是 7，证明缺口在 count 求值而不是图层注册本身。
 * 2. 触发无法注册：本卡 filter 写 event:"beginning-start"（317.1 的 Beginning Phase
 *    开始时点，timing-points.ts 的 ruleRefs 315.2.a.1），但 events/trigger-spec.ts 的
 *    assertTriggerSpec 只接受封闭的 EVENT_PATTERN_TYPES 事件名表（对象/状态事件，
 *    不含阶段时点），实测 attachLifecycle 抛 TriggerSpecValidationError 且注册 0 个触发。
 *    Beginning Phase 的时点发射与条件求值因此都不可达。
 * 按红线不做近似实现（不得改用 Buff counter）。
 *
 * 依赖：CR 479.4 的 count 图层求值，以及阶段时点进入可注册的触发过滤词表。
 */
const drMundoExpert = {
  canonicalCardId: "card.hash-e6d907e16eabec4df39898b5e0b88759b3c4a756d746eb210b9feaa3437d822e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（均已实测，不近似实现）：" +
    "（1）静态 Might 的 amount 是「你 trash 中的牌数」count 表达式，生产静态绑定后的 LayerEngine 不重算它" +
    "（CR v1.5 479.4）：programs/statics.ts 将 amount 交给 layers/engine.ts；其 numberValue → valueOf 只解析 constant/literal、" +
    "object-property/object-attribute、ref 与 add/subtract/multiply，{ kind: \"count\" } 会落到非数值 fallback 0。" +
    "实测：trash 有 1 张牌时 Might 仍为 6（未加成），同一条注册改为 constant 1 时为 7。" +
    "（2）触发无法注册：本卡 filter 的 event:\"beginning-start\"（CR 317.1、timing-points.ts 315.2.a.1）" +
    "不在 events/trigger-spec.ts 的封闭事件名表 EVENT_PATTERN_TYPES 中，attachLifecycle 实测抛" +
    "TriggerSpecValidationError 且注册 0 个触发。" +
    "effect.recycle 的 417.6 局部能力已有执行证据。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: {
          kind: "count",
          subject: "cards",
          filter: { zone: "trash", owner: "controller" }
        }
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        filter: { event: "beginning-start", player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "mundo.recycle-3",
          op: "effect.recycle",
          args: {
            from: {
              kind: "constant",
              value: {
                zone: "trash",
                owner: "controller",
                amount: { kind: "constant", value: 3 }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "My Might is increased by the number of cards in your trash.\n" +
    "At the start of your Beginning Phase, recycle 3 from your trash."
} satisfies CardProgram;

export default drMundoExpert;
