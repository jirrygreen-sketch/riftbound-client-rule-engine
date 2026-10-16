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
 *   许可；展开由 effects/keywords/Ganking.ts（RIFT-83）提供，移动系统读取
 *   continuous.movement 许可（RIFT-91 图层）。卡只声明 keyword。
 * - "Recycle 1 from your trash: Give me +1 :rb_might: this turn." 是
 *   **激活能力**：冒号前是费用、冒号后是效果（CR 358："[Cost]: [Effect]"；
 *   费用中的 recycle 见 417.3）。Timing：文本没有任何 Action/Reaction 许可，
 *   按单位激活能力的默认时机为 action 速度（159.2；Polite/Reaction 只来自
 *   [Reaction] 关键词）。
 *   - 费用："Recycle 1 from your trash" 是费用中的回收（417.3），使用
 *     CostSpec.payments 的 recycle 支付形状（cost 计划由 RIFT-89 的
 *     buildCostPlan/payCostPlan 消费；选项是控制者 Trash 中的牌）。
 *   - 效果："Give me +1 :rb_might: this turn" 是本回合到期的临时 Might 修正，
 *     属于 continuous.might（effect.buff 只处理 Buff 计数器，不得代用）。
 *
 * status：judge-required。缺："Give me +1 :rb_might: this turn" 的
 * end-of-turn continuous.might 持续效果（图层消费方未合并）；"Recycle X from your
 * trash" 在费用里的对象选择也需要费用管线把 Trash 选择接到 pick/choice（cost 计划
 * 形状已合入，但生产接线未完成）。依赖：RIFT-91（layers-continuous）、
 * RIFT-89（费用计划的 Trash 回收支付接线）。Ganking 关键词部分已可结构校验。
 * 不把临时 Might 落到 effect.buff 上近似。
 */
const viDestructive = {
  canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺本回合到期的临时 Might 修正（continuous.might 的 end-of-turn 持续效果，图层消费方未合并；" +
    "effect.buff 只处理 Buff 计数器，不得代用），以及费用内「Recycle 1 from your trash」的对象选择接线" +
    "（CostSpec.payments 的 recycle 形状已合入，但 buildCostPlan 的 Trash 选择在生产链路未接）。" +
    "依赖：RIFT-91（layers-continuous）、RIFT-89（费用计划与回收支付）。[Ganking] 关键词展开（RIFT-83）已合入。" +
    "不近似实现。",
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
            target: { kind: "constant", value: "self" }
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
