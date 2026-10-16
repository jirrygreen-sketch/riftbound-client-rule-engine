import type { CardProgram } from "../../ir/index.js";

/**
 * Unchecked Power (ogn-123-298) — Spell, 7 energy + 2 Mind power.
 *
 * Printed text:
 *   Exhaust all friendly units, then deal 12 to ALL units at battlefields.
 *
 * Status: judge-required — the damage half is a programmatically selected set
 * with no merged write path:
 * - "Exhaust all friendly units" is a set, so it is NOT targeted (355.10.d).
 *   It is declared as a non-target pick (contract 3.1 `picks`), and
 *   `effect.exhaust` consumes it with its default amount (every eligible
 *   pick member, 415.1.b/c skip already-exhausted members). The golden test
 *   executes exactly this instruction on the reference kernel with real bound
 *   picks. The pick's `filter` records the rules-side set (friendly units,
 *   740.1.a/740.1.b spellings `self`/`opponent` that chain/engine.ts#context
 *   normalizes); the reference kernel compares filter values literally, so it
 *   binds the refs instead of evaluating the placeholder — the same split the
 *   merged pit-rookie golden documents.
 * - "Deal 12 to ALL units at battlefields" is again a set, and 355.10.d's
 *   counter-example is exactly this shape ("Kill all units at battlefields"
 *   does not target anything). It also names a location (355.10.b/355.10.d),
 *   so the set is neither a plain query nor a TargetSpec: the merged
 *   `effect.damage` consumes only a Finalize-locked TargetSpec id, and there is
 *   no merged query/place-intersection form for a multi-battlefield set. The
 *   described instruction carries that unmerged shape and does not execute.
 * - The "then" ordering is preserved by declaring the damage after the
 *   exhaust; the halves are not `linkedTo` each other because neither
 *   references the other's result (359.3.e.14 links references, not ordering).
 */
const uncheckedPower = {
  canonicalCardId: "card.hash-a418de860e5d4f594ad26cc274c4676c980ce6ba498a515c0375e939cc6fad94",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "第二个半段是程序化集合而非目标（355.10.d，其反例正是 “Kill all units at battlefields”）：" +
    "“Deal 12 to ALL units at battlefields” 既指定地点（355.10.b/d）又不是可表达集合——已合入的 effect.damage 只消费 " +
    "Finalize 锁定的 TargetSpec，多战场集合没有 query/地点交集形式，也没有指令原语可注册该集合；依赖 RIFT-90 目标系统与 " +
    "target.location / target.many（RIFT-9）。“Exhaust all friendly units” 半段用 effect.exhaust 的非目标 picks 集合形式，" +
    "由 golden 在参考内核上真实执行。两半均不声明为 targets、不近似、不手改状态。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Exhaust all friendly units" — a non-target set (355.10.d), so no
          // TargetSpec is declared. `effect.exhaust`'s pick form exhausts every
          // eligible member when no amount is given.
          id: "exhaust-friendly-units",
          op: "effect.exhaust",
          args: { pick: { kind: "constant", value: "unchecked-power.friendly-units" } },
          picks: [
            {
              id: "unchecked-power.friendly-units",
              options: ["dynamic:friendly-units"],
              selection: "all",
              filter: { type: "unit", controller: "self" }
            }
          ]
        },
        {
          // "then deal 12 to ALL units at battlefields" — set damage, not
          // targets. Every affected unit takes the full 12: the amount is fixed
          // per unit, so 355.14 splitting does not apply.
          id: "deal-12-at-battlefields",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 12 },
            target: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", location: "battlefield" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText: "Exhaust all friendly units, then deal 12 to ALL units at battlefields."
} satisfies CardProgram;

export default uncheckedPower;
