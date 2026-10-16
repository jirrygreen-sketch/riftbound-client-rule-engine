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
 * status: judge-required —— 三处依赖未合入，均不近似实现:
 * - 卡牌级替代效果没有注册路径：事件管线把替代登记为动作匹配器，但没有
 *   「卡牌程序 → 注册」的接线（引擎批 4 / RIFT-120），effects/instructions 也没有
 *   replacement.event 原语（与已合入的 ogs/highlander-yi 同一缺口）。
 * - 印刷的「the next time」一次性窗口没有表示：TriggerSpec.once 只有
 *   per-turn / per-combat / per-chain / per-game，卡牌程序登记的替代也没有回合末
 *   到期接线。
 * - 被替代事件的对象没有 ObjectSelector 可绑定：冻结 IR 只有
 *   self/source/target/pick/linked，替代体里的 "it" 必须由触发系统在事件发生时就地
 *   绑定（355.10.c）。
 * - 「recall it」不可执行：effect.move 的 mode "recall" 被原语显式阻断（封闭
 *   move-location 动作无法区分 Recall 与 Move，CR 457–460），不得用普通移动近似
 *   （458.1 会错误触发 Move 触发）。
 * 形状按已合入的 ogs/highlander-yi（同型措辞）书写；golden 对被替代结果里的
 * heal / exhaust 两条已合入指令用真实解释器执行。
 *
 * 依赖：RIFT-120（替代注册/延迟触发与事件对象绑定）、Recall 独立动作（RIFT-109 后续）、
 * once 作用域（RIFT-89）。无契约变更请求。
 */
const program = {
  canonicalCardId: "card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处依赖未合入：(1) 卡牌级替代效果没有注册路径——事件管线以动作匹配器注册替代，但没有 CardProgram → 注册的接线" +
    "（引擎批 4 / RIFT-120），effects/instructions 也没有 replacement.event 原语；(2) 印刷的「the next time」一次性窗口没有表示：" +
    "TriggerSpec.once 只有 per-turn / per-combat / per-chain / per-game，且卡牌程序登记的替代没有回合末到期接线；" +
    "(3) 被替代事件的对象没有被替代体的 ObjectSelector 绑定（冻结 IR 只有 self/source/target/pick/linked），替代体里的 " +
    "\"it\" 必须由事件系统就地绑定（355.10.c）；(4)「recall it」不可执行：effect.move 明确阻断 mode \"recall\"" +
    "（封闭 move-location 动作无法区分 Recall 与 Move，CR 457–460），用普通移动近似会错误触发 Move 触发（458.1）并改变状态（460.1）。" +
    "「Choose a friendly unit」按 355.10.c 是目标并已用 TargetSpec 编码；替代体里的 heal（419.1）与 exhaust（415.1）" +
    "是已合入指令，在 golden 中经真实解释器执行。依赖：RIFT-120、Recall 独立动作（RIFT-109 后续）、once 作用域（RIFT-89）。",
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
          // 事件对象绑定未合入（见 judgeReason），故只保留可审查的形状。
          id: "tactical-retreat.register-death-replacement",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: "object-killed" },
            window: { kind: "constant", value: "next-time-this-turn" },
            // "it" 指所选单位（355.10.c）。
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
                      // effect.heal 的选择描述形状（{ kind: "target", id }）。
                      value: { kind: "target", id: "tactical-retreat.chosen-unit" }
                    }
                  }
                },
                {
                  id: "tactical-retreat.exhaust",
                  op: "effect.exhaust",
                  linkedTo: "tactical-retreat.heal",
                  args: { target: { kind: "constant", value: "tactical-retreat.chosen-unit" } }
                },
                {
                  id: "tactical-retreat.recall",
                  op: "effect.move",
                  linkedTo: "tactical-retreat.exhaust",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "tactical-retreat.chosen-unit" }
                    },
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

