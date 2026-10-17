import type { CardProgram } from "../../ir/index.js";

/**
 * Defy (ogn-045-298) — Spell, 1 energy + 1 Calm power (Calm).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Counter a spell that costs no more than :rb_energy_4: and no more than :rb_rune_rainbow:.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword granted by the keyword registry
 *   (contract 3.7): the card only names it, the chain's timing permission owns
 *   the Closed State admission (813.1.c.1, 309.1.a, 159.2.b.3).
 * - "Counter a spell ..." is the merged effect.counter primitive (426.1-426.3:
 *   the countered card does nothing, is cleared from the chain and its costs
 *   are not refunded). The spell is a target on the chain (355.9.a.2); pending
 *   chain items are not legal targets (contract 3.4) and a spell cannot target
 *   itself (355.9.c) — both are the target system's Finalize obligations
 *   (RIFT-359), not card data.
 *
 * Status: judge-required — the cost restriction is not expressible:
 * - "a spell that costs no more than [4] and no more than [A]" restricts
 *   target legality by the target's *printed or copied* cost (CR 206 and its
 *   Defy example: only the printed/copied cost is checked, so a paid Repeat
 *   cost is irrelevant). The frozen TargetSpec filter can only carry values
 *   compared key-by-key (type/tag/controller/zone/location plus extension
 *   keys); no merged target predicate compares a chain item's printed Energy
 *   cost or its printed Power requirement, and ObjectSnapshot exposes energy
 *   and the current Power list, not the printed/copied cost pair.
 * - Approximation is forbidden (red line): a filter without the cost
 *   restriction would let the card counter any spell. The restriction is
 *   therefore declared with descriptive keys (energyMax / powerMax) that no
 *   merged code evaluates, and the card stays judge-required until a
 *   cost-predicate target filter or a "printed cost" target expression lands.
 * The counter instruction itself (target chain spell + effect.counter) is
 * executed by the golden test with a caller-locked Finalize target.
 *
 * Measured 2026-10-17: RIFT-359 landed only the event/cost condition
 * predicates (played-from-*, printed-characteristic, result). None of them is a
 * TargetSpec filter, and programs/filters.ts translateObjectFilter still
 * throws "Unsupported filter field energyMax" when the card's own program is
 * described through describePlay, so the restriction has no legal-target
 * consumer. The descriptive keys stay declared rather than being dropped.
 */
const defy = {
  canonicalCardId: "card.hash-62dafcca4e54056f0f4c441cffa5d06b600b5993b1e3cbd18574fe8feb466684",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「按目标印刷费用限制目标合法性」的过滤器：CR 206 要求只比较目标法术的印刷/复制费用" +
    "（其 Defy 示例明确已支付的 Repeat 费用不参与判断），但冻结的 TargetSpec filter 只能逐键比较" +
    "type/tag/controller/zone/location 等字段，没有任何已合入的目标谓词能读取链上法术的印刷 Energy 费用" +
    "或印刷 Power 需求；ObjectSnapshot 暴露的是当前 energy 与 Power 列表，不是印刷/复制费用。" +
    "2026-10-17 实测：RIFT-359 只合入了事件/费用条件谓词（played-from-*、printed-characteristic、result），" +
    "没有一个是 TargetSpec 过滤器；programs/filters.ts 的 translateObjectFilter 对本卡自己的程序仍抛" +
    "「Unsupported filter field energyMax」，describePlay 无法产出可定案的草稿，因此该限制没有目标合法性消费方。" +
    "不近似实现（去掉费用限制会把「反制任意法术」写成事实）；限制以未实现的描述性键 energyMax/powerMax 保留。" +
    "effect.counter（426.1-426.3）与 [Reaction]（813）本身已合入并由 golden 真实执行。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell that costs no more than :rb_energy_4: and no more than :rb_rune_rainbow:.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "counter-spell",
          op: "effect.counter",
          args: { target: { kind: "constant", value: "costed-spell" } },
          targets: [
            {
              id: "costed-spell",
              // "a spell" is a target on the chain (355.9.a.2). energyMax /
              // powerMax are the descriptive part of CR 206's restriction
              // (printed cost only); no merged predicate evaluates them, so
              // this target group is not legally finalized today.
              filter: {
                type: "spell",
                zone: "chain",
                energyMax: 4,
                powerMax: 1
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

export default defy;
