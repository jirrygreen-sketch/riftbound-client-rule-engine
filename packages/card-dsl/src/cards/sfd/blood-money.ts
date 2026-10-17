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
 *   the Might cap are targeting restrictions, 355.9.b), executed with the
 *   merged effect.kill primitive (429.1 / 429.6).
 * - "If it was an enemy unit / a friendly unit" is a condition on the killed
 *   object read through the linked kill result. The condition applies to
 *   exactly the instruction that owns it (contract 3.4), so each clause is a
 *   separate token instruction with its own condition.
 * - "play a Gold gear token exhausted" is the CR 187.5 Gold gear token (a
 *   token with its own activated ability) plus the 143.4 / 185.2.d entry-state
 *   stipulation, and "play" means chain creation then play (440.2.c /
 *   185.2.a).
 *
 * Status: judge-required. The kill half and the enemy/friendly branch
 * conditions run on merged primitives and are exercised by the golden test.
 * The token half has no merged primitive: effect.token's frozen definition
 * table deliberately excludes definitions with their own abilities (Gold, CR
 * 187.5 has "[Reaction][>] Kill this, [E]: [Add] [A]") and reports
 * blockedReason "token-definition-or-abilities-judge-required", and its
 * argument schema has no entry-state argument ("Entry overrides are not
 * supported"), so "exhausted" cannot be authored. The clauses keep the token
 * shape they would have once the Gold definition and the entry-state override
 * land; no Board creation or later effect.exhaust substitutes for it.
 */
const bloodMoney = {
  canonicalCardId: "card.hash-7551ce962903e76a505471142dd69fbb43e0d921a67fd4e02d1f0cc264eaec6b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play a Gold gear token exhausted」半段缺已合入原语：Gold gear（CR v1.5 187.5）是自带「[Reaction][>] Kill this, [E]: [Add] [A]」" +
    "能力的 token，effect.token 的冻结定义表只收 recruit / sand-soldier / mech / reflection / tentacle 这些无额外能力的定义，" +
    "对 Gold 一律返回 blockedReason \"token-definition-or-abilities-judge-required\"；" +
    "而且 effect.token 的 argsSchema 没有入场状态参数（文件头明确 \"Entry overrides are not supported\"），" +
    "印刷的 \"exhausted\"（143.4 / 185.2.d）无处表达，事后补 effect.exhaust 不等价（会多产生一次「成为横置」事件并错过入场替代）。" +
    "mode \"play\" 的 create-token(to: chain) + play 接手（440.2.c / 185.2.a）已在 effect.token 内实现，但被 Gold 定义判负挡住。" +
    "「Kill a unit at a battlefield with 2 :rb_might: or less」半段用已合入的 effect.kill 表达（目标过滤器保留战场与 Might≤2 限制数据），" +
    "两条 enemy/friendly 分支条件经 linked kill 结果真实求值，均由 golden 覆盖；token 半段不近似实现。" +
    "依赖：Gold token 冻结定义、effect.token 的入场状态参数、目标过滤器的数值 Might 谓词。",
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
              // "at a battlefield" is the location restriction carried by the
              // filter data; the merged query vocabulary has no numeric Might
              // predicate, so the printed cap stays declared filter data and is
              // reported as a gap instead of being invented as executable
              // legality (see the todo in the golden test).
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
          // the "if it was an enemy unit" clause is this instruction's own
          // condition (contract 3.4: a condition applies to exactly this
          // instruction).
          id: "blood-money.enemy-token",
          op: "effect.token",
          linkedTo: "blood-money.kill",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "goldToken" }
          },
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
          op: "effect.token",
          linkedTo: "blood-money.kill",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 2 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "goldTokens" }
          },
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
