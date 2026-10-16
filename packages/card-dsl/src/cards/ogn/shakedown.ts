import type { CardProgram } from "../../ir/index.js";

/**
 * Shakedown (ogn-033-298) — Spell, 2 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose an enemy unit. Deal 6 to it unless its controller has you draw 2.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 2, power 1 (Fury), might null, tags [].
 *
 * Status: judge-required, and the only unresolved point is the rules meaning of
 * "unless":
 * - [Reaction] (813) is declared as a keyword ability; the keyword registry owns
 *   the timing permission (contract 3.7).
 * - "Choose an enemy unit" is the spell's only target (355.7; 355.10), locked
 *   while the spell is finalized (355.5, 358.1); "it" in the next sentence
 *   refers back to that unit.
 * - "Deal 6 to it unless its controller has you draw 2" is read as an either/or
 *   in which the target unit's controller chooses between letting the caster
 *   draw 2 and letting the unit take 6. That reading is not an official ruling:
 *   it comes from the local survey's engineering mapping for this printing
 *   (docs/plans/survey/unclassified-ogn.json: the unless branch is decided by
 *   the unit's controller at resolution and must not be handed to the caster;
 *   the draw and damage branches use the existing choice/result/effect
 *   primitives). CR v1.5 does not define a general "unless" construct, so the
 *   card is kept judge-required until the wording is confirmed, rather than
 *   treating an engineering mapping as settled semantics.
 * - The encoded reading is fully executable with merged primitives, which is why
 *   the golden test exercises both branches: choice.mode with a chooser that
 *   evaluates to the target's controller (engine-core/src/effects/interpreter/
 *   choice.ts reads an evaluated chooser string, defaulting to the controller),
 *   and one branch per outcome — effect.draw for "have you draw 2" (the caster
 *   draws; 190.6.d) and effect.damage for "Deal 6 to it" against the same
 *   TargetSpec. The choice is mandatory for the target's controller (355.18:
 *   undeclared choices are made on resolution), so this is choice.mode, not
 *   choice.optional (contract 3.9).
 *
 * Dependencies: none for execution of the encoded reading; the open item is the
 * official meaning of "unless" for this text.
 */
const shakedown = {
  canonicalCardId: "card.hash-ba7c14228a3f1b238f24fea9d3c946f61d32728e8186d24e325cee8bce8302f3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一未定项是「Deal 6 to it unless its controller has you draw 2」中 unless 的官方语义：本程序按「目标单位的控制者在结算时二选一" +
    "（让施法者抽 2，或让该单位受到 6 点伤害）」建模（choice.mode + chooser 取目标控制者；两个分支分别用 effect.draw / effect.damage；" +
    "抽牌归能力控制者 190.6.d；选择权不归施法者；选择对目标控制者强制，355.18）。该读法来自" +
    "docs/plans/survey/unclassified-ogn.json 对 ogn-033-298 的工程映射，不是官方裁定，CR v1.5 也没有通用 unless 构造，" +
    "故整卡保持 judge-required（结构已可执行并有 golden 双分支执行测试），拿到裁定后复核即可改状态。" +
    "涉及的已合入原语：choice.mode（可指定的 chooser）、effect.damage、effect.draw、continuous.timing（Reaction 展开）。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose an enemy unit. Deal 6 to it unless its controller has you draw 2.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // Printed cost (energy 2 + 1 Fury power) comes from the catalog.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "shakedown.choose-outcome",
          op: "choice.mode",
          args: {
            // The target unit's controller makes the choice, not the caster.
            chooser: {
              kind: "object-property",
              object: { target: "shakedown.enemy-unit" },
              property: "controller"
            },
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: {
              kind: "constant",
              value: "Let the caster draw 2, or let this unit take 6 damage?"
            },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "shakedown.draw-two",
                  body: [
                    {
                      // "...has you draw 2": the ability controller draws
                      // (190.6.d), so no player override is passed. The draw is
                      // an independent instruction, not linked to the damage.
                      id: "shakedown.draw-2",
                      op: "effect.draw",
                      args: { amount: { kind: "constant", value: 2 } }
                    }
                  ]
                },
                {
                  id: "shakedown.deal-six",
                  body: [
                    {
                      // "Deal 6 to it": the very unit chosen by the spell (same
                      // TargetSpec id). The source defaults to the resolving
                      // spell (418.6.a).
                      id: "shakedown.deal-6",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 6 },
                        target: { kind: "constant", value: "shakedown.enemy-unit" }
                      }
                    }
                  ]
                }
              ]
            }
          },
          targets: [
            {
              id: "shakedown.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default shakedown;
