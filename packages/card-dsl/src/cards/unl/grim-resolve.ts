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
 * status = judge-required（已按合入依赖复核，不近似实现）：
 * - 已解决：「Give a friendly unit +3 [M] this turn」由已合入的 continuous.might 原语执行（RIFT-258）：
 *   它经 ctx.addContinuous 注册 arithmetic 层效果，this-turn 映射为 end-of-turn 期限（317.1.a / 468.7.c），
 *   指令改成用契约 3.6 的 objects 选择器指回自己声明的 TargetSpec（原稿的 layer 参数与 targets-only 形状都不是
 *   已注册原语的 args 形状；layer 由原语固定为 arithmetic，见 effects/instructions/continuous.might.ts）。
 * - 剩余缺口：「When it wins a combat this turn」是延迟触发能力（CR 390/391.2/392，468.3.a 的胜负判定 +
 *   317.2.c 的窗口）：没有卡牌可用的 trigger.delayed opcode（RIFT-9，op 未注册），combat-result 时点也没有
 *   被 emit 进唯一事件管线（combat/flow.ts 的结果事务尚未实现），"it" 所需的触发事件对象绑定（359.3.f.3）同样缺失。
 *   两个子句共享同一目标（359.3.f.3），但触发时点/延迟窗口未落地。
 * effect.buff 是 702 的 Buff 计数器，不是临时 Might 修正，不用它冒充。「gain 2 XP」本身是已合入的 effect.xp。
 * 依赖：RIFT-9 的 trigger.delayed 与 combat-result 时点接线（RIFT-124 后续）。
 */
const grimResolve = {
  canonicalCardId: "card.hash-f385047d7a4e0de7205afceb0e18bea608003fce1dfced764451413396098017",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 已解决：「+3 [M] this turn」由已合入的 continuous.might 原语（RIFT-258）经 ctx.addContinuous 注册 arithmetic 层效果，" +
    "this-turn 映射为 end-of-turn 期限（317.1.a / 468.7.c）；指令用契约 3.6 的 objects 选择器指回自己声明的 TargetSpec，golden 用链适配器真实执行。" +
    "(2) 剩余缺口：「When it wins a combat this turn」是延迟触发能力（CR 390/391.2/392，468.3.a 的胜负判定 + 317.2.c 的窗口）：" +
    "没有卡牌可用的 trigger.delayed opcode（RIFT-9，op 未注册），combat-result 时点也没有被 emit 进唯一事件管线（combat/flow.ts 的结果事务尚未实现），" +
    "\"it\" 所需的触发事件对象绑定（359.3.f.3）同样缺失；两个子句共享同一目标但触发时点/延迟窗口未落地。" +
    "effect.buff 是 702 的 Buff 计数器，不是临时 Might 修正，不用它冒充。「gain 2 XP」本身是已合入的 effect.xp。" +
    "依赖：RIFT-9 的 trigger.delayed 与 combat-result 时点接线（RIFT-124 后续）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "grim-resolve.grant-3-might",
          // RIFT-258：已合入的 continuous.might 原语固定 arithmetic 层（没有 layer 参数）；
          // this-turn → end-of-turn 期限（317.1.a / 468.7.c）。objects 用契约 3.6 的选择器
          // 指回本指令声明的 TargetSpec。
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "grim-resolve.friendly-unit" }
            }
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
