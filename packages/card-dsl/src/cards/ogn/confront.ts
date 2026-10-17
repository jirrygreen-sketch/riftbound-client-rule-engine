import type { CardProgram } from "../../ir/index.js";

/**
 * Confront (ogn-129-298) — Spell, 2 energy, Body.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Units you play this turn enter ready. Draw 1.
 *
 * Status: judge-required — the first sentence has no merged write path:
 * - "Units you play this turn enter ready" is an entry replacement, not a
 *   retroactive Ready: 359.2.c makes units enter exhausted, and 805.6.a's
 *   Accelerate wording is explicit that the replacement means "it does not
 *   enter exhausted and then become ready", so `effect.ready` cannot stand in
 *   (effect.ready's own docs say the same). The replacement binding module
 *   (RIFT-260) binds an entry replacement only as a `replacement` ability of
 *   the entering permanent itself (the Accelerate/"I enter ready" form, see
 *   replacement/README.md); no merged instruction opcode registers a
 *   temporary replacement effect for the rest of the turn, and the resolving
 *   spell cannot create a permanent ability on future units, so this-turn
 *   entry orientation for a set of future units has no write path.
 * - "Draw 1." is fully expressible with `effect.draw` (414.3) and is executed
 *   by the golden test. The two sentences are independent instructions, so the
 *   unmerged first half does not gate the draw; the card as a whole cannot be
 *   called executable while the first half is unimplemented, per README §2.
 *
 * The printed [Action] keyword is declared as a keyword ability (806 /
 * 159.2.a).
 */
const confront = {
  canonicalCardId: "card.hash-08362922ac97bb87d5bd7e14df1a5563c1526f85f472aaa9fb8d8cf6803d8fca",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“本回合未来单位入场就绪”的写入路径：契约 3.6 封闭 GameAction 集合没有“入场时改为就绪”的替代动作，" +
    "359.2.c 规定单位横置入场、805.6.a 明确入场替代不是“先横置再就绪”，故 effect.ready 不能替代。" +
    "RIFT-260 的 replacement 绑定（replacement.enter）只把「进入者自身的永久入场替代」绑定到该永久物" +
    "（replacement/README.md 的 Accelerate/“I enter ready”形态），而本卡是结算期法术为“本回合之后打出的" +
    "一组未来单位”授予临时替代效果：没有指令原语能为本回合注册临时替代效果，结算中的法术也不能给未来单位生成永久能力。" +
    "依赖：结算期临时替代效果注册原语 + 一组未来单位的入场替代写入路径。Draw 1 部分仅用已合入的 effect.draw，由 golden 测试真实执行。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Units you play this turn enter ready" — described via the
          // replacement.enter contract shape. No merged opcode consumes it yet
          // (see judgeReason). The scope is "this turn" and it applies to the
          // controller's units played afterwards (a set condition, not a
          // target: 355.10.d programmatic selection).
          id: "enter-ready-this-turn",
          op: "replacement.enter",
          args: {
            duration: { kind: "constant", value: "this-turn" },
            exhausts: { kind: "constant", value: false },
            appliesTo: {
              kind: "constant",
              value: { type: "unit", controller: "self" }
            }
          }
        },
        {
          // "Draw 1." — an independent sentence; it is not linked to the
          // replacement clause (359.3.e.14 links only referenced instructions).
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Units you play this turn enter ready. Draw 1."
} satisfies CardProgram;

export default confront;
