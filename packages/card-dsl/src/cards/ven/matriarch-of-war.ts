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
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-bf30c710a85c78a9c386b4d6c5d52a3aa4ff1d9d0eba7b82b1ba9ef0917f2b94",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) empowered-changed 不在 EVENT_PATTERN_TYPES，触发适配器不消费 other/direction，事件未区分前后状态及实际动作玩家，无法实现 When you empower something else（442.2.a / 828.1.d）；" +
    "(2) cost/plan-values.ts 尚无 disempower 支付种类（443.2.a），因此即便 rainbow 任意域 1 Power 已正确表达，整条费用仍不可支付；" +
    "(3) 参考内核 empower 对已 Empowered 对象仍累加，缺 442.1.b/.c 的二元状态幂等保证。",
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
        payments: [
          { kind: "disempower", object: "self" },
          { kind: "power", amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] },
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
