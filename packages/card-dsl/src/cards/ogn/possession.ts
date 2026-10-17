import type { CardProgram } from "../../ir/index.js";

/**
 * Possession — ogn-203-298 (Spell, Chaos, 8 Energy + 3 Chaos Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-203-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   Choose an enemy unit at a battlefield. Take control of it and recall it.
 *   (Send it to your base. This isn't a move.)
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Action]" (806) is a permissive keyword: the spell may be played during
 *   Showdowns on any player's turn. The card only declares the keyword; the
 *   permission is expanded by effects/keywords/Action.ts into a
 *   continuous.timing static ability.
 * - "Choose an enemy unit at a battlefield" is a Choice (355.5; 355.5.a uses
 *   "Stun a unit at a battlefield" as its own example), so the enemy unit is
 *   an ordinary target: one unit, opponent-controlled, located at a
 *   battlefield (355.7, 355.9.b, 355.10). The Pending-exclusion and
 *   target-lock rules (355.3, 355.15) stay with the target system (RIFT-90).
 * - "Take control of it" is executed by the merged effect.control primitive
 *   (RIFT-117) over the frozen take-control GameAction (contract 3.6): the
 *   chosen unit's controller changes to the ability controller. The card has
 *   no printed duration, so the primitive's permanent default is used (nothing
 *   hands the unit back). The primitive also documents that non-permanent
 *   durations remain BLOCKED; this card does not need one.
 * - "and recall it" is a Recall (457): a relocation to its Base that is
 *   explicitly not a Move (458), does not trigger Move abilities (458.1),
 *   cannot be blocked by movement restrictions (458.3) and keeps damage and
 *   statuses (460, 460.1). There is no printed duration, so no end-of-turn
 *   hand-back is added. The merged effect.move primitive accepts mode
 *   "recall" but documents that Recall is BLOCKED: it returns
 *   negated/impossible with a blockedReason and performs no move-zone or
 *   move-location substitute. The destination is the acting side's Base
 *   ("controller-base": the Base of each object's current controller, which
 *   is the new controller once control has been taken).
 *
 * Status: judge-required. The control half now executes through the merged
 * effect.control primitive and is covered by the golden; the recall half is
 * still not executable — the merged effect.move recall path explicitly refuses
 * to fake a Move (it returns negated/impossible with a blockedReason and
 * submits no substitute action). The two instructions stay linked (359.3.e.14:
 * "it" refers to the chosen unit), and the recall keeps the card's own object
 * selector rather than a substitute action.
 */
const possession = {
  canonicalCardId: "card.hash-18e556f7feed1c4774ba2262a9ef50441960dfa08dadbf07fd4011f655b4f544",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Take control of it」半段已可执行：effect.control 原语（RIFT-117）已合入并经 golden 真实执行（控制器变为" +
    "能力控制者，127.1/188–192）；本卡无印刷期限，用原语的 permanent 默认值，不涉及被阻断的非永久期限。" +
    "「recall it」仍不可执行——已合入的 effect.move 明确标注 Recall 为 BLOCKED（CR 457–460：Recall 不是 Move、" +
    "不发 Move 事件、不受移动限制、保留伤害与状态），调用 mode:\"recall\" 会返回 negated/impossible 并给出" +
    "blockedReason，且不得用 move-location 近似（458）。两条指令保持 linkedTo（359.3.e.14 的「it」）。" +
    "依赖：Recall 独立动作的落地（RIFT-109 后续）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 8 },
        power: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Take control of it" — effect.control over the frozen take-control
          // action (RIFT-117); the target set is the enemy unit locked on this
          // instruction's TargetSpec.
          id: "possession.take-control",
          op: "effect.control",
          args: {
            objects: { kind: "constant", value: { target: "possession.unit" } }
          },
          targets: [
            {
              id: "possession.unit",
              filter: { types: "unit", controller: "opponent", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "and recall it" (457–460): a Recall, never a Move. effect.move's
          // recall mode refuses to substitute move-location, so the
          // instruction reports blockedReason instead of relocating.
          id: "possession.recall",
          op: "effect.move",
          linkedTo: "possession.take-control",
          args: {
            objects: { kind: "constant", value: { target: "possession.unit" } },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose an enemy unit at a battlefield. Take control of it and recall it. (Send it to your base. This isn't a move.)"
} satisfies CardProgram;

export default possession;
