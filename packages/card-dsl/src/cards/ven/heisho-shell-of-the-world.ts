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
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. 缺「忽略能力」的执行路径：ProgramStaticBinder.layerFor 对
 *    continuous.ignore-abilities 仍抛 "Static ability kind continuous.ignore-abilities
 *    has no layer mapping"（programs/statics.ts 实测）；layers/engine.ts 的 ability 层只
 *    消费 keyword/timing/movement/text，内核没有任何 "inactive for this procedure"
 *    的运行时状态（764-767），也没有「本次支付忽略 Deflect」传进目标税或费用计划的通道。
 * 2. 目标税的生产消费方仍未接线：target/tax/adapter.ts 的 TargetTaxCostAdapter 与
 *    collectTargetTaxes 已合入，但 chain/engine.ts 的 Finalize 只把 taxAdapter 传给
 *    finalizeTargetPlan、从不传 tax，且 Deflect 展开出的 target.tax 静态在
 *    programs/statics.ts 也被拒绝（"Static ability kind target.tax has no layer
 *    mapping"）；实测一张 1 Energy 法术选择 Deflect 2 单位只支付基础费用，没有任何
 *    目标税可被本卡抑制。
 * 3. "choosing something here" 需要把该次法术/能力 Finalize 后的选择计划与 053.3 的 here
 *    位置作对比；TargetPlan 只在链内部存在，没有暴露给卡牌程序的通道（契约 3.8 第 4 条）。
 * programs/statics.ts 的 staticFilter 已支持 sameLocationAs:self 锚点，位置锚点本身不是缺口。
 * 依赖：764-767 忽略语义的图层映射与 inactive-for-procedure 状态、目标税的生产接线
 * （Deflect 静态绑定 + Chain 传入 tax）、TargetPlan 暴露通道。不近似实现，不把忽略写成
 * target.tax 数值 0。
 */
export default {
  canonicalCardId: "card.hash-ff672b8dd077ccd490192a9b17852cd59002a5bbc12aa7153e4ad607915036ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现（2026-10-17 RIFT-613 复核实测）：(1) ProgramStaticBinder.layerFor 对 " +
    "continuous.ignore-abilities 抛 \"Static ability kind continuous.ignore-abilities has no layer " +
    "mapping\"（programs/statics.ts）；layers/engine.ts 的 ability 层只消费 keyword/timing/movement/text，" +
    "内核没有 764-767 的 \"inactive for this procedure\" 运行时状态，也没有把「本次支付忽略 Deflect」传进" +
    "目标税或费用计划的通道。(2) 目标税的生产消费方未接线：TargetTaxCostAdapter / collectTargetTaxes 已合入，" +
    "但 chain/engine.ts 的 Finalize 只传 taxAdapter、从不传 tax，Deflect 展开的 target.tax 静态在 " +
    "programs/statics.ts 也被拒绝（\"Static ability kind target.tax has no layer mapping\"）；实测 1 Energy " +
    "法术选择 Deflect 2 单位只付基础费用，不存在可被本卡忽略的 target.tax（809.1.c / 356.2.a.2）。(3) " +
    "\"choosing something here\" 需要把该次法术/能力 Finalize 后的选择计划与 053.3 的 here 位置比较，" +
    "TargetPlan 只在链内部存在、没有暴露给卡牌程序的通道（契约 3.8 第 4 条）；programs/statics.ts 的 " +
    "staticFilter 已支持 sameLocationAs:self 锚点，位置锚点本身不是缺口。依赖：764-767 忽略语义的图层映射与 " +
    "inactive-for-procedure 状态、目标税生产接线、TargetPlan 暴露通道。不把忽略近似成 target.tax 数值 0。",
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
