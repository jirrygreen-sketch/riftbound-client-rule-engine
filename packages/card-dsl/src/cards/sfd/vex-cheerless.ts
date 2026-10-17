import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vex, Cheerless (sfd-146-221) — Unit, Chaos, Yordle/Vex/Shadow Isles/Champion.
 * energy 5, power 1, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-146-221，逐字）:
 *   "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:,
 *    and enemy spells cost :rb_energy_1::rb_rune_rainbow: more."
 *
 * 规则依据（CR v1.5）：
 * - "While …"（363.2.a / 383.2.b 的条件持续能力）：这是无条件写入卡面的 Passive Ability，
 *   按契约 3.1 用 static 能力声明，不写流程。
 * - "While I'm in combat"：740.2.c 定义 "a unit is in combat" = 位于有战斗进行中的战场且带有战斗身份；
 *   它是该持续效果的条件（143.2.a/479 之类的图层条件），不是触发时点。
 * - "friendly spells cost [1][A] less to a minimum of [1]"：356.4 / 356.4.b / 356.4.e 的减费，
 *   其中 356.4.e 明确"折扣自带最低值只作用于该折扣"（Eager Apprentice 即此例）。
 * - "enemy spells cost [1][A] more"：356.2 的加费。"friendly" / "enemy" 是 740.1.a / 740.1.b
 *   相对施放者控制者的关系；"[A]" 是 163.2.b 的 Universal Power。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 已合入的 cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts/increases 时应用折扣与加费，
 *   没有消费方把卡牌 static 改费效果接进 Finalize 的费用计划：programs/statics.ts 的 bindStatic 默认
 *   noopStaticBinder（RIFT-257 后续），cost.pay / cost.modify 仍未合入（RIFT-261），也没有把「施放者的
 *   friend/enemy 关系」落到该管线输入的接线（RIFT-90）。
 * - "[A]"（163.2.b）无法用封闭 Domain 类型与 CostDiscount.resource / CostComponentInput 表达；
 *   effect.resources 明确该资源保持 unsupported、绝不用具名域近似。
 * - "While I'm in combat" 无可求值形态：740.2.c 需要战斗进行状态与战斗身份。ObjectSnapshot.combatRole
 *   已在 effects/contract.ts 声明（契约 3.8）且参考内核会写入，但 layers/engine.ts 的 conditionMatches
 *   只识别 always/never/type/has-tag/has-keyword（compare/count 一律返回 true），图层侧的
 *   in-combat 谓词与卡牌 static 注册同样缺失。
 * 依赖：RIFT-261（cost.pay/cost.modify）、RIFT-257 后续（卡牌 static 绑定）、图层条件求值，以及 Universal Power 的契约变更请求。
 * 不近似实现：不把 [A] 写成具名域，不省略最低值，也不把 "in combat" 当成常量真值。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // 356.4 / 356.4.b / 356.4.e：友方法术减 [1][A]，最低值 [1] 只作用于本条折扣。
      kind: "continuous.cost-modification",
      stage: "discount",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      minimum: { kind: "constant", value: 1 },
      // 356.4.b / 163.2.b 的二资源减费：[1] Energy 或 1 点 [A]（Universal Power）。
      alternative: {
        resource: "power",
        universal: true,
        amount: 1
      },
      // 740.1.a："friendly" 是相对法术施放者控制者的关系；742/355.9 的 "spell" 类型过滤。
      appliesTo: { type: "spell", controller: "caster" }
    },
    condition: {
      kind: "compare",
      // 740.2.c 的 "I'm in combat"：需要战斗进行状态与战斗身份；图层侧谓词未实现，
      // 因此这里只记录「对自身求值 in-combat」的形状（object: "self" 锚点），
      // 不用其他谓词冒充。
      left: {
        kind: "count",
        subject: "self-in-combat",
        filter: { object: "self" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  },
  {
    kind: "static",
    effect: {
      // 356.2 的加费：敌方法术费用 +[1][A]。
      kind: "continuous.cost-modification",
      stage: "increase",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      alternative: {
        resource: "power",
        universal: true,
        amount: 1
      },
      // 740.1.b："enemy" 是相对法术施放者控制者的关系。
      appliesTo: { type: "spell", controller: "caster-opponent" }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "self-in-combat",
        filter: { object: "self" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f53634b94e6fae93d877ca3bb7f92c97c1f881953a9d82fc5a297b398f35d3ad",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) 没有把 CardProgram 的 static 改费效果接进 Finalize 费用计划的消费方：programs/statics.ts 的 bindStatic 默认是 noopStaticBinder（RIFT-257 后续），" +
    "cost.pay / cost.modify 也未合入（RIFT-261）；cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts/increases 时应用折扣与加费" +
    "（356.4.e 的最低值只作用于该折扣、356.4.c.1/356.4.d 的组件与总价顺序都由该管线负责），也没有把「施放者的 friend/enemy 关系」落到该管线输入的接线（RIFT-90）。" +
    "(2)「:rb_rune_rainbow:」是 163.2.b 的 Universal Power：封闭 Domain 类型与 CostDiscount.resource 不表达，" +
    "effect.resources 明确保持 unsupported、绝不具名域近似。" +
    "(3)「While I'm in combat」（740.2.c）无图层侧求值形态：ObjectSnapshot.combatRole 虽已在 effects/contract.ts 声明（契约 3.8），" +
    "但 layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，compare/count 一律返回 true，" +
    "图层侧 in-combat 谓词与卡牌 static 注册仍缺失（同 ogn/cannon-barrage、ogn/wielder-of-water）。" +
    "依赖：RIFT-261、RIFT-257 后续、图层条件求值，以及 Universal Power 的契约变更请求。不近似实现。",
  abilities,
  sourceText:
    "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
    "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more."
} satisfies CardProgram;

export default program;
