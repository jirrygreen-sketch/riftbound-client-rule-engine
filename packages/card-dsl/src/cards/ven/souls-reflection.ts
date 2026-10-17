import type { CardProgram } from "../../ir/index.js";

/**
 * Soul's Reflection (ven-151-166) — Legend, Mind/Chaos, Mel.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-151-166，逐字）：
 *   When you empower something else, empower me. (I become Empowered if I'm
 *   not already.)
 *   Disempower me, :rb_exhaust:: Give a unit at a battlefield -2 :rb_might:
 *   this turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1/383.2.a：“When you empower something else …” 是触发条件；
 *   442.2.a 规定成为 Empowered 是 Game Effects/Triggered Abilities 可引用的事件，
 *   封闭时点表里对应 "empowered-changed"（payloadType empowerment）。
 * - 827.2/827.2.a 同义：Empower 动作完成后来源成为 Empowered 并产生可引用事件。
 * - 404.1.a/415.5：印刷 “Disempower me, :rb_exhaust:” 中 “:” 前的两项都是启动
 *   费用；443.2/443.2.a 说明 Disempower 是 Limited Action，只能由游戏效果指示执行。
 * - “Give a unit at a battlefield -2 Might this turn” 是临时 Might 修正，归 layers 的
 *   continuous.might（effect.buff 边界注释明确临时 Might 不进入 Buff 计数器）。
 *
 * 复核（2026-10-17 RIFT-618 第三轮 M2 覆盖率复核；结论以源码与本任务 golden 实测为准）：
 * 触发体 empower me（effect.empower，827.2）与临时 -2 Might（continuous.might + 图层
 * 引擎 + turn-end 到期）都已有 golden 执行证据；旧理由里“empower 展开缺失”的说法已过时
 * （effects/keywords/Empower.ts 已由 RIFT-593 合入）。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. 触发过滤无法表达：empowered-changed 是封闭时点，但 EVENT_PATTERN_TYPES 没有
 *    empowerment 判别值（validateTriggerSpec 直接拒绝 event: "empowered-changed"，
 *    本任务实测 assertTriggerSpec 抛 TriggerSpecValidationError）、EventPattern 没有
 *    “增加方向”键（empower 与 disempower 共用该时点，443.1）、也没有排除宿主自身的
 *    “something else”键；action-adapter.ts 发出的载荷只带 previous/current 计数选项，
 *    没有可过滤的方向字段。
 * 2. “Disempower me” 是费用但没有付费种类：cost/plan-values.ts 的非标准费用仍只支持
 *    exhaust/discard/recycle/kill/reveal/spend-buff，本任务实测 buildCostPlan 对
 *    { kind: "disempower" } 抛 CostPlanError "Unsupported payment kind: disempower"。
 * 依赖：闭合时点过滤扩展（契约变更请求）与 disempower 付费种类。
 */
export default {
  canonicalCardId: "card.hash-96a4d656fe980065c6206e2b07389b146cc4347f8396756aeeb3b2ef9c30a281",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条当前缺口（复核 2026-10-17，RIFT-618；均不近似实现）：" +
    "(1) 「When you empower something else」的触发过滤不可表达：EVENT_PATTERN_TYPES 没有 empowerment " +
    "判别值，本任务实测 assertTriggerSpec 对 event: \"empowered-changed\" 抛 TriggerSpecValidationError；" +
    "EventPattern 也没有增加方向键（442.2.a/443.1 的 empower 与 disempower 共用此时点）与排除宿主自身的" +
    "「something else」键，action-adapter.ts 的载荷没有可过滤的方向字段。" +
    "(2) 「Disempower me」作为费用需要 disempower 付费种类（443.2.a），cost/plan-values.ts 的非标准费用" +
    "仍只支持 exhaust/discard/recycle/kill/reveal/spend-buff；本任务实测 buildCostPlan 对 " +
    "{ kind: \"disempower\" } 抛 CostPlanError \"Unsupported payment kind: disempower\"。" +
    "已合入且有真实执行证据：触发体的 effect.empower（827.2/827.2.a）经参考内核真实改变状态并写出" +
    "empowered 链接值；「-2 :rb_might: this turn」的 continuous.might 经真实解释器 + 图层引擎注册，" +
    "按 turn-end 到期并实际 -2（478/478.1.a，不触碰 Buff 计数器）。" +
    "依赖：闭合时点过滤扩展（契约变更请求）、disempower 付费种类。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "empowered-changed",
        filter: {
          event: "empowered-changed",
          filter: {
            // event.player === 能力控制者 → “you empower”。
            player: "self",
            // “something else”：事件对象不是宿主自身。触发过滤没有“another/排除本卡”
            // 键（对照 cithria-of-cloudfield 的同款判定），此处保留描述性 other。
            other: true,
            // 只响应增加方向；当前载荷不带该字段。
            direction: "increase"
          }
        }
      },
      optional: false,
      body: [
        {
          id: "souls-reflection.empower-self",
          op: "effect.empower",
          args: {
            // “empower me”: 827.1.b.1 的来源自身，不是目标。
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          // “Disempower me” + “:rb_exhaust:” 两项印刷费用；disempower 尚无付费种类。
          { kind: "disempower", object: "self" },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "souls-reflection.debuff-unit",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            target: {
              kind: "constant",
              value: "souls-reflection.unit-at-battlefield"
            }
          },
          targets: [
            {
              id: "souls-reflection.unit-at-battlefield",
              filter: {
                type: "unit",
                zone: "board",
                location: { type: "battlefield" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you empower something else, empower me. (I become Empowered if I'm not already.)\n" +
    "Disempower me, :rb_exhaust:: Give a unit at a battlefield -2 :rb_might: this turn."
} satisfies CardProgram;
