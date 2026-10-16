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
 * status = judge-required（三处缺口均不近似实现）：
 * 1. 触发过滤缺“增加方向”与“something else”宿主排除键，且 EVENT_PATTERN_TYPES 没有
 *    empowerment 事件判别值（empowered-changed 的载荷不带 direction，EventPattern 无
 *    exclude；见 Soul's Reflection 的同型缺口）；RIFT-257 的 translateObjectFilter 也会
 *    以 unsupported filter field 拒绝 other/direction（契约变更请求）；
 * 2. cost/plan-values.ts 没有 disempower 付费种类（付费种类与 cost.pay / cost.modify
 *    属未合入的 RIFT-261）；
 * 3. [A] 任意域 Power 无法在六域封闭 Domain 集合中表达（163.2.b；effect.resources
 *    已记录“绝不用某个域近似”），本卡以 ["rainbow"] 作描述性记录。
 * 依赖：事件载荷/触发器过滤扩展（契约变更请求）、RIFT-261；Ready 半段已可用 effect.ready
 * 真实执行。
 */
export default {
  canonicalCardId: "card.hash-bf30c710a85c78a9c386b4d6c5d52a3aa4ff1d9d0eba7b82b1ba9ef0917f2b94",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) “When you empower something else” 的触发器过滤不可表达——封闭时点 " +
    "empowered-changed（442.2.a）的载荷/EventPattern 没有增加方向（empower 与 disempower " +
    "共用该时点，443.1），也没有排除宿主自身的 “something else” 键（EVENT_PATTERN_TYPES 无 " +
    "empowerment 判别值，validateTriggerSpec 会拒绝该 event 拼写；RIFT-257 的 " +
    "translateObjectFilter 也只接受白名单字段，other/direction 会被判为 unsupported filter field）；" +
    "(2) “Disempower me” " +
    "作为费用需要 disempower 付费种类（443.2.a），cost/plan-values.ts 的非标准费用只支持 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff，付费种类与 cost.pay / cost.modify 仍属未合入的 " +
    "RIFT-261；(3) :rb_rune_rainbow: 是任意域 " +
    "Power [A]（135.2.e.5.a、163.2.b），六域封闭 Domain 集合无法表达，仅以描述性 " +
    "[\"rainbow\"] 记录。依赖事件载荷/过滤器扩展（契约变更请求）与 RIFT-261；“Ready a unit” " +
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
        // :rb_rune_rainbow: = [A]；六域封闭集合下没有可执行值，保留描述性记号。
        power: { kind: "constant", value: ["rainbow"] },
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
