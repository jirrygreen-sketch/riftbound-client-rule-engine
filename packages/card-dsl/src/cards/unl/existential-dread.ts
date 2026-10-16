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
 *   `ObjectSnapshot.combatRole`, which is not merged into effects/contract.ts or
 *   into any filter vocabulary), so the filter carries the contract's field name
 *   as an unevaluated, descriptive key — unchanged, the filter would stun any
 *   enemy unit.
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
 * status = judge-required (README section 2): the "attacking" restriction has
 * no evaluable predicate, and the printed [Repeat] additional cost has no
 * payment/count wiring. Neither is approximated: the filter does not silently
 * accept every enemy unit, and the body is not repeated with a fabricated count.
 *
 * Dependencies: the Attacker/Defender designation (contract 3.8 item 1's
 * `combatRole`) in ObjectSnapshot and the filter vocabulary, plus RIFT-86 / 
 * RIFT-89 for the Repeat additional-cost payment and its paid-instance count.
 */
export default {
  canonicalCardId:
    "card.hash-2ac2d6f3f32c301570d1dfe70ea13dd6550a4c9e791dee4da9ddfc79cc63a87c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「an attacking enemy unit」的 attacking 是 Attacker designation（459 / 807）：" +
    "契约 3.8 第 1 条要求 ObjectSnapshot 增加 combatRole（attacker/defender/null），但该字段尚未合入 effects/contract.ts，" +
    "任何过滤器词表也不识别它（ogn/cannon-barrage、ogn/clearing 记录了同一缺口），所以本文件的 filter 只保留描述性键 " +
    "combatRole: \"attacker\"（无消费者）——删掉它会把「任意敌方单位」写成事实。" +
    "(2) 印刷的 [Repeat] :rb_energy_2: 是可选追加费用（820.1 / 820.1.c / 355.1.a / 356.2.b.1），" +
    "已合入的 effects/keywords/Repeat.ts 自己的文件头说明其费用收取与「已支付实例数」到结算端的交接尚未接线" +
    "（cost.additional / cost.pay 属 RIFT-89；sfd/danger-zone、sfd/frigid-touch 记录同一缺口），" +
    "本卡在 play.cost 里按已合入的 frigid-touch 形状声明该可选费用（带 pay/decline 选择）与印刷基础费用（1 能量 + 1 Chaos 力量），" +
    "但不用固定次数的 repeat 控制指令伪造「额外执行一次」。" +
    "依赖：契约 3.8 combatRole 落地与图层/过滤器支持（RIFT-91 图层消费），以及 RIFT-86 / RIFT-89（Repeat 附加费用与已付实例计数）。" +
    "已合入并由 golden 真实执行的部分：两条互斥分支（effect.stun / effect.zone → hand，424.1 / 424.1.a / 056.1）；" +
    "[Action] 关键词声明（806）。另注：engine-core 的 chain 适配器（chain/interpreter-adapter.ts 的 LITERAL_FIELDS）" +
    "尚未登记 effect.stun 的 target，生产链路上仍需引擎侧补登记（ogn/solari-chief 记录了同一缺口）。",
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
