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
 * Status: judge-required. Three gaps:
 * - no merged primitive/layers consumer for a conditional +1 Might on itself
 *   (continuous.might; RIFT-91);
 * - no merged filter evaluates the [Deploy] keyword qualifier: the reference
 *   kernel's filter matching ignores unknown keys, `layers/filter.ts` can only
 *   test keywords through `characteristics` field equality (which cannot test
 *   an array) or through the continuous-effect `has-keyword` condition, and
 *   `condition.predicate` only consumes Condition objects. The authored filter
 *   therefore keeps the canonical type/controller/sameLocationAs keys and adds
 *   no key that nothing would evaluate; the keyword qualifier is part of the
 *   count subject and of this reason (keyword-predicate work, RIFT-91);
 * - the printing's card type disagrees with its rules text (data problem).
 */
export default {
  canonicalCardId: "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺条件式自身 Might 修正：静态效果需要 continuous.might（图层 arithmetic，来源为自身，随条件存续），" +
    "layers 消费者未合入（依赖 RIFT-91）；effect.buff 只处理 CR 702 的 Buff 计数，不能代替 Might 值修正。" +
    "另缺 [Deploy] 关键词谓词的过滤求值：参考内核的 filter 匹配忽略未知键，layers/filter.ts 只能通过 " +
    "characteristics 做字段等值（无法测数组）或用 continuous 效果的 has-keyword 条件，没有合并的 query/count " +
    "路径能筛“带 [Deploy] 的装备”（RIFT-91 关键词谓词；830.3 说明 Deploy 是可被检查的特征）；" +
    "因此 filter 只写 type/controller/sameLocationAs，[Deploy] 限定记录在 count.subject 与本文中，不新增无人求值的键。" +
    "另有卡牌数据问题：目录把该印刷标为 Spell 且 might=2，但文本是永久物单位的静态能力（“I have +1 Might”“my battlefield”），" +
    "Spell 结算后进弃牌堆且没有 Might（CR 1.5 157/351.2、143.2），本任务不改数据、不推断真实卡型。不近似实现。",
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
            controller: "you",
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
