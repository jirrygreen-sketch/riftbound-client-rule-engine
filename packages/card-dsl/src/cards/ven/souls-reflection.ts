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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：触发体 empower me（effect.empower）与
 * 临时 -2 Might（continuous.might + 图层引擎 + turn-end 到期）都已有 golden 执行证据。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. 触发的两项过滤无法表达：封闭时点 empowered-changed 存在且可触发，但
 *    events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有 empowerment 事件判别值
 *    （validateTriggerSpec 会拒绝 event: "empowered-changed"），事件载荷/EventPattern
 *    也没有“增加方向”（empower 与 disempower 共用该时点，443.1/443.1.a）与排除宿主
 *    自身的 “something else” 键；body（empower me，来源即宿主，827.1.b.1 不是目标）
 *    本身可用已合入的 effect.empower 执行；
 * 2. “Disempower me” 作为费用需要 disempower 付费种类，但 cost/plan-values.ts 的
 *    非标准费用仍只支持 exhaust/discard/recycle/kill/reveal/spend-buff
 *    （RIFT-261 的费用种类批次仍在进行，未合入 disempower）；
 * 3. 临时 Might -2 所需的 continuous.might 指令原语已由 RIFT-258 合入（本次复核由
 *    golden 用真实解释器 + 图层引擎执行：结束于 turn-end 的 arithmetic 注册、-2 生效），
 *    但整卡仍被触发过滤与 disempower 费用阻断，故保持 judge-required。
 * 依赖：事件载荷/触发器过滤扩展（契约变更请求）、RIFT-261（disempower 付费种类）。
 */
export default {
  canonicalCardId: "card.hash-96a4d656fe980065c6206e2b07389b146cc4347f8396756aeeb3b2ef9c30a281",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条缺口（复核 2026-10-17；empower 体与 -2 Might 图层 golden 均已真实执行，不再列缺口）：" +
    "(1) “When you empower something else” 的触发器过滤不可表达——封闭时点 " +
    "empowered-changed（442.2.a）的载荷/EventPattern 没有增加方向（empower 与 disempower " +
    "共用该时点，443.1），也没有排除宿主自身的 “something else” 键（events/trigger-spec.ts " +
    "的 ObjectFilter 只允许 objectId/cardId/type/controller/owner/zone/location/states/tags/" +
    "characteristics，且 EVENT_PATTERN_TYPES 没有 empowerment 判别值，validateTriggerSpec " +
    "会拒绝 event: \"empowered-changed\"），事件载荷的 previousCount/currentCount 也未被 " +
    "action-adapter 填充；(2) “Disempower me” 作为费用" +
    "需要 disempower 付费种类（443.2.a），cost/plan-values.ts 的非标准费用仍只支持 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff（仍在进行的 RIFT-261 尚未合入 disempower）；" +
    "整卡仍被触发过滤与 disempower 费用阻断，保持 judge-required。“-2 :rb_might: this turn” 的 " +
    "continuous.might 原语已合入，golden 用真实解释器 + 图层引擎执行（end-of-turn 到期的 " +
    "arithmetic 注册、实际 -2）。依赖事件载荷/过滤器扩展（契约变更请求）、" +
    "RIFT-261（disempower 付费种类）。不近似实现。",
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
