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
 * - the layers engine (RIFT-91) consumes registered ContinuousEffectSpec
 *   entries and can add / remove keywords, but there is no merged instruction
 *   primitive that registers a keyword grant from a card body: the frozen
 *   effects/instructions set has no `continuous.grant-keyword` (or
 *   `continuous.keyword`) opcode, so the body cannot execute at all;
 * - granting [Ganking] to an enemy unit is legal here (no controller filter),
 *   so this is not covered by friendly-only keyword granting either.
 * The declarative instruction below records the granted keyword, the duration
 * and the target; execution waits for the continuous-keyword instruction
 * primitive (RIFT-9 survey `continuous.keyword`) and the P2 batch-6 card-program
 * wiring.
 */
const program = {
  canonicalCardId:
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a unit [Ganking] this turn」需要带 end-of-turn 期限的持续关键词授予：RIFT-91 已合入 layers 消费者与 duration 机制，Ganking 的 KeywordDef（RIFT-83，stacking single）也已合入，" +
    "但 effects/instructions 没有任何已注册的原语能由卡牌 body 注册关键词授予（无 continuous.grant-keyword / continuous.keyword 文件），因此本条指令当前无法执行。" +
    "目标为印刷原文 “a unit”（CR 355.9.a.1：未另作说明时指 Board 上的单位），过滤器不带控制者限制；因此在 KeywordDef 落地前不能按 friendly-only 关键词授予近似实现。" +
    "依赖：RIFT-9 清单的 continuous.keyword 原语与 P2 批 6 卡牌 IR 生产接线。",
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
