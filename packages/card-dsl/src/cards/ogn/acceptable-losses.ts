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
 * Status: judge-required — the kill half uses only the merged effect.kill
 * primitive (executed in the golden test), but two parts of the text have no
 * merged execution path:
 * - "Each player" must resolve as one kill per player, in turn order. The
 *   merged IR is executed as a single body by one ResolveContext: the
 *   interpreter's Picks come from "ctx.picks(id)" (interpreter.ts), whose
 *   contract has no per-player iteration or chooser-bound pick (contract 3.6),
 *   and there is no player-selection/iteration primitive in the frozen opcode
 *   list (ability-templates.md lists target.player as unmerged). Repeating the
 *   instruction a fixed number of times would hard-code a player count.
 * - "their gear" is the choosing player's own Gear, evaluated per chooser;
 *   the merged ObjectFilter player selectors are resolved against the ability
 *   controller (chain/engine.ts normalizes only "self"/"opponent" against the
 *   item's controller), and a pick filter cannot be rebound to the picker.
 * Both gaps belong to the per-player choice/iteration work (target.player +
 * pick chooser scoping); until then this card stays judge-required instead of
 * approximating "each player" with one caster-chosen kill.
 */
const acceptableLosses = {
  canonicalCardId: "card.hash-b3827545fbd7637410bd870c5f9e3d7996c213e335b7df3d7fe6460e05c58891",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Each player」的逐玩家选择/迭代：CR 355.10.e 把「每个玩家各杀自己的一件装备」定义为结算时的选择（非目标），CR 412.1 由各自玩家负责自己的消灭，" +
    "但已合入的 IR 是单次 body + 单一 ResolveContext，pick 只能经 ctx.picks(id) 一次性读取（契约 3.6 无按玩家迭代与 chooser 绑定 pick），" +
    "封闭 opcode 表也没有 player 迭代/选择原语（ability-templates.md 的 target.player 未实现）；按固定次数 repeat 会把玩家人数写死。" +
    "同时「their gear」需按各自选择者重绑 owner/controller，而过滤器玩家选择器只按能力控制者解析（chain/engine.ts）。" +
    "kill 半段只用已合入的 effect.kill 表达并有执行测试；依赖 target.player 与 pick chooser 落地。",
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
