import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Astral Heron (ven-044-166) — Unit, Calm, 7 Energy, Might 7, tag Bird/Mount Targon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-044-166，逐字）：
 *   When you play your first card each turn, if I'm at a battlefield, your next card
 *   costs :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: less.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.1.b / 383.3.e / 383.3.e.1："When you play your first card each turn"
 *   是 Nth-Time 触发条件（383.1.b 规定同时满足多次时只触发一次、由控制者选一次实例）；
 *   契约 3.5 的 TriggerSpec.once: "per-turn" 表达「每回合只执行指定次数」的寿命，
 *   与已合入的 rad/akali-brash（"The first time I move each turn"）同一写法。
 * - 封闭时点 "card-played"（events/timing-points.ts，ruleRefs 359/383.4.a/407）承载
 *   「你打出一张牌」；filter 里 player: "self" 表示事件玩家是能力控制者。
 * - 383.2.a / 383.2.a.1：紧跟触发条件的 "if I'm at a battlefield" 属于 Trigger Condition
 *   （规则原文的 Sona, Harmonious 例即此形状：条件在触发时判定，之后来源被移除仍会结算），
 *   因此写在 trigger.condition 上；条件本身是「本卡位于战场」的 Location 读数
 *   （107.1/107.2、198.1 的 Location；与 sfd/tianna-crownguard 同一谓词缺口）。
 * - 356.4 / 356.4.a / 356.4.b / 356.4.c："your next card costs … less" 是减费（discount），
 *   在「3. Determine Total Cost」步骤对**本回合你打出的下一张牌**生效；356.4.c.1 说明
 *   分量式折扣只作用于指定成本分量。本卡同时减 2 点 Energy 与 2 点任意域 Power
 *   （135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow: 是任意域 Power，163.2.b 的 Universal Power）。
 * - 206/206.1：费用判定一律使用印刷（或复制来的）费用；折扣只作用于实际支付。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 「your next card」是一次性（one-shot）费用改写窗口：Duration 只有 permanent /
 *    end-of-turn / end-of-combat / while-source-in-zone / until，没有 next-card 期限；
 *    cost.modify 指令与通用 Power 折扣均已合入，但「把折扣注册进本回合下一次 Finalize 的费用计划」
 *    的消费方仍缺：cost/cost-plan.ts 的 discounts 只在单次计划内生效，没有 CardProgram → CostPlan 接线
 *    （RIFT-89；同 ogn/raging-firebrand、rad/boy-who-shattered-time 的记录）。
 * 2. 「if I'm at a battlefield」需要在触发时求值的 Location 谓词：object-property 能读 location，
 *    但持续/触发条件没有落地路径（同 sfd/tianna-crownguard 的缺口）。
 * 3. card-played 触发的静态注册已随 RIFT-257 合入（programs/triggers.ts →
 *    registerProgramTriggers → engine.pipeline.registerTrigger，attachProgramLifecycle 自动附着）；
 *    383.2.c.1 关于「本卡在同一时点进入该区域时触发条件是否成立」的条件适配仍没有卡牌可用路径。
 * 依赖：RIFT-89（next-card 费用窗口）、RIFT-91（条件/图层接线）。不近似实现：
 * 不把下一张牌窗口改写成永久或回合末折扣，也不把触发时 Location 条件当成无条件成立。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { player: "self" } },
      // 383.3.e.1 / 383.5：Nth-Time 触发每回合只执行一次（383.1.b 的同时多次只触发一次）。
      once: "per-turn",
      // 383.2.a.1：紧跟触发条件的 "if I'm at a battlefield" 属于 Trigger Condition。
      // Location 谓词没有可求值形态（见 judgeReason 第 3 条），用描述性表达式保留印刷条件。
      condition: {
        kind: "expression",
        value: {
          kind: "object-property",
          object: "self",
          property: "at-battlefield"
        }
      }
    },
    optional: false,
    body: [
      {
        id: "astral-heron.reduce-next-card",
        // 356.4 的费用改写模板（cost.modify 指令已合入，next-card 窗口与费用计划消费方属 RIFT-89）：
        // 对本回合打出的下一张牌减 2 Energy 与 2 点任意域 Power；window 是描述窗口的常量，
        // 不是对象引用。不写固定总价，也不自行改写印刷费用。
        op: "cost.modify",
        args: {
          resource: { kind: "constant", value: "energy" },
          amount: { kind: "constant", value: -2 },
          appliesTo: { kind: "constant", value: "next-card-played-this-turn" },
          duration: { kind: "constant", value: "this-turn" },
          // 135.2.e.5.a / 163.2.b：两枚 :rb_rune_rainbow: = 2 点任意域 Power；
          // 卡牌侧保留 rainbow 记号，费用计划以通用 Power 折扣消费它。
          power: { kind: "constant", value: ["rainbow", "rainbow"] }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-7efb1a981d4769615bfa3bd93ca6dffae7dd488b8cbea4e087b97882f0d2933c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1)「your next card」是一次性费用改写窗口：Duration 只有 permanent/end-of-turn/" +
    "end-of-combat/while-source-in-zone/until，没有 next-card 期限；cost.modify 指令和通用 Power 折扣均已合入，" +
    "但把折扣注册进本回合下一次 Finalize 费用计划的 CardProgram → CostPlan 消费方仍缺（cost/cost-plan.ts 的 discounts " +
    "只在单次计划内生效，依赖 RIFT-89）；(2)「if I'm at a battlefield」是 383.2.a.1 的触发条件，" +
    "需要触发时求值的 Location 谓词，object-property 能读 location 但没有持续/触发条件落地路径（依赖 RIFT-91）；" +
    "(3) card-played 触发的静态注册已随 RIFT-257 合入（programs/triggers.ts → registerProgramTriggers → " +
    "engine.pipeline.registerTrigger，attachProgramLifecycle 自动附着），但 383.2.c.1 的同一时点条件判定仍没有卡牌可用路径。" +
    "「your first card each turn」按 383.1.b / 383.3.e.1 用 TriggerSpec.once: \"per-turn\" 表达。",
  abilities,
  sourceText:
    "When you play your first card each turn, if I'm at a battlefield, your next card costs :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: less."
} satisfies CardProgram;
