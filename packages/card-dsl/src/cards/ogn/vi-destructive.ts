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
 * - [Ganking]（810.1.b/810.1.c）：被动关键词，为单位的 Standard Move 增加
 *   "战场→战场"许可；卡只声明 keyword，展开与移动合法性由引擎消费。
 * - "Recycle 1 from your trash: Give me +1 :rb_might: this turn." 是
 *   **激活能力**：冒号前是费用、冒号后是效果（CR 358："[Cost]: [Effect]"；
 *   费用中的 recycle 见 417.3）。Timing：文本没有任何 Action/Reaction 许可，
 *   按单位激活能力的默认时机为 action 速度（159.2）。
 *   - 费用：使用 CostSpec.payments 的 recycle 支付形状（由已合入的
 *     buildCostPlan/payCostPlan 消费；选项是控制者 Trash 中的牌）。
 *   - 效果："Give me +1 :rb_might: this turn" 是本回合到期的临时 Might 修正，
 *     属于 continuous.might（effect.buff 只处理 Buff 计数器，不得代用）。
 *
 * status：judge-required（第三轮复核 2026-10-17）。逐项实测结论：
 * - "Give me +1 :rb_might: this turn" 由 continuous.might 真实执行：golden 经
 *   生产链适配器 + 图层引擎断言 arithmetic 层注册、有效 Might 与 end-of-turn 到期。
 * - "Recycle 1 from your trash"：费用形状（CostSpec.payments 的 recycle）能由
 *   buildCostPlan/payCostPlan 收取（golden 以运行期选项支付并断言牌进牌库底），
 *   但静态 IR 只能写选择占位符（cost/plan-values.ts 的 choiceObjects 要求每个 option
 *   是精确 ObjectRef）。实测把本卡 cost 直接交给生产链：describeActivate 产出
 *   { payments:[{ kind:"recycle", choice:{ options:["card-in-controller-trash"] } }] }，
 *   chain/engine.ts 的 Finalize 里 buildCostPlan 抛
 *   CostPlanError("Cost requires an exact object reference")（invalid-cost-plan），
 *   生产激活 Finalize 尚未把 Trash 选择绑定到真实 pick/choice。
 * - [Ganking]：KeywordDef 展开出 continuous.movement，静态绑定路径（programs/statics.ts
 *   的 createEngineStaticBinder）能把它注册进 ability 图层，但 permission 保持字符串，
 *   而 layers/rules/query.ts 的 movement() 读 permission.routes 数组；实测经生产
 *   binder 注册后 canGank 仍为 false、permissions 为空。连续效果原语本身
 *   （effects/instructions/continuous.movement.ts）会把 permission 规范化为
 *   routes，实测该形状可被 Standard Move 的可选 rules 桥消费，所以缺口在生产
 *   static 注册的许可形状适配，不在移动消费方。
 * 依赖：生产激活费用选择接线、Ganking permission.routes 形状适配。
 * 不把临时 Might 落到 effect.buff 上近似。sourceText 与 canonicalCardId 不改。
 */
const viDestructive = {
  canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处生产接线缺口（复核 2026-10-17，均以合入源码实测）：" +
    "(1)「Recycle 1 from your trash」的费用形状可由 buildCostPlan/payCostPlan 收取（golden 以运行期选项支付），" +
    "但静态 IR 只能写选择占位符（cost/plan-values.ts 的 choiceObjects 要求每个 option 是精确 ObjectRef）：" +
    "实测把本卡 cost 交给生产链，describeActivate 产出 payments[0].choice.options=[\"card-in-controller-trash\"]，" +
    "Finalize 的 buildCostPlan 抛 CostPlanError(\"Cost requires an exact object reference\"/invalid-cost-plan)，" +
    "生产激活 Finalize 尚未把 Trash 选择绑定到真实 pick/choice（417.3/417.6）。" +
    "(2) [Ganking] 的 continuous.movement 展开经生产 static binder 注册后 permission 仍是字符串 \"battlefield-to-battlefield\"，" +
    "而 layers/rules/query.ts 的 movement() 读 permission.routes 数组；实测注册后 canGank=false、permissions=[]；" +
    "continuous.movement 原语本身会规范化成 routes（实测可被 Standard Move 的可选 rules 桥消费），" +
    "所以缺口在 static 注册的许可形状适配（810.1.b/810.1.c、144.4.c），不在移动消费方。" +
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
            // 417.6 的"从区域按筛选选择"在静态 IR 里只能写成占位符：选项是
            // 控制者 Trash 中的真实牌，只能在 Finalize 时确定（见 judgeReason）。
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

