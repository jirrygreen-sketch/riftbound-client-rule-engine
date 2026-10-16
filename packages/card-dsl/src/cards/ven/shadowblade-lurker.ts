import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadowblade Lurker (ven-096-166) — Unit, Chaos, tag Ionia.
 * 5 Energy, no printed Power（`power: null`，表示没有印刷值，不是 0），Might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-096-166，逐字）：
 *   I cost :rb_energy_2: less for each card with my name in your trash.
 *
 * 规则依据（Core Rules v1.5）：
 * - 366.2 / 366.2.a：改费被动能力在“能打出该牌的任意区域”始终生效；356.4 / 356.4.b 把
 *   “I cost [X] less” 归入费用计划的减费阶段（discounts），356.4.e 规定每条折扣自带的
 *   最低值只约束该折扣本身；356.6 规定 Energy 费用不得减到 0 以下。
 * - 206：需要判定费用时使用印刷费用；折扣只作用于实际支付，不改写印刷特征。
 * - “for each card with my name in your trash” 是按特征程序化选出的集合计数
 *   （355.10.d，不是目标）；“your” 指该被动能力的控制者（190.6.d）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处缺口都不近似实现：
 * 1. 没有把卡牌 static 费用改写装进 Finalize 费用计划的消费者：cost/cost-plan.ts 的减费只读
 *    调用方传入的 CostDiscount，effects/instructions/ 下没有 cost.modify 原语（RIFT-9 清单
 *    要求，属 RIFT-89 费用批次）。程序按契约形状声明折扣，不自行改写任何费用。
 * 2. “cards with my name” 是名称自指：合并过滤器只按字面值比较（layers/filter.ts 的
 *    characteristicsMatch 用 ===，参考内核同理），没有读取宿主当前名称的谓词；382.4 的复制
 *    改名情形同样落在该谓词上。因此 count 的 filter 只记录区域与拥有者，名称条件见本段说明，
 *    不用任何字面名字近似（否则会把“同名”错误地实现成某一张具体的牌）。
 * 3. 折扣基数「每张同名牌减 2 Energy」需要在费用计划里按集合计数求值（356.4.b），与第 1 点
 *    同批落地；test.todo 记录这两个依赖。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      resource: "energy",
      // 每张满足下列集合条件的牌：减 2 Energy。
      amount: { kind: "constant", value: -2 },
      // 356.4.e / 356.6：该折扣的最低值（此处即 Energy 地板 0）。
      minimum: { kind: "constant", value: 0 },
      per: "card-with-my-name-in-your-trash",
      // 「你的垃圾场」：区域与拥有者；「与我的名字相同」的谓词缺口见 judgeReason 第 2 点。
      count: {
        kind: "count",
        subject: "cards-with-my-name-in-your-trash",
        filter: { zone: "trash", owner: "self" }
      }
    }
  }
];

export default {
  canonicalCardId: "card.hash-b2bea662f1f3693d6ae9fddc62c97b8b41a34b4c737adb3790687eef7399fe95",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有把卡牌 static 费用改写装进 Finalize 费用计划的消费者——" +
    "cost/cost-plan.ts 的 CostDiscount 只由调用方传入，effects/instructions/ 下没有 cost.modify 原语" +
    "（RIFT-9 清单，属 RIFT-89）；(2)「for each card with my name in your trash」的名称自指没有可求值谓词：" +
    "合并过滤器（layers/filter.ts 的 characteristics、参考内核 matchesFilter）只做字面相等比较，读不到宿主的当前名称，" +
    "382.4 的改名情形同样无法处理；用字面名字写死会把“同名”变成某一具体牌，因此 count 的 filter 只记录 zone/owner；" +
    "(3) 折扣基数需在费用计划里按集合计数求值（356.4.b/356.4.e），与第 1 点同批。" +
    "依赖：RIFT-89（cost.modify / 费用计划减费接线）与名称谓词（对象名称的运行时读取）。",
  abilities,
  sourceText: "I cost :rb_energy_2: less for each card with my name in your trash."
} satisfies CardProgram;
