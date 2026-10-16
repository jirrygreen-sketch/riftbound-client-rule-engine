import type { CardProgram } from "../../ir/index.js";

/**
 * Mystic Reversal (ogn-080-298) — Spell, 4 energy + 3 power, Calm.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-080-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Gain control of a spell. You may make new choices for it.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; the permission
 *   (813.1.b/813.1.c) is expanded by effects/keywords/Reaction.ts and enforced
 *   by the chain's own timing check (contract 3.5 / 3.7).
 * - "a spell" is a finalized object on the Chain (355.9.a.2), so it is the
 *   instruction's target (355.7/355.9.a); the pending chain-item exclusion of
 *   355.3/359.3.e.1-e.6 belongs to the target system and the chain.
 * - "Gain control of a spell" changes which player controls that chain item.
 *   The frozen GameAction set has take-control (contract 3.6) and the merged
 *   effect.control primitive (RIFT-117) executes it: it rewrites the chain
 *   item's control layer and rechecks under 359.3.e that the locked reference
 *   is still current on the Chain. For a spell the change is a control-layer
 *   change on the chain item, not a Board control change.
 * - "You may make new choices for it" is the Making New Choices procedure of
 *   CR 750-755: 752.1 limits the remakes to locations, modes, destinations and
 *   targets; 753 requires the player to remake all of them (753.3 keeps the
 *   item's restrictions and requirements); 753.2 negates the instruction when
 *   no legal new choices exist; 754 re-triggers targeting effects; 755 ignores
 *   any "to play" costs incurred. Contract 3.4 lists 350.2/355.15 as the
 *   "make new choices" re-selection rules, and the merged IR has neither a
 *   node that re-opens a finalized chain item's choice plan nor a result
 *   binding for the 753.2 negation.
 *
 * Status: judge-required. The control clause's primitive is merged (RIFT-117)
 * and golden-tested; the may wraps the remake clause in its body (contract
 * 3.9), so declining skips only that clause. The remake clause still has no
 * merged primitive (choice.remake-chain-item-choices) and no 753.2 result
 * binding; re-selection belongs to the chain/target-plan work and the
 * CardProgram play binding is still RIFT-257.
 */
const mysticReversal = {
  canonicalCardId: "card.hash-ea7dd5402b09dfde273f51aee83776f88c4e3f1fb8f52b4863aa43d307a8ebda",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Gain control of a spell」的原语已合入：effect.control（RIFT-117）经冻结的 take-control 动作执行链上项的" +
    "控制层改写，并按 359.3.e 复核目标仍在链上，golden 已断言真实结算与 controlled 回执；" +
    "「You may make new choices for it」仍是 CR 750-755 的 Making New Choices 流程——" +
    "752.1 只允许重选 location/mode/destination/target，753/753.3 要求全部重选并沿用原限制，753.2 在没有合法新选择时 negated，" +
    "754 会重新触发成为目标，755 忽略因此产生的「to play」费用；choice.remake-chain-item-choices 仍未注册，" +
    "链/目标计划没有重开已 finalize 项选择计划的重选支持，当前 IR 也没有 753.2 的结果绑定；" +
    "本卡的 play 能力（[Reaction] 时机与 play body）到链的绑定同样依赖 RIFT-257。" +
    "不近似实现：不把「make new choices」写成普通 choice.optional + 无操作体。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Gain control of a spell" — the chain item is the target
          // (355.9.a.2); the control change is executed by the merged
          // effect.control primitive (RIFT-117).
          id: "mystic-reversal.gain-control",
          op: "effect.control",
          args: { objects: { kind: "constant", value: { target: "mystic-reversal.spell" } } },
          targets: [
            {
              id: "mystic-reversal.spell",
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "You may make new choices for it" — contract 3.9 shape: the may
          // wraps the remake instruction, which carries the CR 752.1 choice
          // classes for the pending procedure.
          id: "mystic-reversal.may-remake-choices",
          op: "choice.optional",
          linkedTo: "mystic-reversal.gain-control",
          args: {
            prompt: {
              kind: "constant",
              value: "Make new choices for that spell?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "mystic-reversal.remake-choices",
                  op: "choice.remake-chain-item-choices",
                  args: {
                    // 752.1: the remade choice classes are locations, modes,
                    // destinations and targets; 753 remakes all of them.
                    item: { kind: "constant", value: { linked: "mystic-reversal.gain-control" } },
                    choices: {
                      kind: "constant",
                      value: ["location", "mode", "destination", "target"]
                    },
                    remakeAll: { kind: "constant", value: true }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Gain control of a spell. You may make new choices for it."
} satisfies CardProgram;

export default mysticReversal;

