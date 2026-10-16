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
 * Status: judge-required. The kill half executes; the delayed half does not:
 * - there is no card-facing delayed-instruction op (RIFT-9 trigger.delayed):
 *   ResolveContext.registerDelayedTrigger exists (contract 3.6) but no merged
 *   opcode consumes it, and a card-owned triggered ability would be wrong (393:
 *   Delayed Abilities are created by the resolving spell, not owned by a
 *   permanent);
 * - "play ... Bomb tokens" needs chain creation plus a play destination
 *   (440.2.c / 185.2.a / 350.2 / 354). effect.token requires exactly one
 *   destination argument for mode "play" and rejects a base whose player is not
 *   a resolved PlayerId, so "to a single battlefield" (a resolution-time
 *   battlefield choice, 355.9.a.4) has no resolvable location expression;
 * - the Bomb definition (187.12) carries its own Deploy and Deathknell
 *   abilities, which the frozen effect.token definition table deliberately does
 *   not include.
 */
export default {
  canonicalCardId: "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "消灭半边可由已合入的 effect.kill 执行（any number 可为零，355.13；见 golden 测试）；其余未合入：" +
    "(1)「At end of turn, play that many Bomb tokens …」是本法术创建的延迟能力（390/391.1/391.2，窗口为本回合 317.2.c），" +
    "需要卡牌可用的 trigger.delayed 指令（ResolveContext.registerDelayedTrigger 已存在，但指令注册表无对应 op；" +
    "按 393 也不能写成卡自身的触发能力），依赖 RIFT-9 trigger.delayed；" +
    "(2)「play … Bomb tokens」需要链上创建 + 结算时选择单一战场作为目的地（440.2.c/185.2.a/350.2/354），" +
    "effect.token 的 mode:\"play\" 必须且只能给出一个 destination，且 base 的 player 不是已解析 PlayerId 时会被拒绝，" +
    "现有表达式无法给出「结算时选定的战场」；" +
    "(3) Bomb gear token 定义（187.12，自带 Deploy 与 Deathknell）不在 effect.token 的冻结定义表内。" +
    "依赖：RIFT-9 trigger.delayed 与 token 链上创建 / 地点选择（RIFT-62/RIFT-90）；不近似实现。",
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
                    // "to a single battlefield": one battlefield, chosen as
                    // the delayed ability resolves, is the destination shared
                    // by every token played this way.
                    locations: {
                      kind: "constant",
                      value: [{ type: "battlefield", id: "hexplosive-minefield.chosen-battlefield" }]
                    },
                    choiceId: { kind: "constant", value: "hexplosive-minefield.battlefield" },
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
