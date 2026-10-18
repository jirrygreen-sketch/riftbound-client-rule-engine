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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - cost/discounts/collect.ts 已能在调用方提供静态绑定、锁定目标集合和支付者选择时收集本卡的折扣：
 *   target relation 会按精确 ObjectRef 匹配，Universal Power alternative 也会按六个 Domain 的 Power
 *   需求处理。没有消费方把 CardProgram 的 static 改费效果接进生产 Finalize，生产绑定阶段仍有两道拒绝：
 *   (a) programs/statics.ts 的 staticTarget 不接受本卡的 appliesTo 形状，抛
 *   ProgramBindingError（Unsupported static appliesTo {"type":"spell","object":"self"}）；
 *   (b) 即使把 appliesTo 换成 "self" 简写，layerFor 对 continuous.cost-modification 仍抛
 *   ProgramBindingError（Static ability kind continuous.cost-modification has no layer mapping）。
 *   而 cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣
 *   （356.4 / 356.4.c / 356.4.d 的组件与总价顺序、356.4.e 的每条折扣最低值都由该管线负责）；
 *   cost.modify / cost.pay 原语本身已合入，但没有任何管线把卡牌 static 声明编译成这笔折扣。
 * - chain/engine.ts Finalize 仍直接使用调用方给出的 CostPlanInput，没有把卡程序 static 声明转换为
 *   CostDiscount，也没有把实际锁定目标集合和静态绑定传入 finalizeCostPlan；因此这张卡的生产打出路径
 *   仍然无法应用折扣。
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
    "缺把本卡 static 改费效果接进 Finalize 费用计划的消费者，生产绑定阶段两道拒绝：" +
    "(a) programs/statics.ts 的 staticTarget 不接受本卡 appliesTo 形状，抛 ProgramBindingError" +
    "（Unsupported static appliesTo {\"type\":\"spell\",\"object\":\"self\"}）；" +
    "(b) 即使改用 \"self\" 简写，layerFor 对 continuous.cost-modification 仍抛 ProgramBindingError" +
    "（Static ability kind continuous.cost-modification has no layer mapping）。" +
    "cost/discounts/collect.ts 已能在调用方提供静态绑定、锁定目标集合和支付者选择时处理这两项语义：" +
    "{ type: \"spell\", object: \"self\" } 会按精确目标引用匹配，Universal Power alternative 会转换为" +
    "可由六个 Domain 支付的 Power 折扣。仍缺生产接线：programs/statics.ts 的 staticTarget 不接受本卡" +
    " appliesTo 形状，改用 self 简写后 layerFor 对 continuous.cost-modification 仍抛 ProgramBindingError；" +
    "chain/engine.ts Finalize 也没有把 CardProgram static、实际锁定目标和静态绑定传给 finalizeCostPlan。" +
    "不近似实现。",
  abilities,
  sourceText: "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

export default program;
