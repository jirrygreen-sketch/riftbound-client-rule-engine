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
 * - the [Repeat] KeywordDef landed, but its additional cost cannot enter the
 *   play flow: programs/play.ts translateCost throws judgeRequired for
 *   kind "additional"/"additional-cost", the static repeat.cost has no
 *   layer/Finalize consumer, and the paid-repeat count is not wired to the
 *   interpreter's repeat node. The additional cost (1 energy + 1 rainbow
 *   rune) stays declared on the play ability as an additionalCost CostSpec
 *   so the intent is reviewable.
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
    "[Repeat] 追加费用仍无可执行收取路径：打卡的 play.cost kind additional-cost 在 programs/play.ts 的 translateCost " +
    "处直接 judgeRequired（\"Additional costs are not bound\"）；effects/keywords/Repeat.ts 输出的 repeat.cost 静态能力没有图层映射与 Finalize 消费方，" +
    "已付费 Repeat 实例数与解释器 repeat 节点也无接线。追加费用（1 能量 + 1 彩虹符文，820.1.c.1）已按契约 3.1 声明为 play 的 additionalCost，" +
    "属待接线声明，不写死第二次结算、不近似实现。" +
    "「Give your Mechs +1 :rb_might: this turn」半段已可执行：continuous.might 原语对 355.10.d 的程序化集合注册 arithmetic 层修正并在回合末到期，golden 已用生产链适配器真实执行。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give your Mechs +1 :rb_might: this turn.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
    // [Repeat] 1 energy + 1 rainbow rune: declared as an additional cost
    // (contract 3.1 CostSpec); the play flow's translateCost and the cost
    // plan do not consume this additional-cost kind yet.
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
