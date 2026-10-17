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
 * - "play ... Bomb tokens" needs chain creation plus a play destination
 *   (440.2.c / 185.2.a / 350.2 / 354). effect.token requires exactly one
 *   destination argument for mode "play"; "to a single battlefield" is a
 *   resolution-time battlefield choice (355.9.a.4) and neither the frozen Expr
 *   vocabulary nor the ObjectSelector set can enumerate the current legal
 *   battlefields, so the destination has no resolvable location expression
 *   (the location machinery needs the current position-choice contract);
 * - the Bomb definition (187.12) carries its own Deploy and Deathknell
 *   abilities, which the merged effect.token definition table still does not
 *   include.
 */
export default {
  canonicalCardId: "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "消灭半边由已合入的 effect.kill 真实执行（any number 可为零，355.13；golden 用卡内原始指令 + 链解释器适配器执行并断言事件与区域）；其余三点仍未合入：" +
    "(1)「At end of turn, play that many Bomb tokens …」是本法术创建的延迟能力（390/391.1/391.2，窗口为本回合 317.2.c），" +
    "需要卡牌可用的 trigger.delayed 指令；延迟能力由结算中的法术创建而不是由永久物持有（393），" +
    "当前程序无法把该延迟注册绑定到法术结算；" +
    "(2)「play … Bomb tokens」的目的地是结算时选择的单一战场（440.2.c/185.2.a/350.2/354、355.9.a.4）：" +
    "effect.token 的 mode:\"play\" 必须且只能给出一个 destination，而冻结的 Expr 词汇与 ObjectSelector 集合都无法枚举「当前合法战场」，" +
    "地点选择需要当前的位置选择契约（RIFT-357）；" +
    "(3) Bomb gear token 定义（187.12，自带 Deploy 与 Deathknell）仍不在 effect.token 的已实现定义表内。" +
    "依赖：法术创建的延迟能力绑定、RIFT-357 的地点选择与 Bomb token 能力定义；不近似实现。",
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
