import type { CardProgram } from "../../ir/index.js";

/**
 * Acceptable Losses (ogn-179-298) — Spell, 1 energy, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Each player kills one of their gear.
 *
 * Structure (contract 3.1 / 3.2, Core Rules v1.5):
 * - "action" keeps the printed [Action] keyword (806; 159.2.a); its
 *   "continuous.timing" expansion and the chain admission are owned by the
 *   keyword registry and chain/ (contract 3.7).
 * - "Each player kills one of their gear." does NOT target: it is a set of
 *   objects chosen in whole or in part by other players, explicitly listed in
 *   CR 355.10.e (its own example is "Each player kills a unit they control",
 *   and 355.10.e puts the choice at resolution). The program therefore models
 *   each kill as a non-target PickSpec, never a TargetSpec (contract 3.4:
 *   targets trigger "becomes a target", picks do not).
 * - CR 412.1 (and its Cull the Weak example, the unit-shaped twin of this
 *   text) fixes responsibility: each player performs and is responsible for
 *   their own kill. That makes the sequence chooser-scoped — the acting
 *   player's own choice, not the caster's — which is what a PickSpec's
 *   chooser field expresses.
 *
 * Status: judge-required. effect.kill and Action have execution paths, but
 * repeat cannot enumerate players or rebind each player's non-target choice
 * and kill responsibility (355.10.e / 412.1). Ordered zoneSlice/linked pick
 * bindings do not implement chooser-relative filter selection. Fixed player
 * counts or caster-chosen kills would change the printed effect.
 */
const acceptableLosses = {
  canonicalCardId: "card.hash-b3827545fbd7637410bd870c5f9e3d7996c213e335b7df3d7fe6460e05c58891",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺逐玩家（per-player）结算作用域：CR 355.10.e/412.1 要求各玩家在结算时选择并负责消灭自己控制的一件装备；repeat 只有次数，没有按 turn order 枚举玩家并重绑 chooser/controller 的 body。chain/picks 已支持 zoneSlice/linked 有序来源，但本卡 PickSpec.filter 的候选查询、每位选择者的选择与 effect.kill 的责任玩家仍未接线。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "acceptable-losses.kill-gear",
          op: "effect.kill",
          args: {
            picks: { kind: "constant", value: "acceptable-losses.gear" },
            count: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "acceptable-losses.gear",
              // 结算期由「该选择者」从自己的 Gear 中选一件（CR 355.10.e / 412.1）。
              options: ["dynamic:one-gear-the-choosing-player-controls"],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "gear", zone: "board", controller: "self" }
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Each player kills one of their gear."
} satisfies CardProgram;

export default acceptableLosses;
