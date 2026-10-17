import type { CardProgram } from "../../ir/index.js";

/**
 * Heisho, Shell of the World (ven-158-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-158-166，逐字）：
 *   "Players ignore [Deflect] while paying for spells and abilities choosing
 *    something here."
 *
 * 规则依据（Core Rules v1.5）：
 * - 764 / 765 / 766："Ignoring Effects"——某些游戏效果指示玩家在执行某个游戏动作或流程时
 *   忽略能力；被忽略的能力在该动作/流程范围内视为 inactive。766 的两个例子正是
 *   "Ignore Deflect while paying this spell's costs" 与 "You ignore Backline while
 *   assigning combat damage here."，与本卡同型。
 * - 767 / 767 的两个例子：被忽略的能力只对「该具体动作/流程」且只对「被指示的玩家」失效；
 *   本卡说的是 "Players"（任何玩家），所以忽略不是仅限控制者自己。
 * - 809.1 / 809.1.c / 809.1.c.1：Deflect 让对手用法术或能力选择宿主时追加 Power 费用；
 *   356.2.a.2 把该费用定为强制附加费。因此「支付选择此处的法术/能力的费用时忽略 Deflect」
 *   等价于在这一次费用确定中把相关对象的 Deflect 视为 inactive（764-767）。
 * - 355.7 / 355.9："spells and abilities choosing something here" 的"选择"是目标/选择
 *   计划（TargetPlan）在 Finalize 锁定的选择；053.3："here" 指本战场；190.6.a/190.6.d：
 *   战场能力的控制者是战场控制者，而本卡把忽略的受益者写成 "Players"（190.6.a 的
 *   "unless that ability indicates another player does"）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：旧 judgeReason 的「layers/filter.ts 未实现
 * sameLocationAs」已不成立：programs/statics.ts 的 staticFilter 已实现 sameLocationAs:self
 * 锚点（绑定到来源位置）。真实缺口：
 * 1. 缺「忽略能力」的已合入语义与消费方：engine-core 只实现了 GameAction 的替代效果
 *    （契约 3.4 的 replaced/prevented）与图层（copy/trait/ability/arithmetic）：
 *    ProgramStaticBinder.layerFor 对 continuous.ignore-abilities 抛
 *    「has no layer mapping」（实测），也没有任何 "inactive for this procedure"
 *    的运行时状态（764-767），layers/engine.ts 的
 *    ability 层只消费 keyword/timing/movement/text；也没有把"本次支付忽略 Deflect"
 *    传给目标税或费用计划的通道。
 * 2. 目标税消费方已合入：TargetPlan 经 TargetFinalizeOptions.tax /
 *    TargetTaxAdapter 追加 Deflect 税（target/target-plan.ts，golden 已断言），契约 3.8 第 4 条把
 *    "成为目标/目标锁定通知"与目标税的来源归引擎批 4；没有任何已合入代码读取卡牌程序
 *    声明的忽略效果来抑制某次选择的 target.tax。
 * 3. "choosing something here" 需要把该次法术/能力的选择计划与 053.3 的 here 位置作对比，
 *    当前没有把 TargetPlan 暴露给卡牌程序的通道。
 * 依赖：764-767 忽略语义的图层映射与 "inactive for this procedure" 状态、TargetPlan
 * 暴露给卡牌程序的通道（契约 3.8 第 4 条）。不近似实现，不把忽略写成 target.tax 数值 0。
 */
export default {
  canonicalCardId: "card.hash-ff672b8dd077ccd490192a9b17852cd59002a5bbc12aa7153e4ad607915036ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 缺 764-767「忽略能力」的已合入语义：内核只实现 GameAction 的替代效果与" +
    "copy/trait/ability/arithmetic 图层，ProgramStaticBinder.layerFor 对 continuous.ignore-abilities 抛" +
    "「has no layer mapping」（实测），没有「inactive for this procedure」的运行时状态，" +
    "layers/engine.ts 的 ability 层也不消费「忽略」类效果，因此本卡的效果没有执行路径；" +
    "(2) 目标税消费方已合入：TargetPlan 经 TargetFinalizeOptions.tax / TargetTaxAdapter 追加 " +
    "Deflect 税（809.1.c、356.2.a.2，golden 已断言），契约 3.8 第 4 条把目标税来源与目标锁定通知归引擎批 4，" +
    "没有任何已合入代码读取卡牌程序的忽略声明来抑制某次选择的 target.tax；" +
    "(3)「choosing something here」需要把被施放法术/能力的最终选择计划与 053.3 的 here 位置比较，" +
    "TargetPlan 未暴露给卡牌程序（programs/statics.ts 的 staticFilter 已支持 sameLocationAs:self 锚点，" +
    "锚点本身不再是缺口）。依赖：764-767 忽略语义的图层映射与 inactive-for-procedure 状态、" +
    "TargetPlan 暴露通道。不把忽略近似成 target.tax 数值 0。",
  abilities: [
    {
      kind: "static",
      // 764-767：被忽略的能力只在「支付选择此处的法术/能力费用」这一流程内 inactive。
      // 该结构是描述性的数据形状；内核没有对应原语或图层消费方（见 judgeReason）。
      effect: {
        kind: "continuous.ignore-abilities",
        // 809.1 / 809.1.c / 809.1.c.1：被忽略的关键词是 Deflect（含其数值实例）。
        abilities: ["Deflect"],
        // 766：仅在该游戏流程内失效。
        during: "paying-costs",
        // 767 的第二个例子：效果只对「被指示的玩家」生效；本卡写的是 Players（任何玩家）。
        for: {
          player: "any",
          spellOrAbility: "chooses-something-here",
          location: { sameLocationAs: "self" }
        }
      }
    }
  ],
  sourceText:
    "Players ignore [Deflect] while paying for spells and abilities choosing something here."
} satisfies CardProgram;
