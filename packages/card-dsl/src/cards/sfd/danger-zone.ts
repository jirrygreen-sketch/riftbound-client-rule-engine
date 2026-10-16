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
 * Status: judge-required — two gaps, neither approximated:
 * - the team buff is a temporary might modification; contract 3.6's closed
 *   GameAction set has no might-modification action, and effect.buff
 *   explicitly leaves temporary Might changes to a layers/ "continuous.might"
 *   effect that the not-yet-implemented layers system (RIFT-83/84) would
 *   consume;
 * - the [Repeat] keyword has no merged KeywordDef (RIFT-86 added only the
 *   effect.repeat instruction primitive), and its additional-cost permission
 *   rewrite (v1.5 820) is not wired; the additional cost (1 energy + 1
 *   rainbow rune) is declared on the play ability as an additionalCost
 *   CostSpec so the intent is reviewable, pending the Repeat KeywordDef /
 *   cost plumbing (RIFT-86).
 *
 * "Your Mechs" is an each-set, not a target (v1.5 355.7: "each" is not
 * targeted), so the body instruction carries no TargetSpec.
 */
const dangerZone = {
  canonicalCardId: "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合无 might 修改动作，" +
    "effect.buff 文档明确临时 Might 归 layers 的 continuous.might（图层系统未实现，依赖 RIFT-83/84）；" +
    "Repeat 关键词无已合入 KeywordDef（RIFT-86 仅合入 effect.repeat 原语），820 追加费用的支付许可改写未接好；" +
    "追加费用（1 能量 + 1 彩虹符文）已按契约 3.1 声明为 play 的 additionalCost，待 Repeat 关键词与费用管线接管；不近似实现。",
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
          // described via the layers contract shape, pending the might
          // primitive / layers system (see judgeReason).
          id: "buff-mechs",
          op: "effect.might-modify",
          args: {
            amount: { kind: "literal", value: 1 },
            duration: { kind: "literal", value: "this-turn" },
            appliesTo: { kind: "literal", value: { type: "unit", tag: "Mech", controller: "you" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dangerZone;
