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
 *   replacement 能力 + 规划的 replacement.enter 原语描述该状态改写。
 * - “:rb_exhaust:: Deal 2 to a unit at a battlefield.” 是 Gear 的启动能力
 *   （151、151.2：控制者 Main Phase 的 Open State 可执行，等同无卡法术），
 *   费用是横置自身（415.3.a、415.5，属 cost.exhaust / 费用计划），效果是
 *   effect.damage（418，目标为战场上的单位，355.10.b 的“at a battlefield”
 *   是选择限制而不是额外目标）。
 *
 * status = judge-required：入场即横置的 replacement.enter 原语与替代管线已经合入，
 * 并由 golden 直接绑定到 pipeline adapter 验证；Damage 半段（费用 + effect.damage）
 * 也全部使用已合入的费用计划与原语。整张卡仍等待 CardProgram → replacement/activated
 * 能力的生产接线（RIFT-257），所以不能把已支持的入场半段当成整卡 executable。
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
            filter: { type: "unit", location: { type: "battlefield" } },
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
  status: "judge-required" as const,
  judgeReason:
    "replacement.enter 入场替代原语与 pipeline binding 已合入，能够把 Gear 在进入 Base/Battlefield 前设为横置；" +
    "effect.exhaust 仍不能近似该入场状态（143.4 / 359.2.d），而 Damage 半段只需要已合入的 cost.exhaust 费用计划与 effect.damage 原语，" +
    "均由 golden 真实执行。整张卡仍缺 CardProgram → replacement/activated 能力的生产接线，依赖 RIFT-257；" +
    "因此保持 judge-required，不把入场替代半段冒充为整卡 executable。",
  abilities,
  sourceText: "This enters exhausted.\n:rb_exhaust:: Deal 2 to a unit at a battlefield."
} satisfies CardProgram;

export default program;
