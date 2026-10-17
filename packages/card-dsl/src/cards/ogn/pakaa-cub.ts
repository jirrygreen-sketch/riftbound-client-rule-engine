import type { CardProgram } from "../../ir/index.js";

/**
 * Pakaa Cub (ogn-135-298) — Unit, 3 Energy, 3 Might, Body, Cat/Ixtal.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-135-298）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *
 * 规则依据（CR v1.5）：
 * - 811.1：Hidden 是执行 Hide 这一 Discretionary Action 的前提条件关键词；
 * - 811.1.a：可出现在咒语、单位与装备上；
 * - 811.1.b：功能上等价于「在你的回合 Open State，此牌在你手牌或冠军区时，你可以
 *   支付 [A] 把它面朝下藏在你控制、且尚无面朝下牌的战场；从下一回合起它获得
 *   [Reaction]，且你可以忽略其基础费用打出它」；
 * - 811.1.c.1–c.3：Hide 不是 Play 的子集、不开启链；从面朝下打出才开启链；
 * - 811.1.d.1–d.3：隐藏单位必须打到藏它的战场，隐藏咒语/永久物打出效果的目标受
 *   该战场限制。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static cost.hidden）
 * 由 effects/keywords/Hidden.ts 负责。
 *
 * status = judge-required：Hidden 的 cost.hidden 计划已有真实构造逻辑，但 Hide 动作
 * 没有调用方，面朝下区域也不在契约 ZoneId 中。
 */
const pakaaCub = {
  canonicalCardId:
    "card.hash-e6d9cb8b5b7516aaf9f0acb84629037ed610be0c027965d443bbe45210273059",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hidden 的展开文件（effects/keywords/Hidden.ts：static cost.hidden）与 cost/cost-plan.ts 的 " +
    "buildHiddenCostPlan 已合入并有执行证据，但没有 Hide Discretionary Action 的调用方；" +
    "811.1.c 的 Hide Discretionary Action" +
    "（支付 [A]、按己方战场面朝下放置、811.1.b 的下一回合起 [Reaction] + 忽略基础费打出）尚未接线；" +
    "契约 ZoneId（effects/contract.ts）也没有面朝下区域，811.1.d.1–d.3 的落点与目标限制无处表达。" +
    "缺少的是 Hide 动作与面朝下区域的接线；Hidden 关键词程序绑定已经合入，但 811.1.c 的 Hide " +
    "流程与 811.1.d.1–d.3 的来源战场限制仍没有可执行消费方。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "hidden" }],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)"
} satisfies CardProgram;

export default pakaaCub;
