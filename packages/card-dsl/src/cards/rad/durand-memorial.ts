import type { CardProgram } from "../../ir/index.js";

/**
 * durand-memorial — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
export default {
  canonicalCardId: "card.hash-97d6652832570169cee7f8ada60deed43c5e7d3c133950eed2de4fe1f0818f76",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 466.2.c：combat/flow.ts 仍以 combat-start-transaction 阻塞角色指定及 defense-declared 生产。CR 355.5/355.10：programs/filters.ts 未绑定触发的 here 与目标 sameLocationAs，解释器查询锚点已可执行，生产触发/Finalize 仍不可达。CR 815.1.c.1/815.1.c.2：base-combat-allocation.ts 未消费 Tank 的致命伤害优先指派要求；continuous.grant-keyword 的授予与战斗结束到期已支持，但不能代替伤害指派规则。",
  sourceText:
    "When you defend here, choose a unit you control here. Give it [Tank] this combat. (It must be assigned combat damage first.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "durand-memorial.grant-tank",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Tank" },
            duration: { kind: "constant", value: "end-of-combat" },
            objects: { kind: "constant", value: { kind: "target", id: "durand-memorial.chosen-unit" } }
          },
          targets: [
            {
              id: "durand-memorial.chosen-unit",
              filter: {
                type: "unit",
                controller: "controller",
                zone: "board",
                sameLocationAs: "self"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
