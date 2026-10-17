import type { CardProgram } from "../../ir/index.js";

/**
 * Call to Glory — ogn-207-298 (Spell, Order, 3 Energy, no Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-207-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As you play this, you may spend a buff as an additional cost. If you do,
 *   ignore this spell's cost.
 *   Give a unit +3 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Reaction]" (813) is declared as a keyword ability; the permission is
 *   expanded by the keyword registry (effects/keywords/Reaction.ts).
 * - "As you play this, you may spend a buff as an additional cost" is an
 *   Optional Additional Cost (356.2.b / 356.2.b.1) decided in step 2 (355.1.a)
 *   and paid in step 4 (357.2). 356.2.b.1 says such costs are "specified by
 *   Passive Abilities on the card being played", so it is declared as a static
 *   cost.additional ability — the same spelling sfd/frostcoat-cub uses for
 *   "You may pay ... as an additional cost to play me". 702.2.b removes one
 *   Buff counter from the chosen unit; 702.2.b.1 forbids spending from a unit
 *   without a buff and 702.2.b.2 restricts spending to units the paying player
 *   controls. The buff's unit is not targeted (355.10.c.1, 742.1), so the
 *   payment carries a non-target pick, not a TargetSpec.
 * - "If you do, ignore this spell's cost" is base-cost handling in step 3:
 *   356.1.b sets the appropriate Base Cost to zero, 356.1.b.1 keeps the
 *   optional additional cost itself payable, 356.1.b.3 keeps later additional
 *   costs and increases, and 357.2.a records that the paid cost still counts as
 *   paid. The rewrite is declared as a static cost modification gated on that
 *   payment, the same shape ogn/wallop declares for the same sentence.
 * - "Give a unit +3 :rb_might: this turn" is a temporary Might modification
 *   that expires in the end-of-turn cleanup (317.2.c "3d. All 'this turn'
 *   effects expire simultaneously."; 143.2.a / 433.1.a layer modulation). It
 *   belongs to the layers system and uses the merged continuous.might
 *   instruction (RIFT-258: signed amount, this-turn duration, end-of-turn
 *   expiry).
 *
 * Status: judge-required, re-audited 2026-10-17 (RIFT-683). The optional cost
 * and the conditional ignore-base rewrite have no merged consumer, so the card
 * cannot offer the printed choice; the printed decline branch (pay 3 Energy,
 * +3 Might) does have merged support and its execution evidence is in
 * test/cards/templates/keyword-play-continuous-might-683.test.mjs plus this
 * card's golden. judgeReason names the measured gaps; nothing is approximated.
 *
 * IR correction made in this audit: the play CostSpec used to be kind
 * "explicit" with the optional spend-buff payment declared inline. translateCost
 * passes an explicit CostSpec through, and cost/plan-values.ts then reads it as
 * a mandatory component of the base cost, so the declared string option set
 * reached reference() and threw "Cost requires an exact object reference" under
 * both the pay and the decline answer — a spelling that could never execute as
 * an optional cost. The declaration now uses the rule-accurate Passive Ability
 * spelling above, and the play CostSpec carries only the printed base cost.
 *
 * 契约变更请求: the frozen IR cannot give a declared cost pick an option set
 * that is computed at Finalize (702.2.b.2's "units you control that have a
 * buff"). PickSpec.options is static data and CostPlanInput's runtime ObjectRef
 * options cannot be written into static IR (cards/README.md §3), so a correct
 * declaration still cannot reach buildCostPlan's optionalAdditional without a
 * CardProgram-to-CostPlanInput adapter for optional additional costs (or an IR
 * spelling for a source-relative cost query).
 */
const callToGlory = {
  canonicalCardId: "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "剩余缺口是可选追加费用与条件 ignore-base 改写没有已合入消费方，因此整卡无法提供原文的选择；三点实测（CR 356.2.b/356.2.b.1、356.1.b/356.1.b.1/356.1.b.3、357.2.a、702.2.b.1/b.2）：" +
    "(1) 可选追加费用已按 356.2.b.1 写成 static cost.additional（非目标 pick），但 programs/statics.ts 的 layerFor 对该 effect kind 抛 no layer mapping" +
    "（实测），也没有 CardProgram → CostPlanInput.optionalAdditional 的适配器，打出阶段的费用计划读不到该声明；" +
    "(2) 356.1.b.1 的 ignore-base 改写同样只有静态声明（同一 layerFor 抛 no layer mapping），无法按 356.1.b.3 保留后续加费地施加；" +
    "(3) 费用选择的选项集需要 Finalize 期「本玩家控制且带有 buff 的单位」的运行时 ObjectRef（702.2.b.1/b.2），" +
    "静态 IR 只能声明字符串选项，缺契约变更请求里的适配器。" +
    "已用真实路径执行的部分：印刷基础费用（3 Energy、无 Power）经 Finalize 收取，目标在 Board 单位中锁定，+3 Might 由 continuous.might 注册 arithmetic 图层并在 317.2.c 回合末到期" +
    "——这是原文「不支付该可选费用」的分支，证据在 test/cards/templates/keyword-play-continuous-might-683.test.mjs 与本卡 golden（含目标失效 ignored 边界）；" +
    "可选 buff 支付的语义（702.2.b 扣 1 个 buff、702.2.b.1 无 buff 拒绝、357.2.a 记为已付）另有费用层真实 plan/回执证据，但尚未接进整卡打出路径。" +
    "不近似实现：不写免费打出、不把 Buff 换成 Might、不写固定费用计划。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      // 356.2.b.1：可选追加费用由本卡 Passive Ability 规定。702.2.b 的消耗对象
      // 不是目标（355.10.c.1、742.1），因此用非目标 pick；选项集在 Finalize 期
      // 按 702.2.b.2 求值，静态 IR 只描述该意图（见文件头契约变更请求）。
      kind: "static",
      effect: {
        kind: "cost.additional",
        id: "call-to-glory.spend-buff-payment",
        appliesTo: "self",
        optional: true,
        stage: "optional-additional",
        payments: [
          {
            kind: "spend-buff",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "call-to-glory.spend-buff-payment",
              options: ["buffed-unit-you-control"],
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      }
    },
    {
      // 356.1.b/356.1.b.1："If you do, ignore this spell's cost" 把本卡 Base Cost
      // 置零；356.1.b.3 保留后续追加费用与加费。条件是该可选费用确实被选择
      // （356.4.f.1），以具名支付决定为键；静态消费方仍缺（见 judgeReason 第 2 点）。
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        appliesTo: "self",
        resource: "resources",
        amount: { kind: "constant", value: "ignore-base" },
        when: {
          kind: "constant",
          value: { optionalCostPaid: "call-to-glory.spend-buff-payment" }
        }
      }
    },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷基础费用 3 Energy；power: null 表示无印刷 Power，不写成 0。
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Give a unit +3 Might this turn" — supported arithmetic-layer
          // instruction; the remaining gap is the optional cost above.
          id: "call-to-glory.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 3 },
            duration: { kind: "literal", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "call-to-glory.unit" }
            }
          },
          targets: [
            {
              id: "call-to-glory.unit",
              // 355.9.a.1: "a unit" means a unit on the Board.
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
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
    "Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;

export default callToGlory;
