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
 * 状态：judge-required。两个缺口都在本卡内容上，且都未合入：
 * 1. 触发条件无法静态表达"被打出的法术的 Energy 费用 ≥ 5"。契约 3.6 的
 *    ObjectSelector 只有 self / source / target / pick / linked；触发事件的
 *    对象（被打出的法术）没有选择符，Condition/ObjectFilter 也没有对事件载荷
 *    的费用做数值比较（只有 eq/ne/lt/lte/gt/gte/in 的 compare，但左值取不到该
 *    对象）。因此本文件的 trigger.filter 只把"你打出的法术"写成描述性条件
 *    （energyGte: 5），由 judgeReason 标注该键尚无正式语义，不当作已实现。
 * 2. "+3 Might this turn" 需要 continuous.might 的消费方（RIFT-91）。
 */
export default {
  canonicalCardId: "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺触发条件表达：a spell that costs 5 energy or more 需要读取被打出法术的费用，" +
    "但契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，触发事件对象" +
    "（被打出的法术）没有选择符，Condition 也没有对事件载荷费用的数值比较；" +
    "trigger.filter 里的 energyGte 只是描述性占位，无正式语义。" +
    "另缺 continuous.might 消费方：+3 Might this turn 是带期限的算术图层修正（CR 143.2），" +
    "effect.buff 不承载临时 Might。" +
    "依赖：RIFT-91（layers-continuous）、RIFT-89/90（条件与目标批次的事件载荷读取）。" +
    "不近似实现。",
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
