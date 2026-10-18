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
 * Status: judge-required. 2026-10-18 fourth recheck: the keyword-grant half is
 * merged and executable (`continuous.grant-keyword`), and two gaps remain, not
 * approximated:
 * - no expression reads a keyword's value: ObjectSnapshot.keywords is a list of
 *   { id, value } entries (814.1.b.2 Shield Value, 814.2 summed instances) and
 *   the frozen Expr forms only read snapshot properties, so "damage equal to
 *   its [Shield]" has no expression form. Measured: reading
 *   object-property(self, "shield") throws MissingInformation (no such
 *   characteristic) and reading `keywords` yields the list, which
 *   effect.damage needs as a number. The pending effect.shield-value op is
 *   still unregistered (45 registered ops, none is it).
 * - the granted Shield's functional text is not consumed on the production
 *   path: the default LayerEngine performs no KeywordDef expansion, so the
 *   granted Shield never becomes the +2 Might of 814.1.c (the merged
 *   KeywordGrantLayerEngine does expand it and honours the designation gate,
 *   but it is not the engine ChainEngine constructs and is not what
 *   programs/lifecycle.ts binds statics to).
 * The damage instruction's target structure (one enemy unit, 355.7) and its
 * linkage to the grant are expressed.
 */
export default {
  canonicalCardId: "card.hash-09ac8b0dded2de4aaec186e708da9025177f38cddcb872a26bfa49aa0a1f627f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(2026-10-18 第四轮复核实测) 授予半段已可执行（continuous.grant-keyword（RIFT-258））。两处当前缺口，不近似实现：" +
    "(1)「deal damage equal to its [Shield]」需要读取关键词数值：ObjectSnapshot.keywords 是 { id, value } 列表，" +
    "814.2 规定多个 Shield 实例相加成单一 Shield Value，而冻结的 Expr 形式只能读快照属性；" +
    "实测 object-property(self, \"shield\") 抛 MissingInformation（快照无该特征），把 keywords 当 amount 读只能得到列表，" +
    "effect.damage 需要数值（实测 negated/impossible）；已注册的 45 个 op 里没有 effect.shield-value。" +
    "(2) 生产默认 LayerEngine 不展开被授予的关键词，授予的 Shield 不会变成 814.1.c 的 +2 Might；" +
    "RIFT-710 的 KeywordGrantLayerEngine 会展开并按 designation 求值，但不是 ChainEngine 构造的引擎，" +
    "programs/lifecycle.ts 绑定的也不是它。" +
    "依赖：读取 ObjectSnapshot.keyword value 的表达式或原语，以及授予关键词的再展开接线；不近似实现。",
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
