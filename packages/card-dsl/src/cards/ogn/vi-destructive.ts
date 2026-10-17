import type { CardProgram } from "../../ir/index.js";

/**
 * Vi, Destructive (ogn-036-298) — Unit, Fury, Vi/Piltover/Champion.
 * energy 2, power 1 (Fury), Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-036-298):
 *   "[Ganking] (I can move from battlefield to battlefield.)\nRecycle 1 from
 *    your trash: Give me +1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Ganking]（810）：被动关键词，为单位的 Standard Move 增加"战场→战场"
 *   许可；卡只声明 keyword，展开和移动合法性由引擎消费。
 * - "Recycle 1 from your trash: Give me +1 :rb_might: this turn." 是
 *   **激活能力**：冒号前是费用、冒号后是效果（CR 358："[Cost]: [Effect]"；
 *   费用中的 recycle 见 417.3）。Timing：文本没有任何 Action/Reaction 许可，
 *   按单位激活能力的默认时机为 action 速度（159.2；Polite/Reaction 只来自
 *   [Reaction] 关键词）。
 *   - 费用："Recycle 1 from your trash" 是费用中的回收（417.3），使用
 *     CostSpec.payments 的 recycle 支付形状（由已合入的
 *     buildCostPlan/payCostPlan 消费；选项是控制者 Trash 中的牌）。
 *   - 效果："Give me +1 :rb_might: this turn" 是本回合到期的临时 Might 修正，
 *     属于 continuous.might（effect.buff 只处理 Buff 计数器，不得代用）。
 *
 * status：judge-required（复核 2026-10-17）。已合入：
 * - "Give me +1 :rb_might: this turn" 由 continuous.might 真实执行：
 *   golden 经生产链适配器 + 图层引擎断言 arithmetic 层注册、有效 Might 与
 *   end-of-turn 到期；
 * - "Recycle 1 from your trash" 的费用形状（CostSpec.payments 的 recycle）能由
 *   buildCostPlan/payCostPlan 收取（golden 以运行期选项支付并断言牌进牌库底）。
 * 仍缺：
 * - 静态 IR 只能写费用选择占位符（cost/plan-values.ts 要求每个 option 是精确
 *   ObjectRef），把 Trash 选择接到生产激活 Finalize 的 pick/choice 接线未完成；
 * - Ganking 展开目前把 permission 写成字符串，而 layers/rules/query.ts 读取
 *   permission.routes 数组，因此注册后的静态效果没有产生 canGank 路由；Standard
 *   Move 消费方已经存在，但需要引擎侧把两种权限形状接起来。
 * 依赖：生产激活费用选择接线、Ganking permission.routes 形状适配。
 * 不把临时 Might 落到 effect.buff 上近似。
 */
const viDestructive = {
  canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处生产接线缺口（复核 2026-10-17）：(1)「Recycle 1 from your trash」的费用形状可由 buildCostPlan/payCostPlan 收取" +
    "（golden 以运行期选项支付），但静态 IR 只能写选择占位符（cost/plan-values.ts 要求每个 option 是精确 ObjectRef），" +
    "生产激活 Finalize 尚未把 Trash 选择绑定到真实 pick/choice；" +
    "(2) [Ganking] 的 continuous.movement 展开把 permission 写成字符串，而 layers/rules/query.ts 要求 permission.routes 数组，" +
    "所以注册后的静态效果不会产生 canGank 路由；Standard Move 消费方已经存在，但还需要引擎侧适配权限形状。" +
    "已真实执行：「Give me +1 :rb_might: this turn」由 continuous.might 注册 end-of-turn arithmetic 层效果（golden 断言有效 Might 与到期）。" +
    "依赖：生产激活费用选择接线、Ganking permission.routes 形状适配。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "activated",
      cost: {
        payments: [
          {
            kind: "recycle",
            choice: {
              id: "vi-destructive.trash-card",
              options: ["card-in-controller-trash"],
              zone: "trash",
              owner: "controller",
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      },
      timing: "action",
      body: [
        {
          id: "vi-destructive.might-1",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            // "me": the ability source, read through the contract 3.6 symbolic
            // source selector (the merged continuous.might args shape).
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "Recycle 1 from your trash: Give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default viDestructive;
