import type { CardProgram } from "../../ir/index.js";

/**
 * Emperor's Divide — sfd-043-221 (Spell, 2 energy, power null, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-043-221, verbatim):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Move any number of friendly units at a battlefield to their base.
 *
 * Catalog evidence: energy 2, power null, might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7); the card only names them.
 * - "Move any number of friendly units at a battlefield to their base":
 *   355.12 makes every chosen unit a target chosen independently of the game
 *   action and 355.13 lets "any number" include zero, so the TargetSpec is
 *   min 0 / selection "up-to". "friendly" is the controller relationship
 *   (740.1.a) and "at a battlefield" is a targeting restriction on the units,
 *   not a second target (355.10.b example: "Kill a unit at a battlefield"
 *   targets the unit, not the battlefield). The Move itself is the merged
 *   effect.move (421, 448) with destination "controller-base": 107.1.c makes
 *   each unit's Base its controller's Base. The amount is the count of the
 *   finalized units so every one of them may move (the primitive's amount is an
 *   upper bound and moves as many as possible, 359.3.e.11).
 *
 * Status: judge-required, because the Hidden half cannot be played by its
 * printed route and group/origin targeting is unmerged (neither approximated):
 * - The keyword expansion and buildHiddenCostPlan are merged. The latter
 *   computes Hide/free-play costs, but does not grant Hide, maintain a facedown
 *   zone, or grant Reaction starting next turn (811.1.b-811.1.c).
 * - 811.1.d.2: when this spell is played from facedown, every chosen unit must
 *   be located at the battlefield it was played from. That is an origin-bound
 *   targeting restriction the current TargetSpec cannot express (the filter can
 *   only say "a unit at a battlefield", 355.10.b) and no TargetSpec field
 *   carries the hidden-at origin, so 811.1.d.2 stays unexpressible.
 * - 355.11: the selected units must collectively be at one battlefield. The
 *   target plan only tests a concrete location per object; it does not select
 *   or re-test a maximal legal same-battlefield subset for this group.
 * The Move sub-effect for an already legal group executes in the golden tests;
 * this does not establish the full targeting lifecycle.
 */
const emperorsDivide = {
  canonicalCardId: "card.hash-ecb9b44b724f5cf8fc83e9f49da0b24bed461053303201914a0ce0ef8db8ed45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "剩余接线缺口：(1)[Hidden]（811）的展开已合入（keywords/Hidden.ts），" +
    "buildHiddenCostPlan 已支持 Hide [A] 与从 Hidden 免费打出的费用，但 cost.hidden 静态效果没有 Hide 行动、facedown 区域、下一回合 Reaction 权限的集成消费方（811.1.b/811.1.c）。" +
    "(2) 811.1.d.2 要求从 facedown 打出时所有被选单位都位于它被隐藏的战场，这是来源绑定的目标限制；" +
    "现有 TargetSpec filter 只能表达「unit 位于某个 battlefield」（355.10.b），无法表达「与隐藏来源同一战场」，" +
    "该来源限制的 TargetSpec 字段不存在（811.1.d.2 不可表达）。(3)「at a battlefield」的目标组需满足同一战场约束，并在结算时选择最大合法子集（355.11.a/355.11.b/.b.1）；target-plan 目前只有逐对象的固定 location 重检，尚未绑定本卡的组约束、同地 Finalize 选择与分离后的最大合法子集重选。effect.move 对已合法目标组的移动（355.12/355.13 的 any number → min 0；107.1.c 的 controller-base）已有真实子效果测试。",
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
          id: "emperors-divide.move-units",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "emperors-divide.units" } },
            // 107.1.c：每个单位的 Base 就是其控制者的 Base。
            to: { kind: "constant", value: "controller-base" },
            // "any number" 的上界 = 本次 Finalize 锁定的单位数（359.3.e.11）。
            amount: {
              kind: "count",
              subject: "units",
              filter: { object: { target: "emperors-divide.units" } }
            }
          },
          targets: [
            {
              id: "emperors-divide.units",
              filter: { type: "unit", controller: "self", location: "battlefield" },
              min: 0,
              max: null,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move any number of friendly units at a battlefield to their base."
} satisfies CardProgram;

export default emperorsDivide;
