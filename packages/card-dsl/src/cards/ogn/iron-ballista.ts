import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Iron Ballista (ogn-017-298) — Gear, 3 Energy, Fury.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-017-298):
 *   This enters exhausted.
 *   :rb_exhaust:: Deal 2 to a unit at a battlefield.
 *
 * 规则依据（CR v1.5）：
 * - “This enters exhausted.” 是入场状态改写：非单位 Gear 默认就绪进场
 *   （149.1、359.2.d），本卡把它改成横置进场。入场状态属于替代族
 *   （替代在动作执行前拦截，契约 3.5），与 Accelerate 805.6 的
 *   “不先横置再就绪”是同一条路径；effect.exhaust 的文档明确入场横置不是
 *   一次横置动作（先入场再补 effect.exhaust 会多出一次“成为横置”事件、并
 *   错过入场替代），所以这里不能拿 effect.exhaust 近似。program 用
 *   replacement 能力 + replacement.enter 绑定描述该状态改写。
 * - “:rb_exhaust:: Deal 2 to a unit at a battlefield.” 是 Gear 的启动能力
 *   （151、151.2：控制者 Main Phase 的 Open State 可执行，等同无卡法术），
 *   费用是横置自身（415.3.a、415.5，属 cost.exhaust / 费用计划），效果是
 *   effect.damage（418，目标为战场上的单位，355.10.b 的“at a battlefield”
 *   是选择限制而不是额外目标）。
 *
 * Status: executable. programs/ lifecycle binds replacement.enter before the
 * Gear moves from Chain to Board; the orientation is applied on Chain and emits
 * no Board exhaust event (149.1 / 359.2.d / 369.3). describeActivate binds the
 * exhaust cost and the battlefield target through Finalize and resolution.
 * The string location filter is consumed by the production layer query for
 * every battlefield; it does not require choosing a battlefield (355.10.b).
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self" } },
    with: [
      {
        // “This enters exhausted.” — 入场状态改写，不是一次横置动作。
        // 消费方是入场替代管线（replacement.enter，契约 3.5）。
        id: "iron-ballista.enter-exhausted",
        op: "replacement.enter",
        args: {
          state: { kind: "constant", value: "exhausted" },
          zone: { kind: "constant", value: "board" }
        }
      }
    ]
  },
  {
    kind: "activated",
    // Gear 启动能力默认 Action 时机（151.2）；费用是横置自身（415.3.a）。
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    timing: "action",
    body: [
      {
        id: "iron-ballista.deal-2",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "unit-at-battlefield" }
        },
        targets: [
          {
            id: "unit-at-battlefield",
            // “a unit at a battlefield”：任一战场上的单位，位置限制而不是
            // 额外目标（355.10.b）。
            filter: { type: "unit", zone: "board", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-d434f43890dfb7e3149efa46b08c5871f835e6526d2eeb6493d14f5157f3251e",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "This enters exhausted.\n:rb_exhaust:: Deal 2 to a unit at a battlefield."
} satisfies CardProgram;

export default program;
