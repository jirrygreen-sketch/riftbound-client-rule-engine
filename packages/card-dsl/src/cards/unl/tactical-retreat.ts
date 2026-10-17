import type { CardProgram } from "../../ir/index.js";

/**
 * Tactical Retreat (unl-175-219) — Spell, 2 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-175-219，逐字):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a friendly unit. The next time it would die this turn, heal it, exhaust
 *   it, and recall it instead. (Send it to base. This isn't a move.)
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813）是许可类关键词：813.1.b/813.1.c 允许在任意玩家的回合的
 *   Closed State 期间打出。卡牌只声明关键词（契约 3.7）。
 * - 「Choose a friendly unit」按 355.10.c 的目标是所选友方单位：该条规则的示例正是
 *   「Choose a friendly unit. The next time it would die this turn, return it to
 *   your hand instead」——因为选择不属于替代效果本身。故用 TargetSpec。
 * - 「The next time it would die this turn, … instead」是替代效果（368.1 的被动能力
 *   可以是替代效果；369.1 用 "would" 标识），被替代的事件不会发生，且印刷的
 *   「the next time」把窗口限定为一次性且本回合内有效。
 * - 「heal it」是 419.1–419.3.a 的清除已标记伤害（effect.heal）；「exhaust it」是
 *   415.1 的横置（effect.exhaust）；两者都作用于同一指代 "it"（355.10.c：不是新的
 *   目标选择），因此共用同一个 TargetSpec 并由第二条指令链接前一条（359.3.e.14）。
 * - 「and recall it instead」是 457 的 Recall：把永久移至其基地且不是 Move（458），
 *   458.1 不触发 Move 触发；460.1 规定 Recall 不影响状态，本卡没有写 exhausted，
 *   所以不额外声明横置以外的状态改变。
 *
 * status: judge-required —— 以下当前缺口均不近似实现:
 * - replacement.event 已注册为可执行指令，且会把 constant 包装的 instead body 解包后
 *   交给 bindReplacement；但正常 ResolveContext 仍没有 replacement /
 *   replacementDependencies 扩展，play body 无法把登记安装到事件管线（replacement.enter.ts
 *   明确按 BlockedReplacementError 失败）。
 * - 「Choose a friendly unit」按 355.10.c 是目标并已用 TargetSpec 编码，object 字段也保留
 *   了该 Finalize 目标；但 replacement.event 的 object 绑定明确需要尚未合入的 Finalize
 *   target adapter，指令上的 targets 不会自动成为替代过滤器。因此不能把替代限定到所选单位。
 * - 「recall it」不可执行：effect.move 的 mode "recall" 被 planner 显式阻断（封闭
 *   move-location 动作无法区分 Recall 与 Move，CR 457–460），不得用普通移动近似
 *   （458.1 会错误触发 Move 触发）。
 * - 替代 planner 的 effect.heal 在不给 amount 时按 1 计划，而不是 419.1 的「清除全部
 *   已标记伤害」；解释器本体已能按印刷语义清除全部伤害，替代计划路径仍不能执行该半段。
 * 形状按已合入的 ogs/highlander-yi（同型措辞）书写；golden 对已支持的替代绑定、被替代
 * 事件对象链接与 heal / exhaust 通过真实解释器/事件管线执行。
 *
 * 依赖：ResolveContext 的 replacement 依赖扩展与 Finalize 目标适配、Recall 独立动作、
 * replacement planner 的无 amount heal 语义。
 */
const program = {
  canonicalCardId: "card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前仍有四处缺口，均不近似实现：(1) replacement.event 已注册并支持 next-time-this-turn（the next time）一次性窗口，会把 constant 包装的 instead body 解包后交给 bindReplacement，" +
    "但正常 ResolveContext 没有 replacement / replacementDependencies 扩展，play body 无法把登记安装到事件管线；" +
    "replacement.enter.ts 对此明确抛 BlockedReplacementError。(2)「Choose a friendly unit」按 355.10.c 是目标并已用 TargetSpec 编码，" +
    "object 字段也保留了该 Finalize 目标，但 replacement.event 的 object 绑定需要尚未合入的 Finalize target adapter，" +
    "指令上的 targets 不会自动成为替代过滤器，因而不能把替代限定到所选单位。(3)「recall it」不可执行：effect.move 明确阻断 mode \"recall\"" +
    "（封闭 move-location 动作无法区分 Recall 与 Move，CR 457–460），用普通移动近似会错误触发 Move 触发（458.1）。" +
    "(4) 替代 planner 的 effect.heal 在不给 amount 时按 1 计划，而 419.1 的「heal it」要求清除全部已标记伤害；" +
    "解释器本体已能执行该语义，替代计划路径仍不能执行。替代体里的 { linked: \"replacement.object\" }、heal（419.1）与 exhaust（415.1）" +
    "均已在 golden 中经真实事件管线覆盖。依赖：ResolveContext replacement 依赖扩展、Finalize 目标适配、Recall 独立动作与 planner 的无 amount heal 语义。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Choose a friendly unit. The next time it would die this turn, …
          // instead.」：选择本身是目标（355.10.c 示例）；替代登记原语与被替代
          // 事件注册由已合入的 replacement.event 指令承担；目标绑定与
          // ResolveContext replacement 依赖仍按 judgeReason 保持 fail-closed。
          id: "tactical-retreat.register-death-replacement",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: { event: "object-killed" } },
            window: { kind: "constant", value: "next-time-this-turn" },
            object: { kind: "constant", value: "tactical-retreat.chosen-unit" },
            instead: {
              kind: "constant",
              value: [
                {
                  id: "tactical-retreat.heal",
                  op: "effect.heal",
                  args: {
                    objects: {
                      kind: "constant",
                      // 「it」= 被替代事件的对象（355.10.c），用已合入的
                      // 链接选择器 spelling；planner 在 apply 时绑定它。
                      value: { linked: "replacement.object" }
                    }
                  }
                },
                {
                  id: "tactical-retreat.exhaust",
                  op: "effect.exhaust",
                  linkedTo: "tactical-retreat.heal",
                  args: {
                    target: { kind: "constant", value: { linked: "replacement.object" } }
                  }
                },
                {
                  id: "tactical-retreat.recall",
                  op: "effect.move",
                  linkedTo: "tactical-retreat.exhaust",
                  args: {
                    objects: { kind: "constant", value: { linked: "replacement.object" } },
                    to: { kind: "constant", value: "controller-base" },
                    mode: { kind: "constant", value: "recall" }
                  }
                }
              ]
            }
          },
          targets: [
            {
              id: "tactical-retreat.chosen-unit",
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default program;

