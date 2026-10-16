import type { CardProgram } from "../../ir/index.js";

/**
 * Blood Money (sfd-162-221) — Spell, 2 energy, Order.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Kill a unit at a battlefield with 2 :rb_might: or less. If it was an enemy
 *   unit, play a Gold gear token exhausted. If it was a friendly unit, play
 *   two Gold gear tokens exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Kill a unit at a battlefield with 2 [M] or less" is one target (355.10:
 *   "Kill a unit at a battlefield" targets the unit; "at a battlefield" and
 *   the Might cap are targeting restrictions, 355.9.b), executed with
 *   effect.kill (429.1 / 429.6).
 * - "If it was an enemy unit / a friendly unit" is a condition on the killed
 *   object, read through the linked result of the kill instruction. The card
 *   describes that branch in the intended shape; the two Gold tokens are not
 *   playable with merged primitives.
 * - "play a Gold gear token exhausted" is the CR 187.5 Gold gear token (a
 *   token with its own activated ability) plus the 143.4 / 185.2.d entry
 *   override, and "play" means chain creation then play (440.2.c / 185.2.a).
 *   effect.token's definition table deliberately excludes tokens with
 *   abilities and documents the entry override as unsupported, so this half
 *   has no merged primitive at all.
 *
 * Status: judge-required. The kill half is executable on its own and is
 * covered by the golden test; the token half is judged and is described with
 * an explicit blocked op instead of being approximated by a Board creation or
 * a ready entry.
 */
const bloodMoney = {
  canonicalCardId: "card.hash-7551ce962903e76a505471142dd69fbb43e0d921a67fd4e02d1f0cc264eaec6b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play a Gold gear token exhausted」缺原语：Gold gear（CR v1.5 187.5）是带自身启动能力的 token，" +
    "effect.token 的定义表刻意排除带能力的 token，并明确不支持「exhausted」入场替代（143.4 / 185.2.d）；" +
    "被「打出」的 token 还需链上创建 + play 接手（440.2.c / 185.2.a），当前 create-token 只有 board 路径。" +
    "「Kill a unit at a battlefield with 2 :rb_might: or less」半段用已合入的 effect.kill 表达并在金标测试中执行；" +
    "token 半段不近似实现。依赖：Gold token 定义与入场替代、链上 token 创建/打出管线（RIFT-62 后续）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill a unit at a battlefield with 2 :rb_might: or less. If it was an enemy unit, play a Gold gear token exhausted. If it was a friendly unit, play two Gold gear tokens exhausted.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "blood-money.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "blood-money.unit" } },
          targets: [
            {
              id: "blood-money.unit",
              // 355.9.b: the unit must be at a battlefield and have Might <= 2.
              // The Might cap stays a filter placeholder: no merged filter key
              // or predicate implements "with 2 Might or less" on targets, and
              // inventing one here would silently change target legality.
              filter: {
                type: "unit",
                locationType: "battlefield",
                mightAtMost: 2
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "If it was an enemy unit, play a Gold gear token exhausted."
          // Covers 359.3.e.14 (linked instruction) + 425/185 entry override;
          // no merged primitive plays a Gold token, and the exhaustion entry
          // override is explicitly unsupported. The "if it was an enemy
          // unit" clause is the instruction's own condition (contract 3.4:
          // a condition applies to exactly this instruction).
          id: "blood-money.enemy-token",
          op: "effect.play-gold-token-exhausted",
          linkedTo: "blood-money.kill",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "compare",
            left: { kind: "object-property", object: { linked: "blood-money.kill" }, property: "controller" },
            operator: "ne",
            right: { kind: "object-property", object: "source", property: "controller" }
          }
        },
        {
          // "If it was a friendly unit, play two Gold gear tokens exhausted."
          id: "blood-money.friendly-tokens",
          op: "effect.play-gold-token-exhausted",
          linkedTo: "blood-money.kill",
          args: { amount: { kind: "constant", value: 2 } },
          condition: {
              kind: "compare",
              left: { kind: "object-property", object: { linked: "blood-money.kill" }, property: "controller" },
              operator: "eq",
              right: { kind: "object-property", object: "source", property: "controller" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default bloodMoney;
