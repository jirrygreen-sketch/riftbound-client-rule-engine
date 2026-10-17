import type { CardProgram } from "../../ir/index.js";

/**
 * rad-072-167 Overloaded Traveler (Spell, 2 energy, Body).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-072-167):
 * energy 2, power null, might 2, domains ["Body"], tags [].
 * `power: null` means there is no printed power. The card prints no play cost
 * clause either; the static ability below is the whole card (see the data
 * problem), so no CostSpec is invented for it.
 *
 * Printed text (verbatim, sourceText):
 *   "While there's a friendly gear with [Deploy] at my battlefield, I have
 *    +1 :rb_might:."
 *
 * Card-type data problem (reported, not fixed here): the catalog types this
 * printing as `Spell` with Might 2, but the text is a permanent unit's static
 * ability ("While ... I have +1 :rb_might:", 143.2; the reference to "my
 * battlefield" is a Unit's location, 107.2). A spell resolves and is placed in
 * the Trash and has no Might (CR v1.5 157/351.2), so "I have +1 Might" cannot
 * apply to it; printed Might on a Spell is itself inconsistent (143.2 defines
 * Might as the combat statistic of a Unit). rad-016-167, rad-046-167,
 * rad-064-167, rad-069-167, rad-097-167, rad-130-167 and rad-131-167 have
 * related mismatches. The real card type is not invented here.
 *
 * Rules reading (CR v1.5):
 * - "While there's a friendly gear with [Deploy] at my battlefield, I have +1
 *   Might" is a Passive Ability: a continuous Might modification of the source
 *   unit, conditional on a set query (143.2 Might; 830 Deploy as a gear
 *   characteristic, checked by "[Deploy]" per 830.3; "my battlefield" = the
 *   location of the source). The gear is not a target: it is named only as part
 *   of the condition (355.10.b/355.10.c).
 * - The modification itself is continuous.might with a while-conditional
 *   lifetime (it lasts as long as the condition holds), not a Buff counter
 *   (702) and not a one-shot effect.
 *
 * Status: judge-required (2026-10-17 recheck). The merged program lifecycle and
 * continuous.might binding are available. The remaining gaps are the [Deploy]
 * keyword predicate and source-relative friendly/same-location set query
 * (RIFT-359), plus the catalog's Spell/Unit mismatch.
 */
export default {
  canonicalCardId: "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核后仍有两处规则缺口与一处数据问题：" +
    "(1) continuous.might 的静态绑定路径已合入，但查询条件仍无法在集合过滤中求值 " +
    "[Deploy] 关键词谓词（CR 830.3）；该谓词属于 RIFT-359 条件/谓词工作流，不能用未知 filter 字段近似。" +
    "(2) 条件还需要把 friendly 与 sameLocationAs 的相对来源语义交给该查询路径。" +
    "(3) card-data 把本印刷标为 Spell 且 might=2，但文本是永久 Unit 的静态 Might 能力（CR 143.2）；" +
    "本任务不修改该数据问题。依赖 RIFT-359；不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        // "I have +1 :rb_might:" — a continuous Might modification of the
        // source itself; the layers consumer is unmerged (judgeReason).
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: { kind: "constant", value: 1 },
        duration: "while-conditional"
      },
      condition: {
        // "While there's a friendly gear with [Deploy] at my battlefield" —
        // at least one friendly gear at the source's own location. The
        // [Deploy] qualifier is not evaluable by any merged filter path
        // (judgeReason); sameLocationAs pins the "my battlefield" half.
        kind: "compare",
        left: {
          kind: "count",
          subject: "friendly-gears-with-deploy-at-my-battlefield",
          filter: {
            type: "gear",
            controller: "self",
            sameLocationAs: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "While there's a friendly gear with [Deploy] at my battlefield, I have +1 :rb_might:."
} satisfies CardProgram;
