import type { CardProgram } from "../../ir/index.js";

/**
 * Lux, Illuminated (ogs-006-024) — Unit, 6 energy / 1 power (Mind), Might 5.
 *
 * sourceText (deck-catalog.json, ogs-006-024, verbatim):
 *   "When you play a spell that costs :rb_energy_5: or more, give me +3
 *   :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me ..." 类的 Play Effect（383.4.a / 383.4.a.1）在打出完成后
 *   进链（420.4.a）；本卡是"当你打出法术时"，触发时点为 card-played，事件对象
 *   是打出的法术（不是本卡自身）。
 * - "a spell that costs :rb_energy_5: or more"：需要读取被打出法术的费用并与 5
 *   比较（355.9/356 的费用与合法性区分）。
 * - "give me +3 :rb_might: this turn"：带本回合期限的 Might 修正，属算术图层
 *   （continuous.might）而非 Buff（effect.buff 文件头明确临时 Might 归
 *   continuous.might）。
 *
 * 状态：judge-required。两个能力半边分开判定：
 * 1. "+3 Might this turn" 由已合入的 continuous.might（RIFT-258）承载：带期限的
 *    算术图层修正（CR 143.2），golden 用本程序的 body 经解释器真实执行。
 * 2. 触发条件 "a spell that costs :rb_energy_5: or more" 仍无法表达：card-played
 *    事件（chain/engine.ts）只携带被打出卡牌的 object 快照与 player，没有费用
 *    载荷；EventPattern 的 details 只做标量等值比较，ObjectFilter.characteristics
 *    也只做等值匹配，冻结词汇没有对事件对象特征的数值 ≥ 比较。trigger.filter 里的
 *    energyGte 是描述性占位、无正式语义。生产触发注册依赖 RIFT-257。
 */
export default {
  canonicalCardId: "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件仍缺表达：\"a spell that costs :rb_energy_5: or more\" 需要读取被打出法术的费用并与 5 " +
    "比较（CR 355.9/356 的费用与合法性区分），但 card-played 事件只携带被打出卡牌的 object 快照与 player，" +
    "没有费用载荷；EventPattern.details 只做标量等值比较，ObjectFilter.characteristics 也只做等值匹配，" +
    "冻结词汇没有对事件对象特征的数值 ≥ 比较。trigger.filter 里的 energyGte 是描述性占位、无正式语义。" +
    "已合入的 continuous.might（RIFT-258）承载 \"+3 Might this turn\"：golden 用程序自身的 body 真实执行" +
    "（arithmetic 层注册、end-of-turn 到期）。生产触发注册依赖 RIFT-257；事件载荷的费用比较属契约变更请求。" +
    "不近似实现（不用无条件 +3 Might 或别的时点代替）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { type: "spell", controller: "controller", energyGte: 5 }
      },
      optional: false,
      body: [
        {
          id: "lux-illuminated.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a spell that costs :rb_energy_5: or more, give me +3 :rb_might: this turn."
} satisfies CardProgram;
