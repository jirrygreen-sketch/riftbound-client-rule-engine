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
 *   (effect.ready's own docs say the same). The replacement.enter primitive
 *   family (RIFT-9 ability-templates lists it, and sfd-071-221's Breakneck
 *   Mech entry replacement depends on the same work) is not merged, and no
 *   merged instruction opcode exists to register a temporary replacement
 *   effect for the rest of the turn — only the `replacement` ability form can
 *   declare it, which is a permanent card ability, not a this-turn grant.
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
    "缺入场替代写入路径：契约 3.6 封闭 GameAction 集合没有“入场时改为就绪”的替代动作，" +
    "359.2.c 规定单位横置入场、805.6.a 明确入场替代不是“先横置再就绪”，故 effect.ready 不能替代；" +
    "当前也没有已合入的指令原语能为“本回合”注册临时替代效果（只有永久卡片能力形式的 replacement），" +
    "依赖 replacement.enter 家族（RIFT-9 模板，同 sfd-071-221）落地。Draw 1 部分仅用已合入的 effect.draw，" +
    "由 golden 测试真实执行。",
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
