import type { CardProgram } from "../../ir/index.js";

/**
 * Starry-Eyed Songstress (rad-151-167 / rad-174-167) — Legend, Mind/Order, tag Seraphine.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-151-167，逐字）：
 *   "As an additional cost to play a spell, you may exhaust me and three friendly
 *    units to reduce the cost of that spell by :rb_energy_2:."
 *
 * 规则依据（CR v1.5）：
 * - 356.2.b / 356.2.b.1：Optional Additional Costs 由“被打出的牌或另一张牌上的被动
 *   能力”提供，措辞是 “as an additional cost” + “may”；玩家在费用流程的步骤 2 决定
 *   是否支付，204.2 / 204.2.a 要求附加费用付清才能 finalize 该牌。本卡的提供者是这张
 *   传奇上的被动能力，所以按 static（Passive Ability，363）建模。
 * - 356.4 / 356.4.f：“reduce the cost of that spell by :rb_energy_2:” 是 Discount，
 *   且减费可以作用于附加费用；本卡固定减 2 Energy，没有印刷最低值。
 * - 415.4 / 415.5：“exhaust me” 是费用式横置，必须能完成；415.1.b 规定已横置的对象
 *   不能被再次横置，因此费用式横置不能用 effect.exhaust 的状态改变代替。
 * - 355.10.c.1 / 355.7：“[do X] to [do Y]” 里作为代价的“三个友方单位”属于费用，
 *   不产生目标，因此用非目标选择（PickSpec 形状）描述，而不是 TargetSpec。
 * - 107.4.c / 108.3：“me” 是 Legend Zone 里的这张传奇（Game Object）。
 *
 * status = judge-required：整张卡没有可执行路径（依赖 RIFT-261、RIFT-257），不做近似
 * 实现——
 * - 费用种类与指令（cost.additional / cost.pay / cost.modify，RIFT-261）仍在进行中，
 *   本 worktree 的 effects/instructions/ 没有 cost.* 原语；也没有消费方读取卡牌声明的
 *   可选附加费用与 -2 Energy 折扣（356.2.b 的步骤 2 决定属于费用系统）。
 * - 卡牌 static 能力 → 图层/费用管线注册（RIFT-257）未合入。
 * - 契约 ZoneId 没有 legend-zone（107.4.c），传奇自身无法作为可横置的费用对象。
 * 下面的 static 只保留可审查的声明形状，golden 只做校验、结构断言与缺口 todo。
 */
export default {
  canonicalCardId:
    "card.hash-464b0b2dffb63bc44ee6874ec88c809233d08e06f5215125cc0ac77d4012c215",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "被动能力授予的可选附加费用没有可执行路径：CR 356.2.b.1 的 Optional Additional Cost 由费用系统在" +
    "步骤 2 收集，而费用种类与指令（cost.additional / cost.pay / cost.modify）仍在 RIFT-261 进行中——" +
    "本 worktree 的 effects/instructions/ 没有 cost.* 原语，也没有任何消费方读取卡牌声明的附加费用与减费；" +
    "卡牌 static 能力接入费用/图层管线的生产者仍待 RIFT-257。“exhaust me” 是费用式横置（CR 415.4 / 415.5，" +
    "必须能完成），且 “me” 是 Legend Zone 里的传奇（CR 107.4.c），契约 ZoneId 没有 legend-zone，无法作为" +
    "可横置对象表达；“three friendly units” 按 355.10.c.1 属于费用、不产生目标，这里只保留非目标选择形状；" +
    "固定减费 -2 Energy（CR 356.4 / 356.4.f）与费用计划同样属 RIFT-261。依赖 RIFT-261（费用计划与费用指令）" +
    "与 RIFT-257（卡牌程序绑定）；不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 363 的 Passive Ability：为“你打出的法术”提供可选附加费用与对应减费。
        // 该 kind 由 RIFT-9 模板（cost-modify / cost-resources）与 ornns-forge 等
        // 已合入卡牌一致使用；费用管线的消费方仍待 RIFT-261（见 judgeReason）。
        kind: "cost.modify",
        appliesTo: "play-spell-cost",
        resource: "energy",
        // 356.4.f：Discounts can reduce additional costs（固定 -2 Energy）。
        amount: -2,
        filter: { type: "spell", controller: "controller" },
        // 356.2.b.1：可选附加费用（“you may …”）。这里是待接线的声明，不是已求值语义。
        additionalCost: {
          optional: true,
          payments: [
            // “exhaust me”：Legend Zone 里的这张传奇（107.4.c）。
            { kind: "exhaust", object: "self" },
            // “and three friendly units”：费用内的非目标选择（355.10.c.1 / 355.7）。
            {
              kind: "exhaust",
              amount: 3,
              choice: {
                id: "starry-eyed-songstress.friendly-units",
                options: ["friendly-unit"],
                min: 3,
                max: 3,
                selection: "all",
                zone: "board",
                type: "unit",
                owner: "controller"
              }
            }
          ]
        }
      }
    }
  ],
  sourceText:
    "As an additional cost to play a spell, you may exhaust me and three friendly units to reduce " +
    "the cost of that spell by :rb_energy_2:."
} satisfies CardProgram;
