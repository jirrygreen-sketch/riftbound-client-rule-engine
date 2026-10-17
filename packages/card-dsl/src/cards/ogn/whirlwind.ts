import type { CardProgram } from "../../ir/index.js";

/**
 * Whirlwind (ogn-187-298) — Spell, 3 energy + 1 Chaos Power, Chaos.
 *
 * Printed text:
 *   Starting with the next player, each player may return a unit to its
 *   owner's hand.
 *
 * Structure (contract 3.1 / 3.2 / 3.9, Core Rules v1.5):
 * - "may" is modelled as choice.optional with the chosen instruction wrapped
 *   in its "body" (contract 3.9; a leading choice plus a linkedTo instruction
 *   is explicitly rejected by the validator).
 * - "return a unit to its owner's hand" does NOT target. The instruction is
 *   part of a set of objects chosen by the acting players themselves
 *   (CR 355.10.e: "Each player kills a unit they control" does not target;
 *   the choice happens as the spell resolves), so it is a non-target PickSpec
 *   feeding the merged effect.zone primitive. The action layer routes the card
 *   to its OWNER's hand (108.1 / 359.3.e.9).
 *
 * Status: judge-required — the optional-return half uses only merged
 * primitives (choice.optional + effect.zone) and is executed in the golden
 * test, but the per-player iteration has no merged execution path:
 * - "Starting with the next player, each player" is an ordered iteration over
 *   players. The merged IR executes one body under a single ResolveContext: the
 *   interpreter reads picks from ctx.picks(id) (interpreter.ts) and has no
 *   per-player loop or chooser-bound pick (contract 3.6), and the frozen
 *   opcode list has no player-selection/iteration primitive
 *   (ability-templates.md target.player is unmerged). A fixed "repeat" count
 *   would hard-code the number of players, and the starting player is
 *   resolved from the turn order, which the data layer cannot name.
 * - Each iteration also has its own chooser: the decision belongs to the
 *   player being asked at that point in the order, while a single
 *   choice.optional in the merged body asks the ability controller
 *   (choice.optional's chooser defaults to ctx.controller, interpreter/choice.ts).
 *   "a unit" itself is unrestricted on purpose — the printing names no
 *   controller, so the pick deliberately carries no player filter.
 * - The card-program -> chain adapter (describePlay) is likewise unmerged
 *   (RIFT-257), so even the single-chooser half has no production entry.
 * Until the per-player choice/iteration work lands, this card stays
 * judge-required rather than approximating "each player" with the caster's
 * choices.
 */
const whirlwind = {
  canonicalCardId: "card.hash-c976afe00288482575b7680eb7b742f74eaeb3aac7fab39be31717e7986af99f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Starting with the next player, each player」的逐玩家顺序迭代：已合入 IR 是单一 body + 单一 ResolveContext，" +
    "pick 只能一次性从 ctx.picks(id) 读取（契约 3.6 无按玩家迭代），封闭 opcode 表没有玩家迭代/选择原语（ability-templates.md target.player 未实现），" +
    "按固定次数 repeat 会把玩家人数写死、也无法指明起始玩家（回合顺序在数据层不可命名）；" +
    "同时每次迭代的 chooser 应是「被询问的那名玩家」，而单个 choice.optional 只会问能力控制者（interpreter/choice.ts 默认 ctx.controller）。" +
    "choice.optional + effect.zone 半段只用已合入原语并有执行测试；整卡还缺 CardProgram → ChainDraft 的 describePlay 适配（RIFT-257）。" +
    "依赖：target.player / pick chooser 落地与 RIFT-257。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "whirlwind.each-player",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Return a unit to its owner's hand?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "whirlwind.return-unit",
                  op: "effect.zone",
                  args: {
                    pick: { kind: "constant", value: "whirlwind.unit" },
                    to: { kind: "constant", value: "hand" },
                    amount: { kind: "constant", value: 1 }
                  },
                  picks: [
                    {
                      id: "whirlwind.unit",
                      // 结算时由「该选择者」从场上的单位里选一个（355.10.e 非目标）；
                      // 原文未限定控制者，故过滤器不带 player 条件。
                      options: ["dynamic:one-unit-on-the-board"],
                      min: 1,
                      max: 1,
                      selection: "one",
                      filter: { type: "unit", zone: "board" }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Starting with the next player, each player may return a unit to its " +
    "owner's hand."
} satisfies CardProgram;

export default whirlwind;
