import type { CardProgram } from "../../ir/index.js";

/**
 * Rebuke (ogn-172-298) — Spell, 2 energy + 2 Chaos Power, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Return a unit at a battlefield to its owner's hand.
 *
 * Modeling notes (Core Rules v1.5):
 * - `action` keeps the printed [Action] keyword (806; 159.2.a); its
 *   `continuous.timing` expansion and the chain admission are owned by the
 *   keyword registry and chain/ (contract 3.7).
 * - The unit is a plain target (355.7 / 355.9.a.1); "at a battlefield" is a
 *   targeting restriction on that unit rather than a second target
 *   (355.10.b), recorded as `location: "battlefield"` (the frozen ObjectFilter
 *   spelling: events/trigger-spec.ts `location?: string`, consumed by
 *   layers/filter.ts as either the location name or an exact Location).
 * - The instruction is the merged effect.zone primitive ("return … to its
 *   owner's hand" — a zone change, 448.2); the action layer routes the object
 *   to its OWNER's hand (108.1 / 359.3.e.9's "returns the friendly unit to its
 *   owner's hand").
 * - CR 359.3.e.9's Rebuke example: if the chosen unit leaves the battlefield
 *   (here: moves to its Base) before resolution, the choice is Mistargeted and
 *   the instruction does not execute. Re-verification of the locked target
 *   against the declared filter is the TargetPlan's job
 *   (target/target-plan.ts resolveTargetPlan); the primitive drops references
 *   that are no longer valid at all (359.3.e.6-e.8), which the golden test
 *   checks.
 * - Printed cost (2 Energy plus 2 Chaos Power) is bound from the card identity
 *   at Finalize (356.1.c); the program declares no CostSpec instead of
 *   re-stating printed values.
 *
 * Status: judge-required — the effect body uses only merged primitives and is
 * executed in the golden test, but the printed [Action] line cannot be honoured
 * yet: keywords/Action.ts expands to a `continuous.timing` static ability
 * (806.1.c / 159.2.a) with no merged consumer (RIFT-91 layers), and the chain
 * does not read declared keywords — ChainEngine.canAct() gates a Showdown play
 * on the caller-supplied draft.speed, and no CardProgram -> ChainDraft adapter
 * exists (chain/engine.ts describePlay). Two further gates stay TODO with task
 * numbers: the location restriction re-check at resolution (359.3.e.9's Rebuke
 * example, owned by the TargetPlan resolve path, RIFT-90) and cost payment
 * (RIFT-84/85).
 */
const rebuke = {
  canonicalCardId: "card.hash-b729f880ae397e8eedd9b1e93aaab464d98abc273a98ec06ba2e03bf7c0c97a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Action] 时机许可的可执行路径：keywords/Action.ts 只展开为 static continuous.timing（806.1.c / 159.2.a），图层消费方尚未合入（RIFT-91），" +
    "链侧 canAct() 取决于调用方提供的 draft.speed，且没有 CardProgram → ChainDraft 打出适配（chain/engine.ts describePlay 未实现）。" +
    "effect.zone 半段（战场单位 → 拥有者手牌）只用已合入原语并有执行测试；359.3.e.9 的「离开战场即 Mistarget」重验由 TargetPlan resolve 负责（RIFT-90），依赖 RIFT-84/85/90/91。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "rebuke.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "rebuke.unit-at-battlefield" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "rebuke.unit-at-battlefield",
              filter: { type: "unit", zone: "board", location: "battlefield" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Return a unit at a battlefield to its owner's hand."
} satisfies CardProgram;

export default rebuke;
