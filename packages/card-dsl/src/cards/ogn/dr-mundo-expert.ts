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
 * 状态：judge-required。已合入的 continuous.might、时点、filter 与 effect.recycle 都能表达
 * 局部能力，但静态 Might 加成的 amount 仍是 trash 计数表达式；当前 LayerEngine 只消费已解析的
 * 数值/对象属性，尚未把该集合计数作为 arithmetic amount 动态重算。卡牌程序静态能力到图层的
 * 生产绑定也仍由 RIFT-257 负责；按红线不做近似实现（不得改用 Buff counter）。
 *
 * 依赖：RIFT-257（CardProgram 到 layers 的绑定）与动态 count 图层求值缺口。
 */
const drMundoExpert = {
  canonicalCardId: "card.hash-e6d907e16eabec4df39898b5e0b88759b3c4a756d746eb210b9feaa3437d822e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 与 arithmetic 图层已经合入，但本卡 amount 是「你 trash 中的牌数」count 表达式；" +
    "当前 LayerEngine 尚未把该集合计数作为静态 Might 的动态 amount 求值并在 trash 变化后重算（CR v1.5 479.4）。" +
    "同时 CardProgram 静态能力到 layers 的生产绑定仍依赖 RIFT-257；beginning-start/effect.recycle 局部能力已有执行证据，不近似实现。",
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
