import type { CardProgram } from "../../ir/index.js";

/**
 * Ntofo Strikes (rad-148-167) — Spell, 2 Energy + 1 Power, Calm/Body,
 * tags K'Sante / Signature.
 *
 * Printed text (verbatim, deck-catalog rad-148-167):
 *   "[Action] (Play on your turn or in showdowns.)
 *    Give a friendly unit [Shield 2] this turn, then deal damage equal to its
 *    [Shield] to an enemy unit. (A unit with Shield has +1 :rb_might: for each
 *    instance of Shield while it's a defender.)"
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the play permission itself
 *   is expanded by the keyword registry (effects/keywords/Action.ts).
 * - "Give a friendly unit [Shield 2] this turn" grants the Shield keyword
 *   (801.3.a; 814.1.b.2 defines the Shield Value as the X in "Shield [X]") to a
 *   chosen friendly unit until the end of the turn (801.3.a.2, 317.2.c). Both
 *   the chosen unit and the keyword grant belong to the layers ability pass —
 *   granting a keyword is a continuous effect, not a counter (801.3 vs 702).
 *   The merged `continuous.grant-keyword` primitive (RIFT-258) registers that
 *   ability-layer effect, and Shield's KeywordDef (RIFT-81) expands the granted
 *   keyword into "+2 Might while it's a defender" (814.1.c / 814.1.d.1).
 * - "then deal damage equal to its [Shield] to an enemy unit": the amount is
 *   the Shield Value of the friendly unit after the grant. Shield instances on
 *   one unit sum into a single Shield Value (814.2), so the amount is the
 *   unit's current Shield Value, not the printed 2 — and "then" makes this
 *   instruction depend on the grant (359.3.e.14: a linked instruction that
 *   references the granted object).
 *
 * Status: judge-required. 2026-10-17 recheck: the keyword-grant half is now
 * merged and executable (`continuous.grant-keyword` + Shield KeywordDef), so
 * that gap is deleted. One gap remains, not approximated:
 * - no expression reads a keyword's value: ObjectSnapshot.keywords is a list of
 *   { id, value } entries (814.1.b.2 Shield Value, 814.2 summed instances) and
 *   the frozen Expr forms only read snapshot properties, so "damage equal to
 *   its [Shield]" has no expression form. The pending effect.shield-value op
 *   records the missing read.
 * The damage instruction's target structure (one enemy unit, 355.7) and its
 * linkage to the grant are expressed.
 */
export default {
  canonicalCardId: "card.hash-09ac8b0dded2de4aaec186e708da9025177f38cddcb872a26bfa49aa0a1f627f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核：授予半段已可执行（continuous.grant-keyword（RIFT-258）+ Shield KeywordDef），" +
    "不再列为缺口。当前只剩一处缺口，不近似实现：" +
    "「deal damage equal to its [Shield]」需要读取关键词数值：ObjectSnapshot.keywords 是 { id, value } 列表，" +
    "814.2 规定多个 Shield 实例相加成单一 Shield Value，而冻结的 Expr 形式只能读快照属性，没有读取关键词数值的表达式，" +
    "已在数据里记下待补的 effect.shield-value（registry 未注册该 op）。" +
    "依赖：读取关键词数值的表达式/原语（RIFT-81 Shield 关键词后续）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give a friendly unit [Shield 2] this turn" — duration-bounded
          // keyword grant (801.3.a / 814.1.b.2) through the merged
          // continuous.grant-keyword ability-layer registration.
          id: "ntofo-strikes.grant-shield",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Shield" },
            value: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "ntofo-strikes.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "deal damage equal to its [Shield]" — the Shield Value of the
          // granted unit after summing its Shield instances (814.1.b.2,
          // 814.2). No merged expression or op reads a keyword value; the
          // pending op records the missing read.
          id: "ntofo-strikes.shield-value",
          op: "effect.shield-value",
          linkedTo: "ntofo-strikes.grant-shield",
          args: {
            object: {
              kind: "constant",
              value: { target: "ntofo-strikes.friendly-unit" }
            },
            linkKey: { kind: "constant", value: "shieldValue" }
          }
        },
        {
          id: "ntofo-strikes.deal-shield",
          op: "effect.damage",
          linkedTo: "ntofo-strikes.shield-value",
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "ntofo-strikes.shield-value",
              key: "shieldValue"
            },
            target: { kind: "constant", value: "ntofo-strikes.enemy-unit" }
          },
          targets: [
            {
              id: "ntofo-strikes.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a friendly unit [Shield 2] this turn, then deal damage equal to its [Shield] to an enemy unit. " +
    "(A unit with Shield has +1 :rb_might: for each instance of Shield while it's a defender.)"
} satisfies CardProgram;
