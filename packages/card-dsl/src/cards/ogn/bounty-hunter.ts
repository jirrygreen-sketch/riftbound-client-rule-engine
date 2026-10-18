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
 *   legend (CR 415.5);
 * - "a unit" is a target (CR 355.5, 355.9.a.1: a Board unit; no controller
 *   restriction, so any unit on the Board is legal);
 * - "give a unit [Ganking] this turn" grants the Ganking keyword (CR 810;
 *   KeywordDef stacking "single") with an end-of-turn duration (CR 317.2.c).
 *
 * Status: judge-required — the merged continuous.grant-keyword instruction
 * registers the grant, describeActivate binds the exhaust cost and target
 * Finalize, and the merged KeywordGrantLayerEngine re-expands the dynamically
 * granted Ganking into the battlefield-to-battlefield movement permission,
 * revoking it at turn end when a ChainEngine fixture attaches that engine.
 * Production assembly still wires the plain LayerEngine (chain/engine.ts and
 * the runCardScenario default), so the printed battlefield-to-battlefield
 * permission (CR 810.1.c) stays unreachable through the default chain path.
 */
const program = {
  canonicalCardId:
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.grant-keyword 授予、Exhaust 费用与 Board 单位目标的打出路径已可执行：" +
    "golden 测试真实支付 Exhaust、锁定目标并在 ability 图层登记 Ganking，回合结束到期。" +
    "生产链结算中该动态授予的 Ganking 不会重展开为 movement 许可：生产装配仍用普通 " +
    "LayerEngine（chain/engine.ts 与 runCardScenario 默认），未接入 KeywordGrantLayerEngine，" +
    "故 CR 810.1.c 的战场间 Standard Move 许可不可达，可信 hasGanking 派生也未接入生产 movement 查询；" +
    "该重展开只在显式装配该引擎的 " +
    "ChainEngine fixture 中证明，不能代表生产路径，整卡因此保持 judge-required。",
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
