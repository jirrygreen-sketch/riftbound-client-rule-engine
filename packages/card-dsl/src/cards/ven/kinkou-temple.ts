import type { CardProgram } from "../../ir/index.js";

/**
 * Kinkou Temple (ven-159-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-159-166，逐字）：
 *   "Units here with [Tank] have +1 :rb_might:."
 *
 * 规则依据（Core Rules v1.5）：
 * - 479.2.b / 479.3 / 479.3.b："have" 是 Ability-Altering 层的识别短语（"have," "has,"
 *   属于该层），本条把 +1 Might 授予本战场上有 [Tank] 的单位。
 * - 479.4 / 479.4.e.1 / 479.4.f："+X" 是 Arithmetic 层的增量，正增量先于减量应用；
 *   "+1 :rb_might:" 因此是 arithmetic 层的 +1，而不是 Buff 计数器（702 的 Buff 是
 *   计数器，本卡不放置任何计数器）。
 * - 815 / 815.1 / 815.1.b / 815.3：[Tank] 是单位上的被动关键词，815.1.b 的功能文本是
 *   战斗伤害指派顺序要求，815.3 让「是否拥有 Tank」成为可被其它效果检查的特征；
 *   本卡正是引用该特征的过滤器条件。
 * - 053.3："here" 指本战场；479.1 / 478.1：该效果在战场被控制期间持续生效；
 *   190.6.a / 190.6.d：战场能力的控制者为战场控制者。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 没有已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的
 *    ContinuousEffectSpec：registerContinuousEffect 没有调用方，engine-core 源码从不
 *    读取卡牌程序的静态能力（同 rad/packed-amphitheater、ogn/trifarian-war-camp）。
 * 2. 已合入的图层过滤器没有关键词谓词：layers/filter.ts 的 matchesObjectFilter 实现了
 *    objectId/cardId/type/zone/location/controller/owner/state/tags/characteristics，
 *    不比较 ObjectSnapshot.keywords；本卡的门槛「有 [Tank]」无法求值（同
 *    ogn/guerilla-warfare-teemo 记录的关键词谓词缺口）。
 * 3. 053.3 的 "here" 锚点未实现：layers/filter.ts 没有 sameLocationAs，声明中的 filter
 *    会把 +1 加到所有战场上有 [Tank] 的单位（过度应用）。
 * 已支持部分由 golden 用真实 LayerEngine 执行：把声明的 continuous.might 注册进图层后，
 * arithmetic 层真实把 Might 从 2 加到 3（479.4.e.1）；门槛与位置锚点的缺口见上。
 * 依赖：RIFT-91 后续的卡牌 static 注册、关键词谓词与 sameLocationAs/here 过滤器锚点；
 * RIFT-264 已合入 Tank KeywordDef，但它是宿主自身的展开，不是本卡的门槛谓词。
 */
export default {
  canonicalCardId: "card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 " +
    "ContinuousEffectSpec：registerContinuousEffect 没有调用方，engine-core 源码从不读取卡牌程序能力" +
    "（同 rad/packed-amphitheater、ogn/trifarian-war-camp）。(2)「with [Tank]」的门槛无法求值：" +
    "layers/filter.ts 的 matchesObjectFilter 比较 objectId/cardId/type/zone/location/controller/owner/state/tags/characteristics，" +
    "但不比较 ObjectSnapshot.keywords，关键词谓词缺口同 ogn/guerilla-warfare-teemo。(3) 053.3 的 here 锚点未实现：" +
    "layers/filter.ts 无 sameLocationAs，声明的 filter 会把 +1 Might 加到所有战场上的 [Tank] 单位（过度应用）。" +
    "层算术本身已合入（479.4 arithmetic 层、479.4.e.1 正增量先算），golden 用真实 LayerEngine 执行 Might 2→3。" +
    "依赖：RIFT-91 后续的卡牌 static 注册、关键词谓词与 sameLocationAs 过滤器锚点（RIFT-264 已合入的 Tank KeywordDef 是宿主自身展开，不是本卡门槛）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 479.4 / 479.4.e.1 / 479.4.f：+1 Might 是 arithmetic 层的正增量。
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // 479.3.b 的 "have" + 815.3 的 Tank 特征谓词 + 053.3 的 here：
        // 「本战场上有 [Tank] 的单位」；keywords 谓词与 sameLocationAs 锚点均未实现
        // （见 judgeReason 缺口 2、3）。
        filter: {
          type: "unit",
          zone: "board",
          keywords: ["Tank"],
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Units here with [Tank] have +1 :rb_might:."
} satisfies CardProgram;
