import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Irelia, Graceful (sfd-141-221) — Unit, Chaos, Irelia/Ionia/Champion.
 * energy 4, power 1, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-141-221，逐字）:
 *   "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less."
 *
 * 规则依据（CR v1.5）：
 * - "While …"/无条件被动改费属于 Passive Ability（363），按契约 3.1 用 static 能力声明，不写流程。
 * - "spells that choose me"：355.6 规定 "choose" 一词在卡面等于 Targeting；"me" 指本卡自身
 *   （359.3.f 的 referent），故适用范围是"以本卡为目标之一的法术"——写成静态效果上的过滤描述
 *   （object: "self" 是契约 3.6 的符号选择器，不写运行时 ObjectRef）。
 * - "cost [1] or [A] less"：356.4 / 356.4.b 的减费，且是本牌指定资源的二选一；
 *   [A] 是 163.2.b 的 Universal Power（任意域力量），不是某个具名域。
 * - 该减费由本卡作为 Passive Ability 授予，属 366.2 一类在可打出区域始终生效的改费能力。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 没有消费方把 CardProgram 的 static 改费效果接进 Finalize 的费用计划：effects/instructions/ 下
 *   没有注册 cost.modify / cost.pay 原语，cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts
 *   时应用折扣，且 CostPlanInput/CostDiscount 没有"仅当该法术以本卡为目标时"的维度
 *   （RIFT-89 费用计划接线 + RIFT-90 目标管线）。
 * - "or [A]" 的 Universal Power（163.2.b）无法用封闭 Domain 类型与 CostDiscount.resource 表达；
 *   effect.resources 明确记录 [A] 保持 unsupported、绝不用具名域近似（与 sfd/glasc-mixologist 同款缺口）。
 * - 打印文本里的 "or" 还需要支付者在这两个资源之间做选择，费用计划的 discount 形状没有该选择位。
 * 依赖：RIFT-89（cost.modify / 费用计划接线）、RIFT-90（目标条件折扣）、Universal Power 的契约变更请求。
 * 不近似实现：不把 [A] 写成某个具名域，也不在卡层直接改写打出费用。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      // 356.4.c：按组件生效的减费（基础 Energy / Power 组件）；356.4.b 的 "cost [amount] less" 措辞。
      stage: "discount",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      // 356.4.b / 356.4.c 的二选一替代资源：1 点 [A]（163.2.b 的 Universal Power）。
      alternative: {
        resource: "power",
        universal: true,
        amount: 1
      },
      // "Your spells that choose me"（355.6 的 choose = Targeting；"me" 是符号选择器 "self"）。
      appliesTo: { type: "spell", object: "self" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺把本卡 static 改费效果接进 Finalize 费用计划的消费者：effects/instructions/ 没有注册 cost.modify / cost.pay 原语，" +
    "cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣（356.4 / 356.4.c / 356.4.d 的组件与总价顺序、" +
    "356.4.e 的每条折扣自带最低值都由该管线负责），且 CostPlanInput/CostDiscount 没有「仅当该法术以本卡为目标」的维度" +
    "（355.6 的 choose = Targeting，需要 RIFT-90 的目标条件）。" +
    "同时「or :rb_rune_rainbow:」的 [A] 是 163.2.b 的 Universal Power：封闭 Domain 类型与 CostDiscount.resource 不表达，" +
    "effect.resources 明确保持 unsupported、绝不用具名域近似；打印文本的二选一还需要费用计划的支付者选择位，当前没有。" +
    "依赖：RIFT-89（费用计划接线）、RIFT-90（目标条件折扣）、Universal Power 的契约变更请求。不近似实现。",
  abilities,
  sourceText: "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

export default program;
