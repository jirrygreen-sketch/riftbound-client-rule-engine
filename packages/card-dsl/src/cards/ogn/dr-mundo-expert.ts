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
 * 状态：judge-required。已合入的时点、filter 与 effect.recycle 都能表达触发句，
 * 但静态 Might 加成还不能执行：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 * 图层消费者（continuous.might / RIFT-91）与「按 trash 张数动态取值、随 trash 变化
 * 重算」的依赖求值都未合入；按红线不做近似实现（不得改用 Buff counter）。
 *
 * 依赖：RIFT-91（layers-continuous，continuous.might + 动态依赖求值）。
 */
const drMundoExpert = {
  canonicalCardId: "card.hash-e6d907e16eabec4df39898b5e0b88759b3c4a756d746eb210b9feaa3437d822e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「My Might is increased by the number of cards in your trash」需要 continuous.might 图层加法" +
    "（契约 3.6 封闭 GameAction 无 Might 修改动作）与「按 trash 张数动态取值、依赖变化后重算」" +
    "（CR v1.5 479.4 图层依赖）；layers/continuous.might 消费者（RIFT-91）未合入，不近似实现。" +
    "触发句（beginning-start + effect.recycle from trash）本身可表达并有执行测试。" +
    "依赖：RIFT-91（layers-continuous）。",
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
