import type { CardProgram } from "../../ir/index.js";

/**
 * Bounty Hunter (ogn-267-298) — Legend, Body/Chaos, tag Miss Fortune.
 *
 * Printed text:
 *   :rb_exhaust:: Give a unit [Ganking] this turn. (It can move from
 *   battlefield to battlefield.)
 *
 * Structure (contract 3.1/3.2):
 * - activated ability, action timing (default; CR 376), cost = exhaust this
 *   legend;
 * - "a unit" is a target (CR 355.5, 355.9.a.1: a Board unit; no controller
 *   restriction, so any unit on the Board is legal);
 * - "give a unit [Ganking] this turn" grants the Ganking keyword (CR 810;
 *   RIFT-83 merged the KeywordDef, stacking "single") until end of turn, i.e.
 *   a keyword-grant layer with an end-of-turn duration (contract 3.4 layers:
 *   copy → trait → ability → arithmetic).
 *
 * Status: judge-required:
 * - the body's `continuous.grant-keyword` opcode is merged (RIFT-258) and the
 *   golden test really executes the printed grant through the layers engine;
 * - the activated body and exhaust payment are bindable; what is still missing
 *   is dynamic keyword re-expansion and normalization to movement query routes.
 * Granting [Ganking] to an enemy unit is legal here (no controller filter), so
 * this is not covered by friendly-only keyword granting either.
 */
const program = {
  canonicalCardId:
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.grant-keyword 动态授予 Ganking 后的关键词重展开与到期撤销，" +
    "以及 Ganking 静态展开的 permission 字符串到 movement 查询 permission.routes 的适配。" +
    "仍需把授予任意玩家单位的关键词接入 movement.canGank 查询或可信 hasGanking 派生" +
    "（CR 810.1.c、144.4.c.1），并在回合结束撤销许可；不能用仅授予友方的近似替代。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: { payments: [{ kind: "exhaust" }] },
      body: [
        {
          id: "bounty-hunter.grant-ganking",
          op: "continuous.grant-keyword",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "bounty-hunter.unit" } },
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "bounty-hunter.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: Give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
