import type { CardProgram } from "../../ir/index.js";

/**
 * One-Two Punch（rad-121-167）— Spell，3 能量，无印刷力量，领域为空。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-121-167，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)
 *    [Buff] a friendly unit and [Stun] an enemy unit. (Give the friendly unit a +1 :rb_might: buff
 *    if it doesn't have one. The enemy unit doesn't deal combat damage this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「[Buff] a friendly unit」是 Buff 游戏动作（427.1 / 427.1.b / 427.3）：给一个由你控制的单位
 *   放置一个 Buff counter；已有 Buff 的单位仍可被选择但不新增（702.3 / 702.3.a），以 effect.buff
 *   的 mode "buff" 执行。「a friendly unit」是目标（355.7 / 355.9.a.1），单位由所属玩家在
 *   Finalize 选择（355.5）。
 * - 「[Stun] an enemy unit」是 Stun 游戏动作（424.1）：把 Board 上的单位渲染为 Stunned；
 *   424.1.a.1 已 Stunned 的单位不能再被 Stun，以 effect.stun 执行。敌方单位同样是目标。
 * - reminder 括号内是该动作结果的释义（702.3 的 +1 Might 由图层从 Buff 计数派生；424.1.b 的
 *   战斗伤害后果是 Stunned 状态的规则结果），不是独立指令，因此不另写指令。
 * - 两个子句由 "and" 连接，是同一效果的并列指令，各自独立结算（055 / 359.3.e.11 能做什么做什么），
 *   因此两条指令不写 linkedTo：某一条被否定/无操作不影响另一条。
 *
 * status = executable：两条正文指令都使用已合入原语（effect.buff / effect.stun），目标声明、
 * 解释器链接与参考内核路径均可真实执行，golden 用解释器执行程序原始 body 并覆盖已 Buff 的
 * 无操作（427.1.c / 702.3.a）与目标失效（359.3.e.6/e.7）两种边界。
 * [Action] 的时机许可消费方（continuous.timing / chain canAct 接线）与 Stunned 的期效
 * （424.1.a.2 回合结束清理 3d、424.1.b 战斗伤害后果）是 chain / turn / combat 的引擎义务，
 * 已在 golden 里写成 test.todo，不计入本卡的可执行性证据。
 */
const oneTwoPunch = {
  canonicalCardId: "card.hash-15c799fb843cf43317c0acc853801b4a8356da97f5897cf1a654cc4ac6954dd6",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          id: "one-two-punch.buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "one-two-punch.friendly-unit" }
          },
          targets: [
            {
              id: "one-two-punch.friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "one-two-punch.stun-enemy-unit",
          op: "effect.stun",
          args: {
            target: { kind: "constant", value: "one-two-punch.enemy-unit" }
          },
          targets: [
            {
              id: "one-two-punch.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Buff] a friendly unit and [Stun] an enemy unit. (Give the friendly unit a +1 :rb_might: buff " +
    "if it doesn't have one. The enemy unit doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default oneTwoPunch;
