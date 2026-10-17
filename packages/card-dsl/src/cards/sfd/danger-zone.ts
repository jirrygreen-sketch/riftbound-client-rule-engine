import type { CardProgram } from "../../ir/index.js";


/**
 * Danger Zone (sfd-182-221) — Spell, 1 energy + 1 rainbow power, Rumble
 * signature (Fury/Mind).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost
 *   to repeat this spell's effect.)
 *   Give your Mechs +1 :rb_might: this turn.
 *
 * Status: judge-required — one gap, not approximated:
 * - the [Repeat] KeywordDef landed with RIFT-86, but its additional-cost
 *   collection still has no consumer: the Finalize cost plan never reads the
 *   declared Repeat cost (no accelerate.cost / repeat.cost consumer, no
 *   cost.pay / cost.additional primitive is registered — RIFT-261 cost
 *   ops are not merged) and the paid-repeat count is not wired to the
 *   interpreter's repeat node in the play pipeline (RIFT-257 binding). The
 *   additional cost (1 energy + 1 rainbow rune) stays declared on the play
 *   ability as an additionalCost CostSpec so the intent is reviewable.
 * - The team buff itself is now executable: the merged continuous.might
 *   primitive (RIFT-258) registers the arithmetic-layer modification over the
 *   programmatic "your Mechs" set through ctx.addContinuous with the
 *   end-of-turn duration (317.1.a / 468.7.c), and the golden test drives the
 *   card's own body through the production chain adapter.
 *
 * "Your Mechs" is an each-set, not a target (v1.5 355.7: "each" is not
 * targeted), so the body instruction carries no TargetSpec.
 */
const dangerZone = {
  canonicalCardId: "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Repeat] 追加费用仍无可执行收取路径：Repeat KeywordDef 已随 RIFT-86 合入（effects/keywords/Repeat.ts 输出 repeat.cost 静态能力），" +
    "但没有消费方把打出的 Repeat 费用接进 Finalize 费用计划（repeat.cost/accelerate.cost 无消费者，effects/instructions/ 也没有已注册的 " +
    "cost.pay / cost.additional 原语——RIFT-261 的费用指令批次未合入），已付费 Repeat 实例数与解释器 repeat 节点的接线同样缺失" +
    "（卡牌程序绑定 RIFT-257）。追加费用（1 能量 + 1 彩虹符文，820.1.c.1）已按契约 3.1 声明为 play 的 additionalCost，属待接线声明，不写死第二次结算、不近似实现。" +
    "「Give your Mechs +1 :rb_might: this turn」半段已可执行：continuous.might 原语（RIFT-258）对 355.10.d 的程序化集合注册 arithmetic 层修正并在回合末到期，golden 已用生产链适配器真实执行。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give your Mechs +1 :rb_might: this turn.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // [Repeat] 1 energy + 1 rainbow rune: declared as an additional cost
      // (contract 3.1 CostSpec); the Repeat KeywordDef that lets the player
      // actually pay it to repeat the effect is not merged yet.
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 1 },
        power: { kind: "literal", value: ["rainbow"] }
      },
      body: [
        {
          // "Give your Mechs +1 Might this turn" — each-set (no TargetSpec);
          // a duration-bounded Might modification over the programmatic set of
          // the controller's Mech units, registered by the merged
          // continuous.might primitive (RIFT-258) and expiring at cleanup.
          id: "buff-mechs",
          op: "continuous.might",
          args: {
            objects: {
              kind: "literal",
              value: {
                kind: "query",
                filter: { type: "unit", tags: ["Mech"], controller: "self", zone: "board" }
              }
            },
            amount: { kind: "literal", value: 1 },
            duration: { kind: "literal", value: "this-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dangerZone;
