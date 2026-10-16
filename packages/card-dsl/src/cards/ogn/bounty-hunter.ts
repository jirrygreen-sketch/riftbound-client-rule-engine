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
 * - what is still missing is the card-program binding layer (RIFT-257):
 *   nothing registers a card ability's activated body with the chain, so the
 *   activated ability itself never runs in the production path, and the
 *   granted Ganking is not derived into the movement path's hasGanking.
 * Granting [Ganking] to an enemy unit is legal here (no controller filter), so
 * this is not covered by friendly-only keyword granting either.
 */
const program = {
  canonicalCardId:
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a unit [Ganking] this turn」所需的持续关键词授予已可用：continuous.grant-keyword 原语（RIFT-258，含 end-of-turn 期限）与" +
    "Ganking 的 KeywordDef（stacking single）均已合入，本卡测试真实执行该指令并验证目标获得 Ganking、回合结束到期。" +
    "仍缺卡牌程序绑定层（RIFT-257）：没有已合入路径把卡牌的 activated 能力注册进链，也无法把授予后的 Ganking 派生给生产移动路径的 hasGanking，" +
    "故“支付横置、给任意单位 Ganking 并能实际战场间移动”的整卡链路不可执行。" +
    "目标为印刷原文 “a unit”（CR 355.9.a.1：未另作说明时指 Board 上的单位），过滤器不带控制者限制，不按 friendly-only 近似实现。" +
    "依赖：RIFT-257 卡牌程序绑定与移动许可派生接线。",
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
