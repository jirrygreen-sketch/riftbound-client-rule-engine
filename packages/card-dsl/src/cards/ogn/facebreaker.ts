import type { CardProgram } from "../../ir/index.js";

/**
 * Facebreaker — ogn-220-298 (Spell, Order, 2 Energy, no Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-220-298):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Stun a friendly unit and an enemy unit at the same battlefield. (They
 *   don't deal combat damage this turn.)
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Hidden]" (811) and "[Action]" (806) are keyword abilities expanded by
 *   the keyword registry (effects/keywords/Hidden.ts, Action.ts; contract
 *   3.7).
 * - "Stun a friendly unit and an enemy unit" is two target choices made when
 *   the spell is finalized: 355.5 explicitly names "Stun a unit at a
 *   battlefield" as a Choice, and 355.5.a excludes criterion-based effects.
 *   Both targets are units chosen by this spell's controller, so each gets its
 *   own TargetSpec (355.7, 355.9.b). "A Stunned Unit can not be Stunned again"
 *   (424.1.a.1) does not make an already-stunned unit an illegal target —
 *   selecting it is legal and simply does nothing (424.1.a: the state is
 *   binary), which is exactly how the merged effect.stun primitive reports it.
 * - "at the same battlefield" ties the two choices together: the enemy unit
 *   must be located where the friendly unit is. The merged target system
 *   expresses that as the `sameLocationAs` anchor on the second spec (contract
 *   3.2 filter anchors; interpreter selectors resolve the anchor against the
 *   first spec's still-legal selection), and the interpreter re-validates it
 *   at resolution (359.3.e). No battlefield id is hard-coded, so this works on
 *   any battlefield.
 * - "They don't deal combat damage this turn" is reminder text for the
 *   Stunned status (424.1.b: a Stunned Unit does not contribute its might to
 *   damage in the combat damage step) and the end-of-turn cleanup that removes
 *   it (424.1.a.2). Both are engine behavior, not card instructions. The
 *   merged effect.stun primitive submits exactly one stun action per object
 *   and documents that the status duration and combat effect stay outside the
 *   primitive.
 * - The stun instructions themselves can be declared with merged primitives.
 *   The card still stays judge-required because Hidden cannot be played by
 *   its printed route: the Hide action, the facedown zone and the free
 *   facedown play need a consumer for cost.hidden (RIFT-84 merged the
 *   keyword expansion; no merged code reads that effect yet, and
 *   cost/README.md records the missing zones/actions). Both printed
 *   instructions execute against the merged kernel, and the golden test
 *   covers the normal case, an already-stunned member and a stale enemy
 *   target.
 */
const facebreaker = {
  canonicalCardId: "card.hash-87a99b58ae6328e24ded8a032bff52588b3676f3c2eec58aafc5bafaa7a78aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Hidden] 展开仍不可执行：RIFT-84 已合入 Hidden 关键词展开，但它的 cost.hidden 持续效果没有消费方——" +
    "没有已合入代码据它授予 Hide 动作、facedown 区域或 facedown 打出许可；cost/README.md 记录现有区域与动作尚缺" +
    "Hide/facedown。两条正文指令（两个目标式 effect.stun，第二个用 sameLocationAs 绑定同一战场）已可用已合入" +
    "解释器与目标系统真实执行，见 golden 测试；整卡不因正文可执行而宣称 executable。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "facebreaker.stun-friendly-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "facebreaker.friendly-unit" } },
          targets: [
            {
              id: "facebreaker.friendly-unit",
              filter: { types: "unit", controller: "controller", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "facebreaker.stun-enemy-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "facebreaker.enemy-unit" } },
          targets: [
            {
              id: "facebreaker.enemy-unit",
              // "an enemy unit at the same battlefield": the anchor resolves
              // against the friendly unit's location, so both stuns land at
              // one battlefield on any board (contract 3.2 anchors, CR 355.5).
              filter: {
                types: "unit",
                controller: "opponent",
                sameLocationAs: { target: "facebreaker.friendly-unit" }
              },
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Stun a friendly unit and an enemy unit at the same battlefield. (They don't deal combat damage this turn.)"
} satisfies CardProgram;

export default facebreaker;
