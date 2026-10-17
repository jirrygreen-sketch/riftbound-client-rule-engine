import type { CardProgram } from "../../ir/index.js";

/**
 * Brush (unl-t03) — Battlefield token, Colorless, tag Token.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-t03, 逐字)：
 *   Bird, Cat, Dog, Poro, and Ivern units here have +1 :rb_might:.
 *   When you score here, you may replace this with the battlefield it replaced.
 *
 * 规则依据（CR v1.5）：
 * - 187.8：Brush battlefield token 是无域战场 token，带“Bird, Cat, Dog, Poro, and
 *   Ivern units here have +1 [M]”与“When you score here, you may replace this with
 *   the battlefield it replaced.”。
 * - 133.8：Bird / Cat / Dog / Poro / Ivern 是 133.8 的标签；该句是“这些标签之中
 *   任一”的单位集合（标签之间是 or），不是要求同时具备全部标签。
 * - 479.4 / 479.4.e.1：“have +1 :rb_might:” 是特征值的算术图层增加（与 packed
 *   amphitheater 同型）；053.3 的 “here” 指本源战场。
 * - 383.4 / 473.2：“When you score here” 是 Score 触发（470.1/470.3/471/473.2 的
 *   score 时点），190.6.d 的 “you” 是战场控制者。
 * - 439.3 / 439.5 / 439.7 / 439.7.b / 439.7.c：“replace this with the battlefield it
 *   replaced” 是 Replace 动作的 Swap Back 扩展：被替代的卡在 Banishment，swap back 时
 *   该卡回到 token 占用的位置并继承当前效果与状态；Banishment 里没有可换回的卡时
 *   永不 swap back。
 *
 * status = judge-required（逐个记录缺口，不近似实现）[RIFT-329 复核]：
 * 1. “Bird, Cat, Dog, Poro, and Ivern units here” 的标签集合是 or 语义：已合入的
 *    ObjectFilter/matcher（layers/filter.ts 的 tags、解释器与内核的 tags）按“每个标签
 *    都命中”求值，写 tags: [...5 个标签] 会变成“同时具备全部 5 个标签”，删掉其中
 *    任何一个都会把另一张卡（或更窄的集合）实现成事实。
 * 2. +1 Might 属算术图层（479.4 / 479.4.e.1），CardProgram static 能力的生产绑定与
 *    053.3 的 here 锚点（sameLocationAs）已经由 programs/statics.ts 接通；但本卡的
 *    tagsAnyOf 仍不是静态过滤器词汇，因此该绑定会 fail closed，不能把五个标签的 or
 *    语义误写成 tags 的 and 语义。
 * 3. score/conquer/hold 时点已由 turn/flow.ts 的计分波原子发出，程序触发能力也能注册为
 *    TriggerRegistration；但卡面 filter 里的
 *    here: true 仍不在封闭 EventPattern 词汇内（programs/filters.ts 的 translateTriggerFilter
 *    对 here 抛 judge-required）；“you” 已可归一为来源控制者，但 here 的来源战场锚点仍未实现，
 *    触发无法正确挂到本来源（053.3）。
 * 4. “replace this with the battlefield it replaced” 的动作不存在于封闭 GameAction 集合：
 *    439.5 要求被替代对象进入 Banishment、439.7.b 要求换回的原卡回到 token 的位置并继承
 *    状态（token 则停止存在），已合入的 create-token / move-zone / effect.token 都无法表达
 *    （战场 token 定义表也没有 brush）；且 “the battlefield it replaced” 是 Replace 时记录在
 *    token 上的被替代卡引用，契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，
 *    没有读取该记录的形态。
 * 依赖：tagsAnyOf 的静态过滤器语义、here 锚点、Replace/Swap-Back 原语；不近似实现。
 */
export default {
  canonicalCardId: "card.hash-8624ca0fcb3cd60db66cadac14c3f88e0dc422d1061843d35d39845b60616015",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1)「Bird, Cat, Dog, Poro, and Ivern units here have +1 [M]」的标签集合是 or 语义（133.8），" +
    "而已合入的 ObjectFilter 与匹配器只按「每个 tags 条目都命中」求值（layers/filter.ts、解释器 selectors、参考内核 matchesFilter），" +
    "写 tags: [五个标签] 会要求单位同时具备全部五个标签；程序用 tagsAnyOf 记录集合语义（描述性 fail-closed 键，不当作可执行谓词）。" +
    "(2) +1 Might 属算术图层（479.4/479.4.e.1），CardProgram static 能力的生产绑定与 053.3 的 here 锚点（sameLocationAs）已经由 programs/statics.ts 接通；" +
    "但 tagsAnyOf 仍不是静态过滤器词汇，绑定会 fail closed，不能把五个标签的 or 语义误写成 tags 的 and 语义。" +
    "(3) score/conquer/hold 时点已由 turn/flow.ts 的计分波原子发出（470.1/470.3/471/473.2、383.4），程序触发能力也能注册为 TriggerRegistration；" +
    "但 filter 里的 here: true 不在封闭 EventPattern 词汇内（programs/filters.ts 对 here 抛 judge-required）；“you” 已归一为来源控制者，here 的来源战场锚点仍未实现，触发无法挂到本来源。" +
    "(4) 「you may replace this with the battlefield it replaced」(439.3/439.5/439.7/439.7.b/439.7.c) 的动作不在封闭 GameAction 集合：" +
    "被替代对象要进 Banishment、换回的原卡要回到 token 的位置并继承状态、token 停止存在，已合入的 create-token/move-zone/effect.token 都表达不了（战场 token 定义表也没有 brush）；" +
    "“the battlefield it replaced” 是 Replace 时记录在 token 上的被替代卡引用，契约 3.6 的 ObjectSelector 没有读取该记录的形态。" +
    "依赖：tagsAnyOf 的静态过滤器语义、here 锚点、Replace/Swap-Back 原语。",
  sourceText:
    "Bird, Cat, Dog, Poro, and Ivern units here have +1 :rb_might:.\n" +
    "When you score here, you may replace this with the battlefield it replaced.",
  abilities: [
    {
      kind: "static",
      effect: {
        // 479.4 / 479.4.e.1：+1 Might 是算术图层的增加（与 rad/packed-amphitheater 同型）。
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          zone: "board",
          // 053.3：“here” 是本战场。
          sameLocationAs: "self",
          // 133.8 的标签集合（or）；合并过滤器的 tags 是 and，故用描述性键记录语义
          // （见 judgeReason 第 1 点）。
          tagsAnyOf: ["Bird", "Cat", "Dog", "Poro", "Ivern"]
        }
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "score",
        // 473.2：Score 能力在本战场计分时触发；“you” 是战场控制者（190.6.d）。
        filter: { event: "score", here: true, player: "controller" }
      },
      // “you may” 在效果首部（383.3.a），契约 3.9 用 choice.optional 把被选指令包进 body。
      optional: true,
      body: [
        {
          id: "brush.swap-back-opt",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Replace this with the battlefield it replaced?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "brush.swap-back",
                  // 439.3 的 “Replace [X] with [Y]” / 439.7 的 Swap Back：动作本身不在
                  // 封闭 GameAction 集合，也没有可读的“被替代卡”引用（见 judgeReason 第 4 点）。
                  op: "effect.replace",
                  args: {
                    mode: { kind: "constant", value: "swap-back" },
                    // “this” 是本战场 token（能力宿主）；对象位置用契约 3.6 的符号选择器
                    // 记法 "self"，不在静态 IR 里写运行时 ObjectRef。
                    object: { kind: "constant", value: "self" },
                    // “the battlefield it replaced”：439.7.b.1 的资格来自 Replace 时记录的
                    // 被替代卡（现位于 Banishment），契约 3.6 没有读取该记录的形态。
                    with: { kind: "constant", value: "the-battlefield-this-replaced" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
