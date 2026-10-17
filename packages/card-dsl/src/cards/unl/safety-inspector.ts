import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Safety Inspector (unl-164-219) — Unit, Order, energy 5, power 1, Might 3,
 * tags Yordle/Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-164-219，逐字）:
 *   "You may spend 3 XP as an additional cost to play me.\n"
 *   "When you play me, each player must kill one of their units. If you paid my
 *    additional cost, you don't kill a unit this way."
 *
 * 规则依据（CR v1.5）:
 * - 356.2.b / 356.2.b.1："You may spend 3 XP as an additional cost to play me" 是
 *   由被打出的卡牌自身的 Passive Ability 指定的可选附加费用（Optional Additional
 *   Cost）；决定权在打出的费用步骤（355.1 / 355.1.a），组件在 356.2 应用，XP 支付
 *   经已合入的 cost 计划（payment.ts 的 spend-xp 动作）。
 * - 356.4.f.1：可选附加费用只要玩家做了支付决定即视为"已付"，与实际扣除的数值
 *   无关；支付凭证由费用计划的 selectedAdditional 回执给出。
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect，时点 card-played、
 *   filter 指向本卡自身。
 * - 429.6 / 429.1.a.1："kill one of their units" 是 Kill 指令，用已合入的
 *   effect.kill；"each player must kill one of their units" 的受害者是各玩家自己
 *   控制的单位，"若我付了附加费用，我就不这样消灭单位"是同一触发里的条件从句。
 *
 * status = judge-required（2026-10-17 对源码逐条复核）：
 * 三处当前缺口：(1) each player must kill one of their units（CR 429.6）需要逐玩家扇出与各玩家选择自己单位的绑定：
 * layers/filter.ts 的 selectorMatches 只认 any/self/opponent/playerId，controller:"each-player" 实测对任何单位都
 * 返回 false（neither A's nor B's unit matches），PickSpec 也没有"由各玩家各选一个"的循环。
 * (2) If you paid my additional cost（356.4.f.1）的回执读取路径存在（condition.result + readAdditionalDecision），
 * 但没有任何生产方把 Finalize 的 CostPlan/支付回执送进该触发的求值环境：Program triggered 能力没有 cost 字段，
 * programs/triggers.ts 也不生成 cost/mayAtFinalize，实测无 cost 上下文时 condition.result 抛
 * "Unavailable condition result: cost.additional"。(3) cost.additional 静态声明仍未接入 CardProgram → CostPlan：
 * programs/play.ts 的 translateCost 对 kind "additional" 直接 judgeRequired，programs/statics.ts 的 layerFor 也以
 * "Static ability kind cost.additional has no layer mapping" 拒绝该静态效果（实测）。XP 支付本体与 card-played 触发注册已合入。
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：可选附加费用由被打出卡牌的 Passive Ability 指定。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "safety-inspector.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          // 730.2：Spend XP 是减少该玩家标记的 XP；支付走费用计划的 spend-xp 动作。
          kind: "xp",
          amount: { kind: "constant", value: 3 }
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "safety-inspector.kill-unit",
        op: "effect.kill",
        args: {
          // "kill one of their units"：选择是非目标的 pick（355.10.c 的结算期选择），
          // 成员由"该玩家自己的单位"给出；按玩家扇出尚未合入（见 judgeReason），
          // 这里的 pick 只是形状与占位，不声称已实现"each player"。
          picks: { kind: "constant", value: "safety-inspector.each-player-unit" }
        },
        picks: [
          {
            id: "safety-inspector.each-player-unit",
            options: ["unit-controlled-by-each-player"],
            // "one of their units"＝由该玩家控制的一个单位；controller 选择器
            // 没有"逐玩家"取值，故只记录形状（见 judgeReason）。
            filter: { type: "unit", zone: "board", controller: "each-player" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-e6ded9cf1a86a9d78660918b257ded9725d2afb4395c59332d8c3f7d09d03eb9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（均不近似实现）：(1) each player must kill one of their units（CR 429.6）需要逐玩家扇出与各玩家选择自己单位：" +
    "layers/filter.ts 的 selectorMatches 只认 any/self/opponent/playerId，controller:\"each-player\" 实测对任何单位都返回 false，" +
    "PickSpec 也没有「由各玩家各选一个」的循环。(2) If you paid my additional cost（356.4.f.1）的回执读取本身已在 " +
    "condition.result / readAdditionalDecision 中实现，但没有生产方把 Finalize 的 CostPlan/支付回执送进该触发的求值环境" +
    "（programs/triggers.ts 不生成 cost/mayAtFinalize），实测无 cost 上下文时 condition.result 抛 " +
    "\"Unavailable condition result: cost.additional\"。(3) cost.additional 静态声明仍未接入 CardProgram → CostPlan：" +
    "programs/play.ts 的 translateCost 对 kind \"additional\" 直接 judgeRequired，programs/statics.ts 的 layerFor 也以 " +
    "\"Static ability kind cost.additional has no layer mapping\" 拒绝该静态效果（实测）。XP 支付本体与 card-played 触发注册已合入。",
  abilities,
  sourceText:
    "You may spend 3 XP as an additional cost to play me.\n" +
    "When you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way."
} satisfies CardProgram;

export default program;
