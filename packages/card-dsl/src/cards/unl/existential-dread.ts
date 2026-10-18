import type { CardProgram } from "../../ir/index.js";

/**
 * Existential Dread (unl-134-219) — Spell, 1 energy + 1 power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-134-219, verbatim):
 *   "[Action] (Play on your turn or in showdowns.)
 *    [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    [Stun] an attacking enemy unit. If it's already stunned, return it to its
 *    owner's hand instead. (A stunned unit doesn't deal combat damage this
 *    turn.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - [Action] (806) is a permissive keyword: 806.1.b grants the corresponding
 *   card the Showdown permission and 806.2 keeps its other timings. The
 *   expansion lives in effects/keywords/Action.ts (contract 3.7) and admission
 *   is chain-owned (contract 3.5); the card only declares the keyword.
 * - [Repeat] :rb_energy_2: (820.1 / 820.1.c) is an Optional Additional Cost: the
 *   printed cost belongs to the card (820.1.c) and the payment is decided in the
 *   play procedure (355.1.a / 356.2.b.1). It is declared on the play ability's
 *   CostSpec with an explicit pay/decline choice, following the merged
 *   sfd/frigid-touch declaration, and the printed base cost (1 Energy + 1 Chaos
 *   power, from the catalog) stays on the same CostSpec. The Repeat KeywordDef
 *   (effects/keywords/Repeat.ts) documents that its cost payment and the"paid
 *   instance count" hand-off are not wired into Finalize/resolution yet, so the
 *   printed repeat cannot execute (see judgeReason).
 * - "[Stun] an attacking enemy unit": [Stun] is the merged effect.stun
 *   primitive (424.1 / 424.1.a: Stunned is a binary state; 424.1.a.1: an already
 *   Stunned unit cannot be Stunned again). The unit is chosen specifically and
 *   sits on the Board, so it is a target (355.7 / 355.9.a.1 / 355.9.b).
 *   "attacking" is the Attacker designation (459 / 807; contract 3.8 item 1 adds
 *   `ObjectSnapshot.combatRole`. The field exists on the snapshot, but
 *   programs/filters.ts does not accept a top-level combatRole key), so the
 *   filter carries the contract's field name as an unevaluated, descriptive key
 *   — removing it would silently turn the card into "stun any enemy unit".
 * - "If it's already stunned, return it to its owner's hand instead" branches on
 *   the chosen unit's current stunned state (424.1.a) and is written as two
 *   mutually exclusive instructions reading that state with an object-property
 *   condition, the shape the merged ogn/solari-chief uses for the same wording
 *   pattern. "Return it to its owner's hand" is the merged effect.zone
 *   destination "hand" (return-to-hand; 056.1 routes it to the card's owner).
 * - The instructions are not `linkedTo` each other: the second branch reads the
 *   shared target's state rather than the first instruction's result, and the
 *   two conditions are mutually exclusive.
 *
 * status = judge-required (README section 2), re-measured 2026-10-18: the
 * "attacking" restriction has no evaluable predicate, and the printed [Repeat]
 * additional cost has no payment/count wiring. Neither is approximated: the
 * filter does not silently accept every enemy unit, and the body is not repeated
 * with a fabricated count.
 * - probing programs/filters.ts confirms `combatRole` is still rejected as an
 *   unsupported filter field (characteristics.combatRole *is* translated, and
 *   layers/filter.ts evaluates it, but chain/interpreter-adapter's literal-field
 *   table and the play/finalize target path are the pieces the card needs).
 * - probing programs/play.ts translateCost confirms the cost is returned as
 *   `kind: "explicit"` with the repeat payment still carrying its `keyword`
 *   field, and cost/plan-values.ts then rejects it: "Unsupported payment field:
 *   keyword". cost-plan.ts does support kind:"repeat" through optionalAdditional,
 *   but nothing in the play path turns the declared payment into that channel.
 * - probing chain/interpreter-adapter.ts: effect.stun's `target` is not in
 *   LITERAL_FIELDS, so the card's own Expr-wrapped target id fails schema parsing
 *   ("effect.stun target must be a spec id string") and the chain path reports
 *   ignored/mistargeted instead of stunning.
 *
 * Dependencies: the Attacker designation in the play/finalize target filter
 * path, the play-cost translation for Repeat's optional additional payment, and
 * the engine-side registry entry for effect.stun's literal target. The two
 * mutually exclusive branches and the [Action] declaration are merged and really
 * executed by the golden.
 */
export default {
  canonicalCardId:
    "card.hash-2ac2d6f3f32c301570d1dfe70ea13dd6550a4c9e791dee4da9ddfc79cc63a87c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现（2026-10-18 复核）：(1)「an attacking enemy unit」的 attacking 是 Attacker designation（459 / 807）：" +
    "ObjectSnapshot 已有 combatRole 字段，但 programs/filters.ts 的 filter 词汇仍不接受 combatRole，" +
    "所以本文件的 filter 只保留描述性键 combatRole: \"attacker\"（无消费者）——删掉它会把「任意敌方单位」写成事实。" +
    "(2) 印刷的 [Repeat] :rb_energy_2: 是可选追加费用（820.1 / 820.1.c / 355.1.a / 356.2.b.1），" +
    "programs/play.ts 的 translateCost 把本卡 cost 原样转成 explicit 并保留 payment 上的 keyword 字段，cost/plan-values.ts 随即抛 " +
    "\"Unsupported payment field: keyword\"；cost-plan.ts 的 optionalAdditional 通道本身支持 kind: \"repeat\"，" +
    "但 play 路径没有任何地方把本卡声明的 payment 转成该通道，paid-instance count 也未交给结算端，" +
    "本卡因此不写固定次数的 repeat 控制指令。(3) 链适配器未登记 effect.stun 的 literal target：" +
    "chain/interpreter-adapter.ts 的 LITERAL_FIELDS 没有 effect.stun，本卡 Expr 包裹的 target id 会被按 spec id 字符串重新校验并抛 " +
    "\"effect.stun target must be a spec id string\"，实测整条指令在链上记 ignored/mistargeted、并未 Stun。" +
    "依赖：play/finalize 目标路径的 combatRole 过滤支持、Repeat 附加费用与已付实例计数的 play/resolve 接线、" +
    "以及 effect.stun literal target 的引擎侧登记。" +
    "已合入并由 golden 真实执行的部分：两条互斥分支（effect.stun / effect.zone → hand，424.1 / 424.1.a / 056.1）；[Action] 关键词声明（806）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用：1 Energy + 1 Chaos power（目录精确值；206 / 204.1）。
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 },
        // [Repeat] :rb_energy_2: 的可选追加费用（820.1.c；355.1.a / 356.2.b.1）：
        // 形状照已合入的 sfd/frigid-touch（带 pay/decline 选择）。
        payments: [
          {
            kind: "energy",
            keyword: "repeat",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "existential-dread.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "existential-dread.stun-attacker",
          op: "effect.stun",
          args: {
            target: {
              kind: "constant",
              value: "existential-dread.attacking-enemy-unit"
            }
          },
          targets: [
            {
              id: "existential-dread.attacking-enemy-unit",
              // combatRole 是契约 3.8 第 1 条的字段名，尚无消费者（见 judgeReason）。
              filter: {
                type: "unit",
                controller: "opponent",
                zone: "board",
                combatRole: "attacker"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // 「If it's already stunned, ... instead」：未 Stunned 时才执行 Stun
          // （424.1.a.1；ogn/solari-chief 的同一互斥分支形状）。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "existential-dread.attacking-enemy-unit" },
              property: "stunned"
            },
            operator: "eq",
            right: { kind: "constant", value: false }
          }
        },
        {
          id: "existential-dread.return-if-stunned",
          op: "effect.zone",
          args: {
            target: {
              kind: "constant",
              value: "existential-dread.attacking-enemy-unit"
            },
            // 「to its owner's hand」：return-to-hand 由动作层路由到拥有者手牌（056.1）。
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "existential-dread.attacking-enemy-unit",
              filter: {
                type: "unit",
                controller: "opponent",
                zone: "board",
                combatRole: "attacker"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // 已 Stunned 时才送回拥有者手牌（与上一条互斥）。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "existential-dread.attacking-enemy-unit" },
              property: "stunned"
            },
            operator: "eq",
            right: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead. " +
    "(A stunned unit doesn't deal combat damage this turn.)"
} satisfies CardProgram;
