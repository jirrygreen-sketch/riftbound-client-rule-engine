/**
 * Heart of Dark Ice （sfd-052-221）— Gear，3 energy、power 1（Calm），Might null，Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-052-221）：
 *   ":rb_exhaust:: Give a unit +3 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 151 / 151.2：“:” 之前是费用、之后是效果，Gear 的启动式能力默认在控制者 Main Phase 的
 *   Open State 执行（151.2.a：与打出一张牌同一流程）。费用是横置自身（415.3.a / 415.5，
 *   属 cost.exhaust 与费用计划）。
 * - “Give a unit +3 :rb_might: this turn.” 选中一个单位（355.7/355.10：玩家选择一个单位，
 *   是 Target），在本次结算中给该单位 +3 Might，直到本回合结束（143.2 的临时修改、475/478
 *   的期限与算术层）。这是临时 Might 修改，契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *   动作；effect.buff 的文件头明确临时 Might 归 layers 的 continuous.might，Buff 计数器
 *   （702/703）不是 Might 修改，不能互相替代。
 *
 * status = judge-required（缺临时 Might 修改的可执行路径，不近似实现）：
 * - effects/instructions/ 下没有 continuous.might（或等价 may-modify）原语，也没有任何
 *   指令通过 ResolveContext.addContinuous 注册该效果（RIFT-91 只合入了 layers 求值侧）；
 *   golden 实测 runAbilityBody 对 continuous.might 抛 “Unregistered instruction opcode”。
 * - 横置费用本身可用已合入的费用管线真实执行（golden 覆盖），但整卡不可执行。
 * - 依赖：continuous.might 指令原语 / layers 指令接线（RIFT-91 后续），或等价契约变更。
 */
export default {
  canonicalCardId: "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effect.buff 文档明确" +
    "临时 Might 归 layers 的 continuous.might（RIFT-91 只合入求值侧，没有指令入口），effects/instructions/ " +
    "下没有原语通过 ResolveContext.addContinuous 注册该持续效果 —— golden 实测 runAbilityBody 对 " +
    "continuous.might 抛 \"Unregistered instruction opcode\"。不近似实现（不用 Buff 计数顶替 +3 Might，" +
    "也不改写印刷费用数值）。已可真实执行的部分：横置自身的启动费用（415.3.a/415.5，cost/plan-values.ts），" +
    "golden 覆盖费用支付与单位目标失效分支。依赖：RIFT-91 后续的 continuous.might 指令原语/接线。",
  abilities: [
    {
      kind: "activated",
      // “:rb_exhaust::” — 横置自身作为启动费用（415.3.a、415.5）。
      cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
      timing: "action",
      body: [
        {
          // “Give a unit +3 :rb_might: this turn.” — 临时 Might 修改（143.2/475/478）；
          // 没有已合入的原语消费该形状（见 judgeReason）。
          id: "heart-of-dark-ice.give-plus-3-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "heart-of-dark-ice.unit",
              // 355.7/355.10：“a unit” 是玩家选择一个单位的目标（不限控制者）。
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: ":rb_exhaust:: Give a unit +3 :rb_might: this turn."
} as const;
