import type { CardProgram } from "../../ir/index.js";

/**
 * Chronobreak — rad-140-167 (Spell, Fury/Mind, 2 Energy, Ekko / Signature).
 *
 * Printed text (verbatim, deck-catalog rad-140-167):
 *   "As an additional cost to play this, pay any amount of Power.
 *    Banish that many units you control, then for each, its owner plays that
 *    unit back to the same location or to their base, ignoring its cost.
 *    (You choose the order.)"
 *
 * Modeling notes (Core Rules v1.5):
 * - "As an additional cost to play this, pay any amount of Power" is a
 *   Mandatory Additional Cost (204.2, 204.2.a) whose amount the player chooses;
 *   "any amount" is a variable X (135.2.b.5). The cost is declared in the play
 *   ability's CostSpec so the intent is reviewable.
 * - "Banish that many units you control": Banish (428, 428.5 "Banish [one or
 *   more permanents or cards]") of units the ability controller controls, in an
 *   amount equal to the Power paid at Finalize. effect.banish accepts the
 *   amount as a linked value and restricts the set through an ObjectSelector, so
 *   this instruction's shape is expressible (and is executed in the golden
 *   test).
 * - "then for each, its owner plays that unit back to the same location or to
 *   their base, ignoring its cost": a Play via game effect (420.3 / 420.3.a) as
 *   a Limited Action with an ignored cost (356.1.b.1 sets the base Energy and
 *   Power costs to zero). "its owner plays" names a different chooser per unit,
 *   "the same location or to their base" is a per-unit destination choice made
 *   by that owner, and "(You choose the order.)" is a resolution-time order
 *   choice over the banished units.
 *
 * Status: judge-required. Re-checked against the merged surface (2026-10-18):
 * - a variable ("any amount") additional cost has no merged representation:
 *   cost/plan-types.ts models fixed CostAmount components plus discounts, and no
 *   API binds the paid X into the resolving instruction. The planner also cannot
 *   take a player-chosen amount from a payment expression: the amount is
 *   evaluated with ctx.evaluate and a numeric choice is not an Expr (measured:
 *   "Power must be a nonnegative safe integer");
 * - the banished units' original locations are not captured anywhere: banish
 *   moves the object to Banishment (428) and 124 makes it a new object, so "the
 *   same location" cannot be reconstructed after the move. The test kernel keeps
 *   a pre-Banish snapshot for the stale ref (`lastKnown(oldRef).location` is
 *   still the Battlefield), but the banish receipt publishes only post-move refs
 *   and the merged location selectors read the *current* location (measured:
 *   `{ kind: "location-selector", locationOf: { linked } }` throws "Object has
 *   no runtime location"), so no merged expression reaches that snapshot;
 * - "its owner plays ... or to their base" needs a per-object chooser (the
 *   owner, a runtime PlayerId) with a per-object destination choice; the merged
 *   effect.play accepts one player and one location for the whole selection. Its
 *   ignored-cost half is now expressible for a single object
 *   (`baseModifications: [{ kind: 'ignore-base', ignore: 'resources' }]`
 *   finalizes a 0/0 plan while still charging later additional costs, 356.1.b.1 /
 *   356.1.b.3), but the merged surface still has no per-object owner chooser and
 *   no effect.play-back producer/consumer for this handoff: `effect.play-back`
 *   is not a registered opcode.
 */
export default {
  canonicalCardId: "card.hash-2875b065844462e761acfeb152cf2feea180924a496740b05903caac24a3d795",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处未合入依赖（2026-10-18 实测）：(1)「pay any amount of Power」是可变数额的强制附加费用（204.2.a、135.2.b.5 的 X），" +
    "cost/plan-types.ts 只建模固定 CostAmount 组件与折扣，没有可变 X，也没有把已支付的 X 绑定给结算指令的接口" +
    "（实测：付款金额表达式的求值路径要求 Expr，玩家选择的数字不是 Expr，" +
    "抛 \"Power must be a nonnegative safe integer\"；费用计划当前没有可变 X 的绑定）；" +
    "(2)「its owner plays that unit back to the same location」需要记录被放逐单位放逐前的位置，" +
    "而 Banish 按 428 移到放逐区、按 124 产生新的对象身份；测试内核仍为旧 ref 保存 lastKnown 位置快照，" +
    "但 banish 回执只发布移动后的 ref，地点选择符读的是当前对象位置" +
    "（实测 { kind: \"location-selector\", locationOf: { linked } } 抛 \"Object has no runtime location\"），" +
    "合并词汇里没有表达式能读到该快照；" +
    "(3)「its owner plays … or to their base, ignoring its cost」需要逐对象的 owner 选择者与逐对象的目的地选择，" +
    "已合入的 effect.play 只接受单一 player 与单一 location；其 ignore-cost 一半现在可表达" +
    "（baseModifications 的 { kind: \"ignore-base\", ignore: \"resources\" } 实测产出 0/0 的已 Finalize 计划，" +
    "且仍会收取后续附加费用，356.1.b.1 / 356.1.b.3），但逐对象 owner 选择者与 effect.play-back " +
    "仍未注册（不在 opcode 表里）；" +
    "本卡所需的 effect.play-back 逐对象生产/消费路径尚不存在；已有地点选择与有序选择原语不能替代逐对象的回放生命周期。" +
    "Banish 指令本体（effect.banish，数额取自链接值）已在 golden 测试中真实执行。" +
    "不近似实现。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.additional",
        payments: [
          {
            kind: "power.any-amount"
          }
        ]
      },
      body: [
        {
          // "As an additional cost to play this, pay any amount of Power." The
          // chosen X must be readable by the following instructions; no merged
          // op or CostSpec field provides that binding (see judgeReason).
          id: "chronobreak.pay-power",
          op: "cost.pay-any-power",
          args: {
            linkKey: { kind: "constant", value: "paidPower" }
          }
        },
        {
          // "Banish that many units you control" — effect.banish with the paid
          // amount and a controller-scoped unit set.
          id: "chronobreak.banish",
          op: "effect.banish",
          args: {
            objects: { kind: "constant", value: { target: "chronobreak.controlled-units" } },
            amount: {
              kind: "linked-value",
              instructionId: "chronobreak.pay-power",
              key: "paidPower"
            },
            linkKey: { kind: "constant", value: "chronobreak.banished" }
          },
          targets: [
            {
              id: "chronobreak.controlled-units",
              filter: { type: "unit", controller: "self" },
              min: 0,
              max: null,
              selection: "up-to"
            }
          ]
        },
        {
          // "then for each, its owner plays that unit back to the same location
          // or to their base, ignoring its cost. (You choose the order.)" This
          // needs a per-object owner chooser, a per-object destination choice
          // and an ignore-cost play rewrite; no merged op consumes it (see
          // judgeReason).
          id: "chronobreak.play-back",
          op: "effect.play-back",
          linkedTo: "chronobreak.banish",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "chronobreak.banish",
              key: "chronobreak.banishedObjects"
            },
            chooser: { kind: "constant", value: "owner" },
            destinations: {
              kind: "constant",
              value: ["same-location", "owner-base"]
            },
            orderChooser: { kind: "constant", value: "controller" },
            ignoreCost: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "As an additional cost to play this, pay any amount of Power.\n" +
    "Banish that many units you control, then for each, its owner plays that unit back to the same location " +
    "or to their base, ignoring its cost. (You choose the order.)"
} satisfies CardProgram;
