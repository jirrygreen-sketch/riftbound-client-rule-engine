import type { CardProgram } from "../../ir/index.js";

/**
 * Hexplosive Minefield — rad-142-167 (Spell, Fury/Chaos, 2 Energy + 1 Power,
 * Ziggs / Signature).
 *
 * Printed text (verbatim, deck-catalog rad-142-167):
 *   "[Action] (Play on your turn or in showdowns.)
 *    Kill any number of friendly Bomb tokens. At end of turn, play that many
 *    Bomb tokens to a single battlefield."
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the play permission itself
 *   is expanded by the keyword registry (effects/keywords/Action.ts).
 * - "Kill any number of friendly Bomb tokens" is one Kill Instruction
 *   (429.1.a.1.a, 429.6). "any number" makes the choice an up-to choice of
 *   targets that includes zero (355.13), and the filter scopes it to Bomb gear
 *   tokens (187.12) controlled by the ability controller. The merged
 *   effect.kill executes this half — see the golden test.
 * - "At end of turn, play that many Bomb tokens to a single battlefield" is a
 *   Delayed Ability created by the spell (390, 391.1-391.2): its window is the
 *   turn (317.2.c), it resolves at the turn-end timing point, and it plays NEW
 *   Bomb tokens equal to the number killed.
 *
 * Status: judge-required. The kill half really executes (the golden runs the
 * card's own instruction through the chain adapter); the delayed half still
 * cannot:
 * - the card-facing delayed-instruction op is not available: Delayed Abilities
 *   are created by the resolving spell, not owned by a permanent (393), so the
 *   existing timing registration hook cannot be represented by this program;
 * - "to a single battlefield" is a non-target play-location choice (355.10.b).
 *   LocationExpr can now choose a battlefield once, and effect.token can read
 *   that bound location. Its candidate query still needs the complete location
 *   list: the expression path only derives locations mentioned by objects and
 *   does not pass external LocationState for otherwise unrepresented fields;
 * - the Bomb definition (187.12) carries its own Deploy and Deathknell
 *   abilities, which the merged effect.token definition table still does not
 *   include.
 */
export default {
  canonicalCardId: "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) trigger.delayed 未注册，无法从法术结算创建独立于来源存续的延迟能力（390/391.2/393），" +
    "也无法将 effect.kill 的 killed 对象列表捕获为延迟执行时的固定数量；registerDelayedTrigger 钩子本身已存在。" +
    "(2) effect.token 仍缺 187.12 的 Bomb 定义及 Deploy/Deathknell 正文绑定（440.2.c 的链上创建/play 交接已存在）。" +
    "(3) 355.10.b 的单一战场非目标选择已能表达，但 LocationExpr 候选路径未接入完整 LocationState 列表，" +
    "只能从对象 location 推导战场，未覆盖不被这些位置引用的空战场。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "hexplosive-minefield.kill-bombs",
          op: "effect.kill",
          args: {
            target: { kind: "constant", value: "hexplosive-minefield.bomb-tokens" }
          },
          targets: [
            {
              id: "hexplosive-minefield.bomb-tokens",
              filter: { type: "gear", tags: ["Bomb"], controller: "self" },
              min: 0,
              max: null,
              selection: "up-to"
            }
          ]
        },
        {
          // "At end of turn, play that many Bomb tokens to a single
          // battlefield." Delayed ability created by this spell: window =
          // this turn (317.2.c), resolution at the turn-end timing point. No
          // merged op registers it (see judgeReason); the count is read from
          // the kill result.
          id: "hexplosive-minefield.delayed-play",
          op: "trigger.delayed",
          linkedTo: "hexplosive-minefield.kill-bombs",
          args: {
            at: { kind: "constant", value: "turn-end" },
            duration: { kind: "constant", value: "this-turn" },
            // "that many" — the Bomb tokens killed by the merged effect.kill
            // instruction above (linked under "killed"). Counting that list is
            // part of the pending trigger.delayed registration; the merged
            // effect.kill links the objects themselves, not a count.
            count: {
              kind: "linked-value",
              instructionId: "hexplosive-minefield.kill-bombs",
              key: "killed"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "hexplosive-minefield.choose-battlefield",
                  op: "condition.value",
                  args: {
                    value: {
                      kind: "location",
                      value: {
                        kind: "choose",
                        id: "hexplosive-minefield.battlefield",
                        filter: { type: "battlefield" }
                      }
                    }
                  }
                },
                {
                  id: "hexplosive-minefield.play-bombs",
                  op: "effect.token",
                  args: {
                    token: { kind: "constant", value: "bomb" },
                    mode: { kind: "constant", value: "play" },
                    // "that many" as bound by the delayed ability registration.
                    amount: {
                      kind: "linked-value",
                      instructionId: "hexplosive-minefield.delayed-play",
                      key: "count"
                    },
                    // All tokens share the one non-target location choice.
                    location: {
                      kind: "linked-value",
                      instructionId: "hexplosive-minefield.choose-battlefield",
                      key: "value"
                    },
                    linkKey: { kind: "constant", value: "bombTokens" }
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill any number of friendly Bomb tokens. At end of turn, play that many Bomb tokens to a single battlefield."
} satisfies CardProgram;
