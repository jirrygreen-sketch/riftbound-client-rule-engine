import type { CardProgram } from "../../ir/index.js";

/**
 * Blind Monk (ogn-257-298) — Legend, Calm/Body, Lee Sin.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-257-298，逐字）：
 *   :rb_energy_1:, :rb_exhaust:: Buff a friendly unit. (If it doesn't have a
 *   buff, it gets a +1 :rb_might: buff.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 前是费用——1 Energy + 横置来源；合并费用管线
 *   （cost/plan-values.ts、cost/payment.ts）支持 energy 与 { kind: "exhaust", object: "self" }。
 * - 174.8 / 376：Legends 可以有启动能力；能力进链并像法术一样结算。本卡没有
 *   [Reaction]，默认 Action 时机（338.1.a.1 的默认许可），IR 用 timing: "action"。
 * - 427.1.b / 427.2 / 427.3 / 702.2.a：“Buff a friendly unit” 是一个 Buff 动作，
 *   目标是单个由你控制的单位（355.10 的 choose），合并原语 effect.buff（mode buff）
 *   执行；702.3 / 702.3.a：已有 Buff 的单位仍可被选择，但没有新 Buff 落下。
 * - 703：每个 Buff 提供 +1 Might，由图层从 Buff 计数派生（不是本卡的指令）。
 *
 * status = executable：费用（1 Energy + Exhaust 自身）、目标 Finalize/Resolve、
 * 解释器与 effect.buff 原语均已合入，golden 用真实费用计划（cost/）、真实解释器与
 * 参考内核执行费用与正文，并覆盖已 Buff 的无操作（427.1.c / 702.3.a）与目标失效
 * （359.3.e.5–e.7）。与已合入的 assembly-rig / grand-duelist 一致，
 * “CardProgram → ChainDraft” 的生产适配是引擎级接线（见 test.todo），不是本卡语义缺口。
 * “a friendly unit” 的 controller 锚点由目标系统按 355.10 在 Finalize 解析
 * （与 ogn-136-298 Pit Rookie 的既有写法一致）；golden 以锁定目标验证原语行为。
 */
const blindMonk = {
  canonicalCardId:
    "card.hash-2ea191d1465e7251d43eb6e67e9cbb86d9e05e26dd213006d4d95001a73df327",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "blind-monk.buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller" },
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
    ":rb_energy_1:, :rb_exhaust:: Buff a friendly unit. (If it doesn't have a buff, " +
    "it gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default blindMonk;
