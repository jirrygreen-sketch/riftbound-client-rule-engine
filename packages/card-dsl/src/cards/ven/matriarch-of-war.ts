import type { CardProgram } from "../../ir/index.js";

/**
 * Matriarch of War (ven-153-166) — Legend, Body/Order, Ambessa.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-153-166，逐字）：
 *   When you empower something else, empower me. (I become Empowered if I'm
 *   not already.)
 *   Disempower me, :rb_rune_rainbow:, :rb_exhaust:: Ready a unit.
 *
 * 规则依据（Core Rules v1.5）：
 * - 触发条件与 Soul's Reflection 同型：383.1/383.2.a 的 “When you empower
 *   something else”，对应 442.2.a 的可引用 Empowered 事件时点 "empowered-changed"。
 * - 404.1.a/415.5：印刷 “Disempower me, :rb_rune_rainbow:, :rb_exhaust:” 中 “:” 前的
 *   Disempower、任意域 Power 与 Exhaust 都是启动费用；443.2/443.2.a 的 Disempower
 *   是 Limited Action；135.2.e.5.a/163.2.b 的 [A] 是任意域 Power。
 * - “Ready a unit” 是普通目标效果（355.9.a.1：未特别说明时 “unit” 指 Board 上的单位），
 *   使用已合入的 effect.ready（416.1–416.3）。
 *
 * status = judge-required（两处当前缺口均不近似实现）：
 * 1. 触发过滤缺“增加方向”与“something else”宿主排除键，且 EVENT_PATTERN_TYPES 没有
 *    empowerment 事件判别值（empowered-changed 的载荷不带 direction，EventPattern 无
 *    exclude；见 Soul's Reflection 的同型缺口）；已合入的 translateObjectFilter 仍会
 *    以 unsupported filter field 拒绝 other/direction（契约变更请求）；
 * 2. cost/plan-values.ts 没有 disempower 付费种类；[A] 任意域 Power 已用六域封闭
 *    Domain 集合表达，不再是缺口。
 * 依赖：事件载荷/触发器过滤扩展（契约变更请求）与 disempower 费用种类；Ready 半段已可用
 * effect.ready 真实执行。
 */
export default {
  canonicalCardId: "card.hash-bf30c710a85c78a9c386b4d6c5d52a3aa4ff1d9d0eba7b82b1ba9ef0917f2b94",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) “When you empower something else” 的触发器过滤不可表达——封闭时点 " +
    "empowered-changed（442.2.a）的载荷/EventPattern 没有增加方向（empower 与 disempower " +
    "共用该时点，443.1），也没有排除宿主自身的 “something else” 键（EVENT_PATTERN_TYPES 无 " +
    "empowerment 判别值，validateTriggerSpec 会拒绝该 event 拼写；已合入的过滤适配器仍无法消费 " +
    "translateObjectFilter 也只接受白名单字段，other/direction 会被判为 unsupported filter field）；" +
    "(2) “Disempower me” " +
    "作为费用需要 disempower 付费种类（443.2.a），cost/plan-values.ts 的非标准费用只支持 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff；:rb_rune_rainbow: 是任意域 " +
    "Power [A]（135.2.e.5.a、163.2.b），已按六域封闭集合表达。依赖事件载荷/过滤器扩展 " +
    "（契约变更请求）与 disempower 费用种类；“Ready a unit” " +
    "本体用已合入的 effect.ready 可执行。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "empowered-changed",
        filter: {
          event: "empowered-changed",
          filter: {
            player: "self",
            other: true,
            direction: "increase"
          }
        }
      },
      optional: false,
      body: [
        {
          id: "matriarch-of-war.empower-self",
          op: "effect.empower",
          args: {
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
        // :rb_rune_rainbow: = [A]；任意一个封闭域都可支付，因此列出六域。
        power: { kind: "constant", value: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] },
        payments: [
          { kind: "disempower", object: "self" },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "matriarch-of-war.ready-unit",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "matriarch-of-war.unit" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "matriarch-of-war.unit",
              filter: { type: "unit", zone: "board" },
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
    "Disempower me, :rb_rune_rainbow:, :rb_exhaust:: Ready a unit."
} satisfies CardProgram;
