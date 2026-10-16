import type { CardProgram } from "../../ir/index.js";

/**
 * Mushroom Pouch (ogn-101-298) — Gear, 2 energy, Mind.
 *
 * Printed text:
 *   At the start of your Beginning Phase, if you control a facedown card at a
 *   battlefield, draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 315.2.a.1: "At the start of Beginning Phase game effects take place" —
 *   the events/timing-points.ts `beginning-start` point (ruleRef 315.2.a.1).
 * - 107.3 / 107.3.e / 107.3.f: the Facedown Zone is a Public sub-zone of a
 *   battlefield and is not a location; 355.9.a.3: "Facedown card" refers to a
 *   card in a Facedown Zone unless specified otherwise.
 * - 355.10 / 355.10.c: "if you control a facedown card …" is a condition, not
 *   a target — nothing is chosen.
 * - 414.3: "Draw 1." is resolved with effect.draw; the implicit drawer is the
 *   ability controller (190.6.d).
 *
 * Status: judge-required — the trigger timing and the draw are both real, but
 * the intervening "if" clause cannot be evaluated with merged code:
 * - the trigger filter needs to select a "facedown card at a battlefield",
 *   and the engine's ObjectFilter has no facedown-zone spelling: zones are
 *   deck/hand/board/battlefield/base/rune-zone/… (107.3.e says a Facedown Zone
 *   is not a location, and 107.3.a makes it a sub-zone of a battlefield), and
 *   the ZoneId type has no facedown member; an object's `faceDown` flag is only
 *   readable through `states: \"face-down\"`, which no merged target/trigger
 *   query wires to a battlefield sub-zone;
 * - the real trigger path also needs the turn structure to emit
 *   `beginning-start` for the turn player (the turn/timing owner is unmerged;
 *   the chain layer only notices the point for its cleanup clock).
 * The draw half is executed in isolation by the golden test; nothing is
 * approximated to make the condition pass.
 */
const mushroomPouch = {
  canonicalCardId: "card.hash-689c116add3b0f95eb8a9545f336509a3e539abe5b910af8fb28caba8512f6ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺\"战场上你自己的面朝下牌\"的可求值条件：引擎 ObjectFilter/ZoneId 没有 Facedown Zone 拼写" +
    "（107.3.a/107.3.e：Facedown Zone 是战场的子区域、不是 location；ZoneId 无 facedown 成员），" +
    "faceDown 只能经 states 读取而没有任何已合入查询能把它限定到战场的 Facedown Zone（355.9.a.3）；" +
    "同时该触发依赖回合结构在回合玩家 Beginning Phase 发出 beginning-start（时点拥有者未合入，链层只把该点用于清理时钟）。" +
    "Draw 1（414.3）本身已合入并由 golden 单独执行；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // "your Beginning Phase" — the trigger belongs to the controller's own
        // turn; the turn player check is the timing owner's job.
        filter: {},
        condition: {
          kind: "compare",
          // "if you control a facedown card at a battlefield" — the
          // facedown-zone condition (see judgeReason).
          left: {
            kind: "count",
            subject: "facedown-cards",
            filter: {
              controller: "controller",
              zone: "battlefield",
              states: "face-down"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1."
} satisfies CardProgram;

export default mushroomPouch;
