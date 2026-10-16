import type { CardProgram } from "../../ir/index.js";

/**
 * Dancing Grenade (unl-020-219) — Spell, 2 energy + 1 Fury power, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-020-219，逐字）：
 *   Deal 2 to a unit. Its controller may play this spell again for :rb_rune_rainbow:.
 *   If they do, this deals 1 additional Bonus Damage for each time this spell has dealt
 *   damage this turn.
 *
 * 规则依据（CR v1.5）：
 * - “Deal 2 to a unit”：418.1 定义 Deal；355.9.a.1 的 “unit” 指 Board 上的单位 → 目标选择
 *   （355.10.d 的反例：本句是选择型引用），因此写成 TargetSpec。
 * - “Its controller may play this spell again for :rb_rune_rainbow:”：420.3 把“由游戏效果指示的
 *   Play”定义为受限动作；“its” 指前一指令选定的单位（355.10.c.1 的正文内指代）；
 *   :rb_rune_rainbow: 是任意域 Power（135.2.e.5.a / 163.2.b）。
 * - “If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage
 *   this turn”：Bonus Damage（418.4/418.5、712–715.2）由 effect.damage 的 bonus 形参承载
 *   （714 多个实例相加、714.1 只能为正）；数量是“本回合本卡已造成伤害的次数”。
 *
 * status = judge-required（缺口不近似实现）：
 * - 重新打出当前结算中的法术没有已合入路径：effect.play 只对某个区域里的对象提交 play
 *   动作（“already-resolved/finalized cost plan”），不能重放正在结算的链项；来源、嵌套重放顺序
 *   与次数归属都需要官方裁定——本地调研（docs/plans/survey/unclassified-unl.md 第 7 条）明确把本卡
 *   判为 judge-required：158.3 / 418.4 / 418.5 / 420.3 不足以安全落地。
 * - “本回合本卡造成伤害的次数”没有生产者：effect.damage 只链接单次动作的 dealt / dealtTo /
 *   dealtCount，condition.result 与按卡身份的历史计数未合入（ogn/disintegrate 记录同一缺口）。
 * - 重打费用 :rb_rune_rainbow: 在六域封闭 Domain 集合里没有取值（163.2.b），只以 ["rainbow"]
 *   作描述性记录（ven/matriarch-of-war、sfd/glasc-mixologist 同缺口）；“its controller” 作为
 *   重打的选择者也没有已合入选择符。
 * 因上述缺口，本卡只声明第一条真实正文指令 “Deal 2 to a unit”（effect.damage 已合入，golden 真实执行），
 * 重打与 Bonus Damage 的完整形状记录在 judgeReason，不写成可执行近似（不写固定次数的二次伤害）。
 */
const dancingGrenade = {
  canonicalCardId: "card.hash-4609651295618e769925ca1121b1e4b5f1589eaef0c44d494c4efea35f85899c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「Its controller may play this spell again for :rb_rune_rainbow:」" +
    "没有已合入路径——effect.play 只对区域中的对象提交 play 动作（并要求已 Finalize 的费用计划），" +
    "不能重放正在结算的链项；来源、嵌套重放顺序与次数归属需要官方裁定，本地调研 " +
    "（docs/plans/survey/unclassified-unl.md 第 7 条）据此把本卡判为 judge-required（158.3 / 418.4 / 418.5 / 420.3 " +
    "不足以安全落地），故不写固定次数的 repeat 或二次 damage；(2)「this deals 1 additional Bonus Damage for each time this spell " +
    "has dealt damage this turn」的 Bonus Damage 次数没有生产者——effect.damage 只链接单次动作的 dealt / dealtTo / dealtCount，" +
    "condition.result 与按卡身份的历史计数未合入" +
    "（ogn/disintegrate 同一缺口）；(3) 重打费用 :rb_rune_rainbow: 是任意域 Power（135.2.e.5.a / 163.2.b），" +
    "六域封闭 Domain 集合无法表达（仅以 [\"rainbow\"] 描述性记录），且 “its controller” 作为重打选择者没有已合入选择符。" +
    "「Deal 2 to a unit」（418.1 / 355.9.a.1）本身只用已合入的 effect.damage，golden 真实执行；不构成整卡证据。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "dancing-grenade.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "dancing-grenade.unit" }
          },
          targets: [
            {
              id: "dancing-grenade.unit",
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
    "Deal 2 to a unit. Its controller may play this spell again for :rb_rune_rainbow:. " +
    "If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn."
} satisfies CardProgram;

export default dancingGrenade;
