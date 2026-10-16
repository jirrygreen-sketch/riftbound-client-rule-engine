import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Poppy, Defender of the Meek (unl-178-219) — Unit，6 能量 + 1 Order Power、Might 5，
 * 标签 Yordle / Demacia / Poppy / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-178-219，逐字）：
 *   You may spend 3 XP as an additional cost to play me. If you do, I cost
 *   :rb_energy_3: less.
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * 规则依据（CR v1.5）：
 * - 356.2 / 356.2.b / 356.2.b.1："as an additional cost" + "may" 是可选附加费用，在打出
 *   步骤（355.1.a / 356.2）由控制者决定是否支付；356.4.f.1：可选附加费用"已支付"看的是玩家
 *   是否做出支付决定（与实际支付金额无关），因此 "If you do" 的凭证是费用计划的
 *   selectedAdditional，而不是 XP 数值变化。
 * - 730.1 / 730.2：XP 的获得与花费；"spend 3 XP" 是 3 点 XP 的标量费用，已合入的
 *   cost/plan-values.ts readCost 支持 { kind: "xp", amount } 并把它计入 CostPlan.total.xp
 *   （cost/payment.ts 的 spend-xp 支付动作），是最接近的可执行形状。
 * - 356.4 / 356.4.b："I cost [3] less" 是 Finalize 总费用阶段（"3. Determine Total Cost"）的
 *   折扣，减费量为 3 energy；356.4.e：折扣自带的 minimum 只约束该折扣本身（本卡未印 minimum，
 *   因此不写 minimum 字段，也不用 0 下限改写印刷费用）。
 * - 822.1 / 822.1.b / 822.1.c / 822.2：Ambush 是被动能力关键词（可打到你有单位的战场 +
 *   此时具有 Reaction），只声明不重写（契约 3.7）。
 * - 815.1 / 815.1.b / 815.1.c / 815.2：Tank 是被动能力关键词，功能上等于"战斗伤害必须优先
 *   分配给我"；只声明不重写（契约 3.7）。括注 "(I must be assigned combat damage first.)"
 *   是 815.1.b 的提醒文本，不另写指令。
 *
 * status 判定（README 第 2 节）：judge-required —— 三处依赖未合入，均不近似实现：
 * 1. 可选附加费用没有生产接线：cost/ 的费用计划只在调用方显式传入 optionalAdditional 时
 *    生效（cost/cost-plan.ts 读 CostPlanInput.optionalAdditional），没有任何模块把 CardProgram
 *    声明的费用接进 Finalize；effects/instructions 也没有 cost.additional / cost.modify 原语
 *    （RIFT-89）。程序按 356.2.b.1 / 356.4.f.1 把两个组件写成 static 声明，保持可审查形状。
 * 2. "If you do" 的回执没有绑定：356.4.f.1 的凭证是支付决定，冻结 IR 没有费用结果绑定
 *    （调研记为 condition.result，46 个身份），因此减费无法以"已支付"为条件；程序用
 *    grantedBy 指向附加费组件记录该依赖（同 brazen-buccaneer），不写成无条件减费。
 * 3. [Ambush]（822）与 [Tank]（815）的关键词展开与消费方未合入（Ambush 无 KeywordDef；
 *    Tank 的 continuous.combat 分配优先级没有消费方——combat/ 的分配器不读分配要求）。
 * 依赖：RIFT-89（附加费用/减费/回执接线）、RIFT-84（Ambush 关键词）、RIFT-90（战斗分配）。
 */
const abilities: Ability[] = [
  // 822.1：印刷的 [Ambush]（提醒文本是 822.1.b 的说明）。
  { kind: "keyword", keyword: "ambush" },
  // 815.1：印刷的 [Tank]（提醒文本是 815.1.b 的说明）。
  { kind: "keyword", keyword: "tank" },
  {
    // 356.2.b / 356.2.b.1：可选附加费用（3 点 XP），组件 id 供下面的减费引用。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "poppy-defender-of-the-meek.xp-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
    }
  },
  {
    // 356.4 / 356.4.b：由上面的可选附加费用授予的 3 能量减费。
    // 356.4.f.1：只在该附加费用被选择时授予（grantedBy 记录该闸门）。
    kind: "static",
    effect: {
      kind: "cost.modify",
      appliesTo: "self",
      resource: "energy",
      amount: { kind: "constant", value: 3 },
      stage: "discount",
      grantedBy: "poppy-defender-of-the-meek.xp-cost"
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-c54e80533d4de83be156d119811d549cd348fa8bda54774a52cd58b3c451f3cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1)「You may spend 3 XP as an additional cost to play me」是可选附加费用" +
    "（356.2.b/356.2.b.1），但没有任何已合入路径把 CardProgram 声明的费用接进 Finalize——" +
    "cost/cost-plan.ts 只在调用方显式传入 optionalAdditional 时生效，effects/instructions 也没有" +
    "cost.additional / cost.modify 原语（RIFT-89）。(2)「If you do, I cost :rb_energy_3: less」的" +
    "闸门是 356.4.f.1 的支付决定，冻结 IR 没有费用结果绑定（调研记为 condition.result），" +
    "因此减费不能以「已支付」为条件；程序用 grantedBy 记录该依赖（同 brazen-buccaneer 的写法），" +
    "不写成无条件减费。(3) [Ambush]（822.1.b/822.1.c）没有已合入的关键词展开（effects/keywords 无 " +
    "Ambush.ts），其位置许可与 Reaction 时间许可（continuous.timing + 位置许可）无消费方（RIFT-84）；" +
    "[Tank]（815.1.b）的 continuous.combat 分配优先级没有消费方——combat/ 的伤害分配器不读分配要求（RIFT-90）。" +
    "程序保留可审查的声明形状；印刷的 6 能量费用与无 minimum 的 3 能量减费未被改写（energy:null 不写成 0）。" +
    "依赖：RIFT-89、RIFT-84、RIFT-90。不近似实现。",
  abilities,
  sourceText:
    "You may spend 3 XP as an additional cost to play me. If you do, I cost :rb_energy_3: less.\n" +
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
