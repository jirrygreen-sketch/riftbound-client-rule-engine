import type { CardProgram } from "../../ir/index.js";

/**
 * Grim Resolve (unl-095-219) — Spell, 2 energy, no printed power, no Might,
 * Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-095-219，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Give a friendly unit +3 :rb_might: this turn. When it wins a combat this
 *    turn, gain 2 XP."
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Give a friendly unit +3 [M] this turn」：该友方单位由玩家选择（355.5），是
 *   目标（355.7 / 355.9.a.1）；"+3 [M] this turn" 是带回合末期限的临时 Might
 *   修正，归 layers 的 continuous.might（契约 3.4 的 arithmetic 图层；effect.buff
 *   的文件头明确 Buff 计数 702 与临时 Might 修正是两回事），到期按 317.2.c 的
 *   "this turn" 统一清理。
 * - 「When it wins a combat this turn」："wins a combat" 取 468.3.a 的判定
 *   （玩家在确定战斗结果步骤赢得战斗，468.3.c：该战场的单位继承其控制者的战斗
 *   结果），对应封闭时点 combat-result（payloadFields 含 winnerId/loserId/
 *   unitResults，ruleRefs 468.3.a–d、468.4）；"it" 指前一句选中的单位，"this turn"
 *   是窗口（317.2.c）。
 * - 「gain 2 XP」是已合入的 effect.xp（728–730），获得者是能力控制者（190.6.d）。
 *
 * status = judge-required（不近似实现）：
 * - 临时 Might 修正没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *   动作，effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，
 *   卡牌程序也没有把持续效果注册进 layers 的指令入口（ctx.addContinuous 目前没有
 *   卡牌侧消费者；同 pridestalker / frigid-touch 的缺口，依赖 RIFT-91 的接线）。
 * - 延迟触发没有注册原语："When it wins a combat this turn" 是 Delayed Ability
 *   （390 / 391.2 / 392），ResolveContext.registerDelayedTrigger 存在但注册表没有
 *   trigger.delayed opcode（RIFT-9），combat-result 时点也没有被 emit 进单管线；
 *   "it" 需要触发事件对象选择器（359.3.f.3 的绑定），两端都缺。
 * - 两个子句共享同一目标：第一条指令的 TargetSpec 由第二条引用（359.3.f.3），
 *   但触发时点/延迟窗口未落地。
 * 依赖：RIFT-91（layers 接线）、RIFT-9 的 trigger.delayed 与 combat-result 时点接线。
 */
const grimResolve = {
  canonicalCardId: "card.hash-f385047d7a4e0de7205afceb0e18bea608003fce1dfced764451413396098017",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「+3 [M] this turn」是临时 Might 修正，归 layers 的 continuous.might（CR 317.2.c 的 this turn 到期），" +
    "但契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有 continuous.might / effect.might-modify 原语，" +
    "卡牌 static/持续效果也没有注册进图层的指令入口（ctx.addContinuous 目前无卡牌侧消费者；同 pridestalker、frigid-touch 的缺口，RIFT-91）。" +
    "(2)「When it wins a combat this turn」是延迟触发能力（CR 390/391.2/392，468.3.a 的胜负判定 + 317.2.c 的窗口）：" +
    "没有卡牌可用的 trigger.delayed opcode（RIFT-9），combat-result 时点也没有被 emit 进唯一事件管线，\"it\" 所需的触发事件对象绑定（359.3.f.3）同样缺失；" +
    "effect.buff 是 702 的 Buff 计数器，不是临时 Might 修正，不用它冒充。「gain 2 XP」本身是已合入的 effect.xp。" +
    "依赖：RIFT-91、RIFT-9 的 trigger.delayed 与 combat-result 时点接线。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // 未注册 op：临时 Might 修正的保留形状（见 judgeReason）。
          id: "grim-resolve.grant-3-might",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            layer: { kind: "constant", value: "arithmetic" },
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "grim-resolve.friendly-unit",
              filter: { zone: "board", type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 未注册 op：延迟触发的保留形状（见 judgeReason）；"it" 指上一条指令的
          // 同一目标，combat-result 为订阅时点、this-turn 为窗口。
          id: "grim-resolve.win-combat-xp",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "combat-result" },
            filter: {
              kind: "constant",
              value: {
                event: "combat-result",
                // 468.3.c：该战场的单位继承其控制者的战斗结果；"it" 需要把
                // unitResults 中胜方的这个单位绑定为事件对象（缺选择器，见 judgeReason）。
                object: { target: "grim-resolve.friendly-unit" },
                winner: "controller"
              }
            },
            duration: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "grim-resolve.gain-2-xp",
                  op: "effect.xp",
                  args: { amount: { kind: "constant", value: 2 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a friendly unit +3 :rb_might: this turn. When it wins a combat this turn, gain 2 XP."
} satisfies CardProgram;

export default grimResolve;
