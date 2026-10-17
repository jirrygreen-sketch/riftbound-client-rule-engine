import type { CardProgram } from "../../ir/index.js";

/**
 * Tibbers, Annie (ogs-018-024).
 * CR v1.5 383.4.a/420.4.a: self card-played trigger.
 * CR 355.10.d: "all units at battlefields" is an automatic non-target set,
 * so instruction.targets must not turn this into targeting (355.7, 754).
 * effect.damage still only reads TargetSpec groups; setFilter is descriptive,
 * not an executable selector. Non-target collection damage and simultaneous
 * application (418.1.c/418.1.d) remain blockers. The source-bound trigger and
 * isolated targeted-damage primitive tests do not establish full-card support.
 */
export default {
  canonicalCardId: "card.hash-71a433d035b3ceed303ac22a2952e428f4da5dc252f95947d82c3325d1b6f0e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.damage 非目标集合伤害路径：deal 3 to all units at battlefields 按 CR 355.10.d 是自动集合选择，不应声明 TargetSpec 或触发 became-target。当前 effect.damage 只经 ctx.targets(TargetSpec id) 读取对象，setFilter 未被消费；还需按 CR 418.1.c/418.1.d 同时应用该集合的伤害。依赖：非目标 query 选择符与同时集合伤害结算（契约变更请求）。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "tibbers-annie.damage-all-at-battlefields",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            setFilter: {
              kind: "constant",
              value: { type: "unit", zone: "board", locationType: "battlefield" }
            }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, deal 3 to all units at battlefields."
} satisfies CardProgram;
