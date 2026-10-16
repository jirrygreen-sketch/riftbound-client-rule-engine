import type { CardProgram } from "../../ir/index.js";

/**
 * Feral Strength — sfd-034-221 (Spell, 2 energy, power null, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-034-221, verbatim):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit +2 :rb_might: this turn.
 *
 * Catalog evidence: energy 2, power null (no printed power value, never
 * rewritten to 0), might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword: 813.1.b grants every Action
 *   permission, 813.1.c adds Closed State play on any player's turn, and
 *   813.3 records that the keyword changes no instruction's function. The card
 *   only declares { kind: "keyword", keyword: "reaction" }; the expansion into
 *   continuous.timing belongs to effects/keywords/Reaction.ts (contract 3.7)
 *   and admission is the chain's canAct check (contract 3.5).
 * - [Repeat] (820) is an Optional Additional Cost keyword present on Spells
 *   (820.1.a). Its printed cost is 2 Energy (820.1.c, 820.1.c.1), it may be
 *   paid once for one additional execution (820.1.d, 820.1.c.3), and choices
 *   are re-made for the extra execution (820.2). The printed additional cost
 *   is declared on the play ability in the CostSpec vocabulary the merged
 *   cost planner consumes (cost/plan-values.ts: kind/payments/energy/power/
 *   choice) with an explicit pay/decline decision; the keyword expansion
 *   itself is owned by effects/keywords/Repeat.ts.
 * - "Give a unit +2 :rb_might: this turn": the unit is a target (355.7,
 *   355.9.a.1). The clause modifies Effective Might (143.2.a) until the
 *   end-of-turn cleanup expires every "this turn" effect simultaneously
 *   (317.2.c). effect.buff's own header states that temporary Might changes
 *   belong to the layers continuous.might path and never to Buff counters
 *   (702/703 remove/add counters), and no merged instruction registers such an
 *   effect through ResolveContext.addContinuous: RIFT-91 merged the layers
 *   evaluation side, but the card-facing continuous.might opcode is absent.
 *
 * Status: judge-required. Two dependencies are unmerged and not approximated
 * (no Buff-counter substitution, no unconditional Might rewrite):
 * - card-facing continuous.might / effect.might-modify with an end-of-turn
 *   duration (143.2.a, 317.2.c; RIFT-91 follow-up for the instruction op);
 * - Finalize collecting the optional [Repeat] additional cost from the card
 *   program and exposing the paid instance count to the interpreter's repeat
 *   node (820.1.c.1, 820.1.d.1; RIFT-89, plus the wiring noted in
 *   effects/keywords/Repeat.ts).
 */
const feralStrength = {
  canonicalCardId: "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give a unit +2 :rb_might: this turn」是临时 Might 修正——" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effect.buff 文档明确临时 Might 归 layers 的 continuous.might" +
    "（702/703 的 Buff 计数不是 Might 修改），而 effects/instructions 下没有任何原语通过 ResolveContext.addContinuous 注册该效果；" +
    "RIFT-91 只合入 layers 求值侧，卡牌侧的 continuous.might 指令 op 仍缺失，" +
    "143.2.a 的 Effective Might 与 317.2.c 的本回合到期都需要该路径。" +
    "(2)「[Repeat] :rb_energy_2:」的附加费用已按 CostSpec 声明（kind additional、payments、可选支付 choice），" +
    "但 Finalize 从卡牌程序收集可选附加费用（820.1.c.1/820.1.d.1）并把已支付实例数接到解释器 repeat 节点的接线未合入" +
    "（RIFT-89；effects/keywords/Repeat.ts 头部同款说明）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷基础费用（2 energy、无 power）由 catalog 在 Finalize 绑定；此处 cost
      // 只声明 [Repeat] 的可选附加费用（820.1.c.1）。
      cost: {
        kind: "additional",
        keyword: "repeat",
        optional: true,
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "feral-strength.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Give a unit +2 Might this turn" — layers continuous.might 形状；
          // 卡牌侧指令 op 尚未注册（见 judgeReason）。
          id: "feral-strength.give-plus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "feral-strength.unit",
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
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit +2 :rb_might: this turn."
} satisfies CardProgram;

export default feralStrength;
