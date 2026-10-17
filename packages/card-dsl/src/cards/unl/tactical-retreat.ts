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
 * status: judge-required —— 依赖未合入的部分，均不近似实现:
 * - 替代绑定点已合入（RIFT-260 的 replacement/）：bindReplacement 支持
 *   replacement.event 的 event/window/instead 声明，window "next-time-this-turn"
 *   是绑定回合内的一次性窗口；被替代事件的对象用链接选择器
 *   { linked: "replacement.object" } 绑定（355.10.c 的 "it"），planner 也支持
 *   heal / exhaust 这类封闭动作。golden 已用真实 move-zone/事件管线验证到这一层。
 *   仍缺的是卡牌程序 → 该绑定点的生产接线（programs/ 适配器没有运行时调用方，RIFT-257）。
 * - 「Choose a friendly unit」按 355.10.c 是目标并已用 TargetSpec 编码；但替代体里的
 *   "it" 目前只能写成链接选择器，而**替代登记指令自己的 targets**（选择本身）在
 *   replacement 能力上没有承载位置：能力级 replaces/with 结构不含 TargetSpec，
 *   所以「选择的目标 → 被替代事件对象」这一步仍需要程序绑定层补齐（RIFT-257）。
 * - 「recall it」不可执行：effect.move 的 mode "recall" 被原语显式阻断（封闭
 *   move-location 动作无法区分 Recall 与 Move，CR 457–460），不得用普通移动近似
 *   （458.1 会错误触发 Move 触发）。
 * - 替代体的两处形状缺口：replacement.event 的 instead 字段在冻结 Instruction.args
 *   （所有字段都是 Expr）里只能写成 constant 包装，而 bindReplacement 要求裸的
 *   instruction 数组（实测 "replacement.event instead must be an instruction body"）；
 *   planner 的 effect.heal 在不给 amount 时按 1 计划，而不是原语的 419.1「清除全部
 *   已标记伤害」。
 * 形状按已合入的 ogs/highlander-yi（同型措辞）书写；golden 对替代登记、被替代事件
 * 对象绑定与替代体里的 heal / exhaust 用真实解释器/事件管线执行。
 *
 * 依赖：RIFT-257（卡牌程序 → 替代能力的生产接线）、Recall 独立动作、
 * replacement.event 的 instead 字段与 planner 的 heal 缺省语义。
 */
const program = {
  canonicalCardId: "card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处依赖未合入：(1) 替代绑定点已合入（RIFT-260 的 replacement/：bindReplacement 支持 replacement.event 的 " +
    "event/window/instead，window \"next-time-this-turn\" 是绑定回合内的一次性窗口，被替代事件的对象由链接选择器 " +
    "\"replacement.object\" 绑定），golden 已用真实事件管线验证到这一层；仍缺卡牌程序 → 该绑定点的生产接线" +
    "（RIFT-257 的 programs/ 适配器没有运行时调用方）。(2) 印刷的「the next time」一次性窗口在替代登记里可表达，" +
    "但「选择的目标 → 被替代的事件对象」这一步仍需程序绑定层补齐——替代能力（replaces/with）没有承载 TargetSpec 的位置，" +
    "登记指令自己的 targets 不会被 replacement 绑定消费；卡内保留 TargetSpec 是为了 355.10.c 的目标语义与审查。" +
    "(3) 被替代事件的对象用已合入的 { linked: \"replacement.object\" } 选择器绑定（355.10.c 的 \"it\"）；" +
    "(4)「recall it」不可执行：effect.move 明确阻断 mode \"recall\"" +
    "（封闭 move-location 动作无法区分 Recall 与 Move，CR 457–460），用普通移动近似会错误触发 Move 触发（458.1）并改变状态（460.1）。" +
    "(5) 替代体本身还有两处形状缺口：instead 字段在冻结 Instruction.args 里只能写成 constant 包装，而 bindReplacement 要求裸 instruction " +
    "数组（实测 \"replacement.event instead must be an instruction body\"）；planner 的 effect.heal 在不给 amount 时按 1 计划，" +
    "而 419.1 的「heal it」是清除全部已标记伤害。" +
    "「Choose a friendly unit」按 355.10.c 是目标并已用 TargetSpec 编码；替代体里的 heal（419.1）与 exhaust（415.1）" +
    "是已合入指令，在 golden 中经真实事件管线执行。依赖：RIFT-257（卡牌程序 → 替代能力的生产接线）、Recall 独立动作。",
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
          // 事件对象绑定未接通（见 judgeReason），故只保留可审查的形状。
          // event 用已合入 replacement/ 的 EventPattern 形状（字符串在
          // bindReplacement 里会抛 BlockedReplacementError）。
          id: "tactical-retreat.register-death-replacement",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: { event: "object-killed" } },
            window: { kind: "constant", value: "next-time-this-turn" },
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

