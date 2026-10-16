import type { CardProgram } from "../../ir/index.js";

/**
 * Last Stand (ogn-069-298) — Spell, 3 energy + 1 power, Calm.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-069-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   Double a friendly unit's Might this turn. Give it [Temporary]. (Kill it at
 *   the start of its controller's Beginning Phase, before scoring.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability only; the Showdown
 *   permission is expanded by effects/keywords/Action.ts and enforced by the
 *   chain's own timing check (contract 3.5 / 3.7).
 * - "a friendly unit" is a target: the named Board unit is in a public zone
 *   (355.7 / 355.9.a.1 / 355.10), and 355.5.a uses "Stun a unit at a
 *   battlefield" to show that such a choice is made during finalization.
 * - "Double a friendly unit's Might this turn" is Doubling (433.1: increase a
 *   numeric attribute by an amount equal to that attribute's CURRENT value),
 *   so the amount is the target's Might read at resolution — 433.1.a's own
 *   worked example is this very card. That is an arithmetic-layer Might
 *   modification with a this-turn duration (475/478, 143.2.a: "Might" means
 *   Effective Might).
 * - "Give it [Temporary]" grants the Temporary keyword to that unit (816.1:
 *   "At the start of this permanent's controller's Beginning Phase, before
 *   scoring, kill this"), so the second instruction references the same unit
 *   as the first and is linked to it (359.3.e.14): a lost target ignores both.
 *
 * Status: judge-required — neither clause has a merged producer:
 * - no file under effects/instructions/ registers a Might modification through
 *   ResolveContext.addContinuous, and contract 3.6's closed GameAction set has
 *   no Might-modification action. The layers engine (RIFT-91) evaluates the
 *   arithmetic layer and expires this-turn durations, but a resolving spell has
 *   no opcode that reaches it.
 * - the keyword registry has no Temporary KeywordDef (CR 816; 816.1.b is the
 *   kill trigger, 816.2 makes multiple instances redundant), so the grant
 *   cannot be declared or expanded, and the beginning-start timing point it
 *   would subscribe to has no keyword consumer.
 * Neither half is approximated: the Might change is not written as a Buff
 * counter (702), and the [Temporary] grant is not dropped.
 */
const lastStand = {
  canonicalCardId: "card.hash-cfe83e821b0faa83120c2096c34d250fad91786b0aba091191591e6936237f0a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两句都缺已合入的生产者：(1)「Double a friendly unit's Might this turn」是 CR 433.1 的 Doubling" +
    "（按结算时该单位 Might 的当前值增加同量，CR 433.1.a 的示例正是本卡），属于 arithmetic 层的临时 Might 修改" +
    "（143.2.a/475/478），但 effects/instructions/ 下没有任何原语通过 ResolveContext.addContinuous 注册它，" +
    "契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作（RIFT-91 只合入了 layers 求值侧）；" +
    "(2)「Give it [Temporary]」需要 Temporary 关键词的 KeywordDef（CR 816：816.1.b 在控制者 Beginning Phase 开始时消灭它，" +
    "816.2 多次冗余），关键词注册表没有该条目，Beginning Phase 时点也没有消费方（依赖 RIFT-83 关键词范围）。" +
    "不近似实现：Might 变化不写成 Buff 计数（702），[Temporary] 授予不省略。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Double a friendly unit's Might this turn" (433.1/433.1.a): the
          // amount is the target's current Might at resolution, and the
          // modification lasts for the turn (arithmetic layer, 478).
          id: "last-stand.double-might",
          op: "continuous.might",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "last-stand.unit" },
              property: "might"
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "last-stand.unit",
              // "a friendly unit" — one Board unit controlled by this
              // ability's controller.
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Give it [Temporary]" — the same unit, so this instruction is
          // linked to the doubling (359.3.e.14) and grants the Temporary
          // keyword (CR 816) through the pending keyword expansion.
          id: "last-stand.give-temporary",
          op: "continuous.grant-keyword",
          linkedTo: "last-stand.double-might",
          args: {
            keyword: { kind: "constant", value: "Temporary" }
          },
          targets: [
            {
              id: "last-stand.unit",
              filter: { type: "unit", controller: "self" },
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
    "Double a friendly unit's Might this turn. Give it [Temporary]. " +
    "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default lastStand;
