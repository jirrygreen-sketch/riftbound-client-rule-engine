import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-254-298 Noxian Guillotine, Darius (Spell, Fury/Order, 4 energy + 1 power,
 * tags Darius / Signature) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Fury", "Order"], energy 4, power 1, might null.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Choose a unit. Kill it the next time it takes damage this turn.
 *   [Legion] — Kill it now instead. (Get the effect if you've played another card this turn.)
 *
 * Status: judge-required. Three pieces are missing, all in the engine rather than
 * in this card:
 * - "Kill it the next time it takes damage this turn" is a Delayed Triggered
 *   Ability (CR 392; the rules text itself cites this card, and 158.2 gives the
 *   replacement ruling for the Legion clause). No merged primitive registers a
 *   delayed trigger: `ResolveContext.registerDelayedTrigger` exists but is not
 *   exposed by any instruction primitive, and there is no "next time" once-scope
 *   or end-of-turn expiry for it (`TriggerSpec.once` has per-turn/per-combat/
 *   per-chain/per-game only).
 * - [Legion] (812) is a dependent keyword: 812.1.b.1 makes it a condition on this
 *   card ("if you have played another card this turn"), and 812.1.c excludes the
 *   card itself. Contract 3.8 already added `HistoryQuery.exclude`/
 *   `objectFilter`, but the merged `condition.history` primitive only accepts
 *   scope/action/timingPoint/player/object, so the keyword expansion's
 *   `excluding` payload is rejected ("Unsupported history query field").
 * - "Kill it now instead" replaces the delayed instruction (CR 158.2 ruling for
 *   this exact card; 367 Replacement Effects). There is no merged primitive that
 *   negates an instruction of the same spell, so the exclusive outcome is only
 *   recorded with a condition here.
 * "Choose a unit" is a normal target (355.7) and `effect.kill` is merged; that
 * half is covered by a real primitive test.
 */
const noxianGuillotine = {
  canonicalCardId: "card.hash-c973c5f4508531db7ec8b07e87359987755e8136cf2abb7b2e92df957e1ff837",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺延迟触发注册：'Kill it the next time it takes damage this turn' 是延迟触发能力（CR 392/367），" +
    "没有已合入原语暴露 registerDelayedTrigger，且 TriggerSpec.once 没有「下一次」作用域与回合末到期；" +
    "[Legion] 依赖型关键词（812.1.b.1/812.1.c）需要 condition.history 支持契约 3.8 的 exclude/objectFilter，" +
    "但已合入的 history 原语只接受 scope/action/timingPoint/player/object，密钥词展开的 excluding 会被拒绝；" +
    "'Kill it now instead' 是同一法术内指令级替代（CR 158.2 用的正是本卡），没有已合入的替代原语，" +
    "此处只用 condition 记录互斥结果。依赖：RIFT-82 Legion 关键词展开、RIFT-89/90 与批次 4 事件/替换管线；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    { kind: "keyword", keyword: "legion" },
    {
      kind: "play",
      body: [
        {
          // [Legion] condition, 812.1.c: another card was played this turn. The
          // `excluding` payload is the keyword expansion's contract-3.8 shape and
          // is not yet accepted by the merged history primitive.
          id: "guillotine-legion-check",
          op: "condition.history",
          args: {
            query: {
              kind: "literal",
              value: {
                scope: "turn",
                action: "play",
                player: "controller",
                excluding: "card.hash-c973c5f4508531db7ec8b07e87359987755e8136cf2abb7b2e92df957e1ff837"
              }
            },
            operator: { kind: "literal", value: "gte" },
            right: { kind: "literal", value: 1 }
          }
        },
        {
          // "[Legion] — Kill it now instead." effect.kill is merged; the target is
          // the unit chosen at Finalize for the whole spell.
          id: "guillotine-kill-now",
          op: "effect.kill",
          args: { target: { kind: "literal", value: "guillotine-unit" } },
          targets: [
            { id: "guillotine-unit", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ],
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "guillotine-legion-check",
              key: "value"
            },
            operator: "eq",
            right: { kind: "literal", value: true }
          }
        },
        {
          // "Kill it the next time it takes damage this turn." The delayed
          // registration primitive is missing (see judgeReason). The condition
          // only records the exclusive outcome with the Legion clause.
          id: "guillotine-kill-later",
          op: "effect.kill-when-damaged",
          args: {
            target: { kind: "literal", value: "guillotine-unit" },
            timing: { kind: "literal", value: "next-time-takes-damage" },
            duration: { kind: "literal", value: "this-turn" }
          },
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: {
                kind: "linked-value",
                instructionId: "guillotine-legion-check",
                key: "value"
              },
              operator: "eq",
              right: { kind: "literal", value: true }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a unit. Kill it the next time it takes damage this turn.\n" +
    "[Legion] \u2014 Kill it now instead. (Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default noxianGuillotine;
