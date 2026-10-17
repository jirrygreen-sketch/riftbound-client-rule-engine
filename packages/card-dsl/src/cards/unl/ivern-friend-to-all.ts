import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Ivern, Friend to All (unl-177-219) — Unit，6 能量、无印刷 Power、Might 6，
 * 标签 Ivern / Ionia / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-177-219，逐字）：
 *   As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.
 *   When I conquer or hold, score 1 point if your units have all of the
 *   following tags among them — Bird, Cat, Dog, and Poro.
 *
 * 规则依据（CR v1.5）：
 * - 355.1 / 355.1.a："As you play me" 的抉择在打出的步骤中做出（Finalize 期），不是结算期的
 *   自由选择；"choose Bird, Cat, Dog, or Poro" 是四个互斥选项（347 / 505.2.a 的四选一）。
 * - 133.8 / 133.8.a："Bird/Cat/Dog/Poro" 是标签（tag），标签本身没有内在规则含义，只在被
 *   文本引用时生效；"I gain that tag" 是把标签授予宿主自己的持续特征修改（契约 3.4 的 trait 层：
 *   layers/engine.ts 的 applyTrait 已能把 add-tag / grant-tag 写进对象的 tags）。
 * - 383.4.c / 383.4.c.1："When I conquer" 是 Conquer Effect，封闭时点 conquer；
 *   383.4.d / 383.4.d.1："or hold" 是 Hold Effect，封闭时点 hold——原文把两者并列为同一个
 *   效果，因此按 Hunt 的展开方式写成两条 triggered ability（同 effect.xp/effect.score）。
 * - 383.2.a / 383.2.a.1：
 *   "if your units have all of the following tags among them" 并不紧跟在触发条件之后
 *   （中间是 "score 1 point"），因此按 383.2.a.1 属于**效果**的一部分，在指令结算时检查
 *   （135.2.b.3 / 359.3.f.2），作用域是它所修饰的那条 effect.score 指令；"your units"
 *   的范围是能力控制者（190.6.d 的隐含 you；740.1.a 的 "your"）。
 * - "among them" 的语义是**跨单位并集**：你的单位里有单位带 Bird、有单位带 Cat、
 *   有单位带 Dog、有单位带 Poro 即满足，不要求同一个单位同时拥有四个标签。
 * - 470.1 / 470.2 / 194.1.c："score 1 point" 是通过效果的得分（Gaining a Point），
 *   已合入的 effect.score 正是该动作。
 *
 * status = judge-required：缺打出期 choice.mode、continuous.add-tag 指令和
 * Score 波的参与单位匹配。标签并集可由四个独立 count>0 条件合取表达，
 * golden 经真实 ChainEngine 执行原始得分 body，覆盖并集命中和缺失边界。
 */

/** Each listed tag must occur on at least one friendly Board unit (133.8). */
const UNITS_HOLD_ALL_FOUR_TAGS: Condition = {
  kind: "all",
  conditions: ["Bird", "Cat", "Dog", "Poro"].map(tag => ({
    kind: "compare",
    left: {
      kind: "count",
      subject: "units",
      filter: { type: "unit", zone: "board", controller: "self", tags: [tag] }
    },
    operator: "gt",
    right: { kind: "constant", value: 0 }
  }))
};

const scoreIfAllFourTags = (id: string): Ability => ({
  kind: "triggered",
  trigger: {
    at: id === "ivern-friend-to-all.conquer" ? "conquer" : "hold",
    filter: {
      event: id === "ivern-friend-to-all.conquer" ? "conquered" : "held",
      filter: { source: "self" }
    }
  },
  optional: false,
  body: [
    {
      id,
      op: "effect.score",
      args: { amount: { kind: "constant", value: 1 } },
      // 383.2.a.1："if your units have all … among them" 跟在效果之后，属效果的一部分，
      // 在本指令结算时检查；四个标签分别检查，不要求单一单位拥有全部标签。
      condition: UNITS_HOLD_ALL_FOUR_TAGS
    }
  ]
});

const abilities: Ability[] = [
  {
    // "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag."（355.1 的打出期抉择）
    // 四种模式各自把"授予该标签"包进自己的 body（契约 3.9 的 choice.mode 形状：modes[{id,body}]
    // + count 1 + different），不用 choice + linkedTo。
    kind: "play",
    body: [
      {
        id: "ivern-friend-to-all.choose-tag",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "ivern-friend-to-all.bird",
                body: [
                  {
                    id: "ivern-friend-to-all.gain-bird",
                    // 133.8 + 契约 3.4 的 trait 层："I gain that tag" 是给宿主自己加标签。
                    // 该 op 保留印刷语义，待 CardProgram→trait 层的结算接线消费。
                    op: "continuous.add-tag",
                    args: {
                      tag: { kind: "constant", value: "Bird" },
                      layer: { kind: "constant", value: "trait" },
                      object: { kind: "constant", value: "self" }
                    }
                  }
                ]
              },
              {
                id: "ivern-friend-to-all.cat",
                body: [
                  {
                    id: "ivern-friend-to-all.gain-cat",
                    op: "continuous.add-tag",
                    args: {
                      tag: { kind: "constant", value: "Cat" },
                      layer: { kind: "constant", value: "trait" },
                      object: { kind: "constant", value: "self" }
                    }
                  }
                ]
              },
              {
                id: "ivern-friend-to-all.dog",
                body: [
                  {
                    id: "ivern-friend-to-all.gain-dog",
                    op: "continuous.add-tag",
                    args: {
                      tag: { kind: "constant", value: "Dog" },
                      layer: { kind: "constant", value: "trait" },
                      object: { kind: "constant", value: "self" }
                    }
                  }
                ]
              },
              {
                id: "ivern-friend-to-all.poro",
                body: [
                  {
                    id: "ivern-friend-to-all.gain-poro",
                    op: "continuous.add-tag",
                    args: {
                      tag: { kind: "constant", value: "Poro" },
                      layer: { kind: "constant", value: "trait" },
                      object: { kind: "constant", value: "self" }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  },
  scoreIfAllFourTags("ivern-friend-to-all.conquer"),
  scoreIfAllFourTags("ivern-friend-to-all.hold")
];

export default {
  canonicalCardId:
    "card.hash-4f9132b39e7882b566918d9e149431cd5ca28810eebc329edb678b0585a346a8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处：(1) As you play 的 choice.mode 在 programs/play.ts 与 chain/engine.ts 被 Finalize/Resolve choice-plan guard 阻断（CR 355.1）。" +
    "(2) continuous.add-tag 没有 CardProgram 指令注册与 trait 层写入接线（133.8）；trait 层本身已有 add-tag/grant-tag。" +
    "(3) conquer/hold 的 Score 波只有 player/details.battlefieldId，缺参与征服/固守单位的对象匹配（383.4.c/383.4.d）。",
  abilities,
  sourceText:
    "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.\n" +
    "When I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro."
} satisfies CardProgram;
