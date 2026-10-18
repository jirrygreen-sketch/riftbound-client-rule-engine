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
 * Status: judge-required（2026-10-17 复核）— the printed body executes/registers on merged
 * paths, but the granted keyword and the [Action] permission still have no runtime consumer:
 * - "Double a friendly unit's Might this turn" is captured as the target's
 *   current Might with the merged condition.value value node and added back
 *   through the continuous.might instruction with the
 *   this-turn duration; the arithmetic layer and end-of-turn expiry evaluate
 *   the result. The golden test drives the card's own body through the
 *   production chain adapter and asserts the real registration, the doubled
 *   effective Might, expiry and the lost-target edge.
 * - "Give it [Temporary]" uses continuous.grant-keyword. The ability layer
 *   carries the Temporary keyword, but production never re-expands it into a
 *   trigger registration: the KeywordGrantLayerEngine re-expansion is merged,
 *   yet production assembly attaches the plain LayerEngine, and the Temporary
 *   expansion's beginning-start spec is rejected by the closed
 *   EVENT_PATTERN_TYPES list (events/trigger-spec.ts) before any registration.
 *   The 816.1.b Beginning Phase kill never fires. The grant is not dropped or
 *   faked into a direct kill.
 * - [Action] (806) is declared as a keyword ability, but its expansion is still
 *   refused by the production static binder: `programs/statics.ts` throws
 *   "Unsupported static appliesTo [\"card\",\"activated-ability\"]" for the
 *   continuous.timing static the KeywordDef produces, so the showdown timing
 *   grant cannot be registered through a CardProgram.
 */
const lastStand = {
  canonicalCardId: "card.hash-cfe83e821b0faa83120c2096c34d250fad91786b0aba091191591e6936237f0a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Double a friendly unit's Might this turn」（CR 433.1 的 Doubling）已可执行：condition.value 捕获目标当前 Might" +
    "（433.1/433.1.a）后由 continuous.might 以 add + this-turn 期限注册，golden 用生产链适配器执行并断言翻倍、" +
    "end-of-turn 到期与目标丢失边界。整卡仍不可执行：「Give it [Temporary]」的 continuous.grant-keyword" +
    "已能把 Temporary 写进 ability 层，但生产不会把动态授予的关键词重展开成触发注册：KeywordGrantLayerEngine 的重展开已合入，" +
    "生产装配仍用普通 LayerEngine；且 beginning-start 时点仍不在" +
    "EVENT_PATTERN_TYPES 闭集内（实测 Temporary 展开的 spec 被 assertTriggerSpec 以 invalid-event-type 拒绝）；" +
    "816.1.b「在控制者 Beginning Phase 开始时消灭它」不会运行。[Action]（806）的展开是 " +
    "continuous.timing static，programs/statics.ts 对其 appliesTo: [\"card\", \"activated-ability\"] 抛 " +
    "\"Unsupported static appliesTo\"（实测），showdown timing grant 无法经 CardProgram 注册。" +
    "依赖：动态关键词授予后的触发注册、beginning-start 事件词表与 continuous.timing 的静态绑定。" +
    "不近似实现：不把 [Temporary] 省略，也不写成直接消灭。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // 433.1/433.1.a: Doubling is "increase by an amount equal to the
          // attribute's CURRENT value". The current Might is captured once at
          // resolution (condition.value is the data-only value node that
          // publishes a named binding) and re-read by the modification below.
          id: "last-stand.capture-might",
          op: "condition.value",
          args: {
            key: { kind: "constant", value: "doubled" },
            value: {
              kind: "object-property",
              object: { target: "last-stand.unit" },
              property: "might"
            }
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
          // The modification itself: arithmetic layer (478), this-turn
          // duration (317.2.c / 468.7.c), amount = the captured current Might.
          id: "last-stand.double-might",
          op: "continuous.might",
          linkedTo: "last-stand.capture-might",
          args: {
            amount: { kind: "linked-value", instructionId: "last-stand.capture-might", key: "doubled" },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "last-stand.unit" } }
          }
        },
        {
          // "Give it [Temporary]" — the same unit, so this instruction is
          // linked to the target choice (359.3.e.14); a lost target ignores the
          // whole clause. The grant registers the merged Temporary keyword
          // (CR 816) into the ability layer through the merged
          // continuous.grant-keyword instruction.
          id: "last-stand.give-temporary",
          op: "continuous.grant-keyword",
          linkedTo: "last-stand.capture-might",
          args: {
            keyword: { kind: "constant", value: "Temporary" },
            objects: { kind: "constant", value: { kind: "target", id: "last-stand.unit" } }
          }
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
