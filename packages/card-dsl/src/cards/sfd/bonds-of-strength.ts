import type { CardProgram } from "../../ir/index.js";

/**
 * Bonds of Strength (sfd-151-221) — Spell, 2 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-151-221, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Give two friendly units each +1 :rb_might: this turn."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Reaction]" (813.1.b/813.1.c) is declared only; the registry expands the
 *   permission (contract 3.7) and the chain decides admission.
 * - "[Repeat] :rb_energy_2:" (820.1.c) is an Optional Additional Cost declared
 *   in the merged sfd/frigid-touch / sfd/danger-zone shape (356.2.b.1) with no
 *   merged collector (RIFT-86/RIFT-89).
 * - "two friendly units" is one target group of exactly two units the controller
 *   controls (355.9.b's "unit you control"): the printed count is fixed, so
 *   min 2 / max 2 rather than "up to" (355.13 would allow zero), and Finalize
 *   rejects the play when fewer than two friendly units exist (355.8). The
 *   shape and the bounds are identical to the merged ogn/back-to-back.
 * - "each +1 :rb_might: this turn" is a temporary Might modification that
 *   expires in the end-of-turn cleanup (317.2.c; 143.2.a's Effective Might is
 *   what card text reads). It belongs to the layers system: effect.buff's own
 *   header states temporary Might changes "belong to continuous.might, never to
 *   this primitive", and 703 makes a Buff counter a distinct object rather than
 *   a Might value change, so no Buff substitution is authored. A card-facing
 *   continuous.might instruction that calls ctx.addContinuous with an
 *   end-of-turn duration is still missing (RIFT-91 merged the consumer side).
 * - The two clauses are separate sentences: the Might grant and the [Repeat]
 *   collection are independent, so no instruction is linked to the other.
 *
 * Status (cards/README.md §2): judge-required — both gaps are named and neither
 * is approximated. Identity, keywords, printed cost, the fixed two-unit target
 * group and its bounds are covered by the golden test (the merged target system
 * enforces the 2/2 bounds: fewer than two friendly units cannot finalize).
 */
const bondsOfStrength = {
  canonicalCardId: "card.hash-13ba5efe94e7668b6570b551c230fecd5395f082448d8a86f0ba8b2f23b78626",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give two friendly units each +1 :rb_might: this turn」是带 end-of-turn 期限的临时 Might 修正" +
    "（CR 143.2.a 读 Effective Might；317.2.c 规定所有 this turn 效果在清理中同时到期），属 layers 的 continuous.might；" +
    "effects/instructions/ 下没有任何已注册 op 把卡指令转成带该期限的 ctx.addContinuous 调用（RIFT-91 只合入求值侧，缺卡牌侧入口），" +
    "effect.buff 明确临时 Might 不入 Buff 计数器（703），故不近似实现。" +
    "(2)「[Repeat] :rb_energy_2:」的可选追加费用没有收取/计数路径（Repeat 关键词展开 RIFT-86 / 费用计划 RIFT-89；" +
    "冻结的 KeywordAbility IR 不承载印刷费用），已按已合入 sfd/frigid-touch 的形状声明在 play 的 CostSpec 上，属待接线声明。" +
    "「two friendly units」的固定 2/2 目标组（355.9.b，与已合入 ogn/back-to-back 同形）已由 golden 通过合并目标系统真实断言（不足两个友方单位时 Finalize 拒绝，355.8）。" +
    "依赖：continuous.might 指令原语 + continuous.duration（RIFT-91）、RIFT-86 / RIFT-89。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy、无 Power（356.1.c 由卡牌身份在 Finalize 绑定）；
        // 这里只声明 [Repeat] :rb_energy_2:（820.1.c）的可选追加费用（无消费方，见 judgeReason）。
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 2 }
      },
      body: [
        {
          // 「Give two friendly units each +1 Might this turn」：待接线的 layers 指令
          // （continuous.might + this-turn 期限；无消费方，见 judgeReason）。
          id: "bonds-of-strength.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "bonds-of-strength.units" }
          },
          targets: [
            {
              id: "bonds-of-strength.units",
              // 固定两个由本能力控制者控制的单位（355.9.b）；不是 up to（355.13）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give two friendly units each +1 :rb_might: this turn."
} satisfies CardProgram;

export default bondsOfStrength;
