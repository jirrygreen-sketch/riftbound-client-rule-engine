import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-075-167 Skystrike Squadron（能量 5、Power 无印刷值、Might 4、领域 Body、无标签）。
 *
 * 原文（逐字）：
 *   "You may return a friendly gear to its owner's hand as an additional cost to
 *    play me. If you do, I cost :rb_energy_2: less."
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
 *
 * 规则依据（CR v1.5）：
 * - "You may ... as an additional cost to play me"：可选附加费用，在 Determine Total
 *   Cost / Pay Costs 阶段按 356.2 计入（355.10.c.1 明确指令内费用不因此成为目标，
 *   要选的 gear 仍是非目标选择）；"If you do, I cost [2] less" 是条件式费用减少
 *   （356.4 的 component discount），只有该附加费用被支付才生效。两条都作用在费用
 *   计算阶段，不能写成结算期指令。
 * - [Deflect]（809.1 / 809.1.b / 809.1.b.3）：Passive Ability 关键词，印刷 "Deflect [X]"，
 *   省略 X 时按 1；809.1.c 的功能等价是"对手控制、以我为目标的法术与能力要额外支付
 *   X 点 Power"，809.1.c.1 明确这笔 Power 可用任意领域支付；809.2 多个来源的 Deflect
 *   数值相加；809.3 是可引用特征。按 README 第 5 节只声明关键词，展开属
 *   effects/keywords/Deflect.ts（已产出 target.tax 形状）。
 *
 * 状态：judge-required。费用原语与生产绑定链均已合入，但下面三处是当前真实缺口：
 * 1. 附加费用"return a friendly gear to its owner's hand"没有收费路径：费用管线接受的
 *    付款种类只有 energy/xp/power 与 exhaust/discard/recycle/kill/reveal/spend-buff
 *    （cost/plan-values.ts 的 blocked 路径实测返回 "Unsupported payment kind:
 *    return-to-hand"）；而 programs/play.ts 的 translateCost 在翻译 Play 程序时首先
 *    拒绝 kind: "additional-cost"、optional 与 discounts 字段（judgeRequired），
 *    附加费用在"卡牌程序 → 费用计划"的生产绑定层就被挡住。
 * 2. "If you do, I cost [2] less" 需要条件式费用改写（356.4.c 的 component discount）
 *    与"已支付该附加费"的检测消费方；cost/cost-plan.ts 只从调用方显式传入的
 *    input.discounts 应用折扣，没有读取卡牌声明或费用支付历史的入口。
 * 3. [Deflect] 的展开（target.tax）已存在并经 programs/statics.ts → layers 注册，
 *    但 chain/engine.ts finalize 把收集到的 TargetTaxRequest（只有 amount: number）
 *    写成 mandatoryAdditional 的 { energy: amount } 常量（plan-values 不接受 Power
 *    域约束以外的强制加项形状），809.1.c.1 的"任意领域 Power"税无法如实收取。
 * 不近似实现：不把附加费用写成结算期 effect.zone，也不把"少 2 Energy"近似成无条件减费，
 *   也不在本卡手写 target tax。
 */
const abilities: Ability[] = [
  {
    kind: "play",
    cost: {
      kind: "additional-cost",
      // "You may ... as an additional cost"：可选附加费用（356.2）。
      optional: true,
      payments: [
        {
          kind: "return-to-hand",
          choice: {
            id: "skystrike-squadron.returned-gear",
            // 费用中的选择不是目标（355.10.c）：非目标 PickSpec。
            options: ["friendly-gear-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "gear", controller: "controller", zone: "board" }
          }
        }
      ],
      // "If you do, I cost :rb_energy_2: less." —— 只有该附加费用被支付才生效的
      // 条件式费用减少（356.4.c）；这里声明意图，消费方见 judgeReason。
      discounts: [
        {
          kind: "cost-modification",
          resource: "energy",
          amount: { kind: "constant", value: -2 },
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "returned-gear-paid" },
            operator: "eq",
            right: { kind: "constant", value: true }
          }
        }
      ]
    },
    // 除附加费用与 [Deflect] 外没有效果正文。
    body: []
  },
  // 809.1.b.3：印刷 "[Deflect]" 省略数值，按 1 处理。
  { kind: "keyword", keyword: "deflect", value: 1 }
];

const program = {
  canonicalCardId:
    "card.hash-0637f5fadf7db883948eb6366a512392aa80676b5a0ff45433e37f75c35961c3",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "附加费用「return a friendly gear to its owner's hand」没有收费路径：programs/play.ts 的 translateCost " +
    "实测拒绝 kind: \"additional-cost\"、optional 与 discounts 字段（judgeRequired），且 cost/plan-values.ts 的 " +
    "blocked 路径实测返回 Unsupported payment kind: return-to-hand（费用管线只支持 energy/xp/power 与 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff）；" +
    "「If you do, I cost :rb_energy_2: less」还需要 356.4.c 的条件式 component discount 与「该附加费已支付」" +
    "的检测消费方，cost/cost-plan.ts 只从调用方显式传入的 discounts 应用折扣。" +
    "[Deflect 1]（809.1）的展开（target.tax）已存在并经 programs/statics.ts 注册，但 chain/engine.ts finalize " +
    "把收集到的 TargetTaxRequest（只有 amount: number）写成 mandatoryAdditional 的 { energy: amount } 常量，" +
    "809.1.c.1 的「任意领域 1 Power」税无法如实收取。" +
    "不近似实现：不把附加费用写成结算期 effect.zone、不把它当成无条件减费、也不在本卡手写 target tax。",
  abilities,
  sourceText:
    "You may return a friendly gear to its owner's hand as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
