import type { CardProgram } from "../../ir/index.js";

/**
 * Fight or Flight (ogn-168-298) — Spell, 2 energy, Chaos.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Move a unit from a battlefield to its base.
 *
 * Structure (contract 3.1 / 3.2, Core Rules v1.5):
 * - `hidden` (811) and `action` (806) are declared as keyword abilities and
 *   expanded by the keyword registry (contract 3.7). Hidden's expansion owns
 *   the Hide discretionary action, the facedown zone and the reduced-cost play
 *   from facedown; Action's expansion is the `continuous.timing` static grant.
 * - "Move a unit from a battlefield to its base." is one `effect.move`
 *   instruction (451: spells may cause a Move). "at a battlefield" restricts
 *   target legality (355.9.b); `location: "battlefield"` is the frozen object
 *   filter spelling for a Location restriction (events/trigger-spec.ts
 *   `ObjectFilter.location`, layers/filter.ts). "its base" is the unit's
 *   controller's Base (107.1.c), which `controller-base` resolves per object at
 *   resolution; the Move destination is fixed by the text, so no 355.4 choice
 *   is involved.
 *
 * Status: judge-required — the Move half is expressible and executed by the
 * golden test, but the printed [Hidden] half is not executable:
 * keywords/Hidden.ts expands to `cost.hidden`, and its own header records that
 * the Hide action, the facedown-zone restrictions and the free play from the
 * facedown zone are not merged. The continuous.timing primitive and its
 * canAct consumer are already present; the cost.hidden consumer still must
 * grant the "react with later" permission. Without that path
 * "Hide now … to react with later" cannot be performed, so the card
 * cannot be called executable (cards README §2/§5).
 */
const fightOrFlight = {
  canonicalCardId: "card.hash-ae89acfc3272efb2e11f1ffd438022efc8a49ff3d3e37cfa6ede1a1b15bffca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Hidden] 的可执行路径：keywords/Hidden.ts 的展开依赖 cost.hidden 的 Hide 行动、facedown 区域限制与从 " +
    "facedown 免费打出，以及将后续 Reaction 许可接入现有 continuous.timing/canAct；这些 cost.hidden 与卡牌绑定缺口依赖 RIFT-257、RIFT-261。" +
    "「Hide now for [A] to react with later for [0]」无法执行。Move 半段只用已合入的 effect.move 表达并有执行测试。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷费用（2 energy，power null）由卡牌本体决定；Finalize 默认按 printed 结算。
      body: [
        {
          id: "fight-or-flight.move-to-base",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "fight-or-flight.unit" } },
            to: { kind: "constant", value: "controller-base" }
          },
          targets: [
            {
              id: "fight-or-flight.unit",
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move a unit from a battlefield to its base."
} satisfies CardProgram;

export default fightOrFlight;
