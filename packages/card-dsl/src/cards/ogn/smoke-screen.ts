import type { CardProgram } from "../../ir/index.js";

/**
 * Smoke Screen (ogn-093-298) — Spell, 2 energy + 1 power, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-093-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; the permission
 *   (813.1.b/813.1.c: any player's turn, Closed States, plus every Action
 *   timing) is expanded by effects/keywords/Reaction.ts and enforced by the
 *   chain's own timing check (contract 3.5 / 3.7).
 * - "a unit" is a target: the named Board unit is in a public zone (355.7 /
 *   355.9.a.1 / 355.10).
 * - "-4 Might this turn, to a minimum of 1 Might" is an arithmetic-layer Might
 *   modification with a per-turn duration (143.2.a: "Might" means Effective
 *   Might; 475/478 layers) whose result is clamped at 1. The clamp is the
 *   printed minimum, not the general 143.2.c "less than 0 is treated as 0"
 *   rule, so it has to be carried as the modification's own floor rather than
 *   inferred from the layer arithmetic.
 *
 * Status: judge-required. The debuff is faithfully described below but has no
 * merged producer: contract 3.6's closed GameAction set has no
 * Might-modification action, no file under effects/instructions/ registers a
 * Might modification through ResolveContext.addContinuous (the layers engine
 * merged with RIFT-91 supplies only the evaluation side, and its arithmetic
 * pass floors at 0 rather than the printed 1), and the object-property /
 * condition vocabulary cannot read a "minimum" characteristic. Marking the
 * card executable would either drop the printed minimum or claim a clamped
 * amount the engine never computes. Not approximated with a Buff counter
 * (CR 702: a Buff is a counter, not a Might modification).
 */
const smokeScreen = {
  canonicalCardId: "card.hash-e97af51e4273d0e357336eeb9843588d53ddb174bbf2fe8c0ce001f8f5cc3674",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语与印刷下限：「Give a unit -4 :rb_might: this turn, to a minimum of 1 " +
    ":rb_might:」需要在 arithmetic 层施加带回合期限的 Might 减量（143.2.a/475/478），并按印刷文本钳制到至少 1；" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下也没有任何原语通过 " +
    "ResolveContext.addContinuous 注册该持续效果（RIFT-91 只合入了 layers 求值侧，且其算术 pass 的下限是 0，" +
    "并非本卡的印刷下限 1）；object-property / condition 词汇也无法读取“minimum”这一特征。" +
    "依赖：continuous.might 指令原语与带下限的减量支持（RIFT-9 清单 / RIFT-91 后续）。" +
    "不近似实现：不写成 Buff 计数（702），也不省略 1 的下限。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "smoke-screen.debuff",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -4 },
            duration: { kind: "constant", value: "this-turn" },
            // The printed clamp. The pending arithmetic-layer producer must
            // apply it instead of the layer engine's generic 0 floor.
            minimum: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "smoke-screen.unit",
              filter: { type: "unit" },
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
    "Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default smokeScreen;

