import type { CardProgram } from "../../ir/index.js";

/**
 * Time Warp (ogn-122-298) — Spell, 10 energy + 4 Mind power.
 *
 * Printed text:
 *   Take a turn after this one. Banish this.
 *
 * Status: judge-required — the first sentence has no merged write path:
 * - 734/735 define the Additional Turn: the effect inserts a temporary turn
 *   owned by that player into the turn queue after the current one. Contract
 *   3.6's closed GameAction set has no turn-queue action, `turn/` exposes no
 *   queue insertion, and the merged timing points do not include an Additional
 *   Turn boundary; no instruction opcode can produce it. Not approximated by
 *   skipping a phase or reusing a turn-start timing point.
 * - "Banish this." is fully expressible: `effect.banish` with the `"source"`
 *   ObjectSelector (contract 3.6) banishes the spell itself to its owner's
 *   Banishment (428.1-428.5; 418-free since this is not a damage action). The
 *   engine-core primitive test for this card already executes that clause; the
 *   golden test here drives it through the production chain adapter. The two
 *   sentences are independent instructions, so the unmerged first half does
 *   not gate the banish; the card as a whole stays judge-required per README §2.
 */
const timeWarp = {
  canonicalCardId: "card.hash-037ac90c7e1ee070f9dea523811caa91e2b1f5c8018e4cc7753149ebb5eba7d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺回合队列写入路径：734/735 规定 “take a turn after this one” 由效果在回合队列当前回合之后插入一个该玩家的临时 Additional Turn，" +
    "而契约 3.6 的封闭 GameAction 集合没有回合队列动作，turn/ 无队列接口、时点枚举也无 Additional Turn 边界，" +
    "没有任何已合入指令原语可产生它（不得用跳过阶段或复用 turn-start 近似）。" +
    "“Banish this.” 仅用已合入的 effect.banish 与 source 选择器，由 golden 测试经生产链适配器真实执行。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Take a turn after this one" — described via the Additional Turn
          // contract shape (734/735). No merged opcode consumes it yet.
          id: "take-turn-after-this",
          op: "effect.additional-turn",
          args: {
            owner: { kind: "constant", value: "controller" },
            after: { kind: "constant", value: "this-turn" }
          }
        },
        {
          // "Banish this." — the source selector resolves to the spell itself;
          // an independent sentence, so no linkedTo (359.3.e.14).
          id: "banish-this",
          op: "effect.banish",
          args: { objects: { kind: "constant", value: "source" } }
        }
      ]
    }
  ],
  sourceText: "Take a turn after this one. Banish this."
} satisfies CardProgram;

export default timeWarp;
