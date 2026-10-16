import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dune Devourer (rad-125-167) — Unit, Order, 7 energy / 1 power / 7 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-125-167):
 *   "You may kill a friendly unit as an additional cost to play me. If you do,
 *    I cost :rb_energy_2: less.
 *    [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *    or ability.)"
 *
 * 规则依据（CR v1.5）：
 * - "as an additional cost to play me"：204.2/204.2.a 附加费用，356.2 按顺序施加；
 *   "You may kill a friendly unit" 是可选的附加费用（356.2.b/356.2.b.1），必须以
 *   选择对象的方式结算，但 355.10.c 明确 "As an additional cost to play me, kill a
 *   friendly unit" 不指定目标 → 用 PickSpec（非目标选择）而不是 TargetSpec。
 * - "If you do, I cost 2 less"：356.4.f/356.4.f.1 折扣可以作用于附加费用，且
 *   "optional additional cost was paid if the player made the decision to pay it"；
 *   444 条件折扣按 356.4.g 在折扣步骤取值。卡牌侧只能描述"若已支付可选附加费用"
 *   这一条件；条件谓词本身由费用管线提供（沿用 merged 先例：fiora-peerless 的
 *   condition.expression + 符号谓词名）。
 * - [Deflect]（809）：被动/触发关键词，等于 "Opponents must pay [A] to choose me
 *   with a spell or ability"；809.1.c 是目标选择时追加的强制费用（356.2.a.2）。
 *   按契约 3.1 声明 keyword 能力，展开由 effects/keywords/Deflect.ts 负责。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - cost.modify / cost.additional 没有已注册指令文件（RIFT-9 原语清单 78 项中的
 *   cost.* 一族），卡牌的 CostSpec 也没有被 CardProgram→CostPlanInput 的编译器消费；
 *   "若支付则减 2" 的条件折扣（356.4.f.1）因此无法落到最终费用计划（RIFT-89）。
 * - effects/keywords/Deflect.ts 的展开依赖 target.tax（809.1.c 的目标追加费用）
 *   与 cost.pay（无限制域 Power 支付），两者按该文件自述尚未落地（RIFT-90/89）。
 * - Unit 的最终费用由链在 Finalize 以 catalog 印刷费用 + mandatoryAdditional/
 *   optionalAdditional/discounts 组合生成（chain/engine.ts 的 buildCostPlan 路径）；
 *   卡牌程序目前无法把自己的附加费用/折扣接入该输入，因此本条能力只能描述形状。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "play",
    cost: {
      kind: "additional",
      // "You may kill a friendly unit": 355.10.c —— 附加费用中的对象不是目标。
      payments: [
        {
          kind: "kill",
          choice: {
            id: "dune-devourer.friendly-unit",
            options: ["friendly-unit-you-control"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "board",
            type: "unit",
            owner: "controller"
          }
        }
      ]
    },
    body: []
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "self",
      amount: { kind: "constant", value: -2 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "optional-additional-cost-paid:kill-a-friendly-unit" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f33da6b768e700ee188122bbd6f6aad4f17db64d49c416a3c437ddb6d98ad07b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 cost.modify / cost.additional 指令（RIFT-9 原语清单的 cost.* 一族尚未合入）与" +
    "CardProgram→CostPlanInput 的编译器：356.2.b/356.4.f.1 的可选附加费用 \"may kill a" +
    " friendly unit\" 与 \"if you do, I cost 2 less\" 的条件折扣无法进入链在 Finalize" +
    "生成的最终费用计划（依赖 RIFT-89）。[Deflect] 的展开同样未落地：effects/keywords/" +
    "Deflect.ts 自述依赖 target.tax（809.1.c 目标追加费用，RIFT-90）与 cost.pay（无限制" +
    "域 Power 支付，RIFT-89）。依赖：RIFT-89、RIFT-90、关键词工作流。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
