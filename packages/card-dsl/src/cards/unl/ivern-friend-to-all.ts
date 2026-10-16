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
 * status 判定（README 第 2 节）：judge-required —— 三处依赖未合入，均不近似实现：
 * 1. 打出时的四选一（355.1）没有已合入的抉择计划：chain/engine.ts 的
 *    assertFinalizationSurface 显式阻断 choice.mode（"Mode choices require a
 *    Finalize/Resolve choice-plan adapter"），因此四选项没有可执行路径（RIFT-89/90）。
 * 2. "I gain that tag" 没有卡牌可用的指令入口：layers 的 trait 层能消费 add-tag/grant-tag
 *    （layers/engine.ts 的 applyTrait），但没有已注册的 continuous.add-tag / grant-tag 原语，
 *    也没有把 CardProgram 的持续效果注册成 ContinuousEffectSpec 的适配路径（RIFT-91 卡牌接线）。
 * 3. 并集计数没有可求值谓词：ObjectFilter 的 tags 是"同一对象上全部命中"（layers/filter.ts 与
 *    参考内核的 matchesFilter 都是 every 语义；事件侧 ObjectFilter 的 tags 同样是 every），
 *    无法表达 "Bird、Cat、Dog、Poro 各自被你的至少一个单位拥有" 的跨对象并集；程序用保留形状
 *    （subject 记录并集语义）书写，未用"一个单位同时有四个标签"或"有 4 个单位"近似。
 * 触发结构（conquer/hold 两条）、目标与条件形状、effect.score 本体已按已合入契约写出，
 * golden 用解释器与参考内核真实执行 effect.score 部分。
 *
 * 依赖：RIFT-89/90（Finalize 抉择计划与目标/条件管线）、RIFT-91（layers 的卡牌接线与
 * trait 授予）、跨对象标签并集谓词（契约变更请求）。
 */

/**
 * "your units have all of the following tags among them — Bird, Cat, Dog, and Poro" 的
 * 保留形状：语义是"你控制的单位中，这 4 个标签各自的并集命中数 ≥ 4"（跨对象并集）。
 * 已合入的 filters 只能表达同一对象上的 tags every 匹配，因此 subject 名记录真实语义、
 * filter 只标注能力控制者（同 wily-newtfish 的 controller-xp 占位写法），不把并集近似成
 * 单对象四标签或单位数量。
 */
const UNITS_HOLD_ALL_FOUR_TAGS: Condition = {
  kind: "compare",
  left: {
    kind: "count",
    subject: "controller-units-distinct-listed-tags-union",
    filter: { player: "controller" }
  },
  operator: "gte",
  right: { kind: "constant", value: 4 }
};

const scoreIfAllFourTags = (id: string): Ability => ({
  kind: "triggered",
  trigger: {
    at: id === "ivern-friend-to-all.conquer" ? "conquer" : "hold",
    filter: {
      event: id === "ivern-friend-to-all.conquer" ? "conquer" : "hold",
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
      // 在本指令结算时检查；并集谓词的缺口见文件头第 3 点。
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
                    // 该 op 未注册（见 judgeReason），保留有依据的形状。
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
    "三处依赖未合入：(1)「As you play me, choose Bird, Cat, Dog, or Poro」是打出步骤（355.1）的四选一，" +
    "但 chain/engine.ts 的 assertFinalizationSurface 显式阻断 choice.mode（\"Mode choices require a " +
    "Finalize/Resolve choice-plan adapter\"），没有已合入的打出期抉择计划（RIFT-89/90）。" +
    "(2)「I gain that tag」没有卡牌可用的指令入口：layers 的 trait 层（layers/engine.ts 的 applyTrait）" +
    "能消费 add-tag/grant-tag，但没有已注册的 continuous.add-tag 原语，也没有把 CardProgram 的持续效果" +
    "注册成 ContinuousEffectSpec 的适配路径（RIFT-91 卡牌接线）。" +
    "(3)「your units have all of the following tags among them — Bird, Cat, Dog, and Poro」是跨对象并集，" +
    "而 ObjectFilter 的 tags 是同一对象上的 every 匹配（layers/filter.ts、参考内核与事件侧过滤都是 every），" +
    "无法表达「每个标签分别被你的某个单位拥有」；程序保留 count/subject 的并集形状，不近似成" +
    "「一个单位同时有四个标签」或「你有 4 个单位」。" +
    "已可真实执行的部分：conquer/hold 两条触发结构、效果内条件的作用域（383.2.a.1）与 effect.score 本体" +
    "（470.1/470.2/194.1.c），golden 用解释器与参考内核执行 effect.score。" +
    "依赖：RIFT-89/90（打出期抉择与条件/目标管线）、RIFT-91（layers 卡牌接线与 trait 授予）、" +
    "跨对象标签并集谓词（契约变更请求）。不近似实现。",
  abilities,
  sourceText:
    "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.\n" +
    "When I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro."
} satisfies CardProgram;
