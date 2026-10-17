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
 * Status: judge-required (2026-10-17 recheck, each half probed). The merged
 * program lifecycle and continuous.might binding are available: the static
 * registers and the condition really gates the +1 Might. The remaining gaps:
 * - no filter path evaluates the "[Deploy]" keyword qualifier. layers/filter.ts
 *   ignores unknown keys (`keywords` returns true for a gear without Deploy),
 *   and `characteristics.keywords` compares a list to a scalar; the 
 *   interpreter's Expr/Condition vocabulary has no keyword predicate either
 *   (evaluateCondition throws "Unsupported condition: has-keyword").
 * - the condition's relative player anchor is unsupported, and the two merged
 *   query paths fail in opposite directions: layers/filter.ts resolves
 *   `controller: "self"` as object.controller === object.controller, so an
 *   opposed gear at the same battlefield satisfies the clause (probed: enemy
 *   gear -> true, would grant +1 with no friendly gear), while the interpreter
 *   set query compares the string literally to a player id, so a real friendly
 *   gear does not satisfy it (probed: false). A literal id works, but a card
 *   program must not hardcode a player.
 * - plus the catalog's Spell/Unit mismatch (reported, not fixed here).
 */
export default {
  canonicalCardId: "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核后仍有两处规则缺口与一处数据问题（均实测）：" +
    "(1) continuous.might 的静态绑定路径已合入且条件真的生效，但任何过滤路径都求不出 [Deploy] 关键词谓词（CR 830.3）：" +
    "layers/filter.ts 对未知键（keywords）恒真（实测无 Deploy 的 gear 也匹配），characteristics.keywords 则把列表与标量比较；" +
    "解释器的 Expr/Condition 词表也没有关键词谓词（实测 evaluateCondition 抛 Unsupported condition: has-keyword）；" +
    "该谓词属于 RIFT-359 条件/谓词工作流，不能用未知 filter 字段近似。" +
    "(2) 条件的相对玩家锚点在两条已合并查询路径上都不成立，且失败方向相反：" +
    "layers/filter.ts 把 controller: \"self\" 解析成 object.controller === object.controller，" +
    "实测同战场的敌方 gear 也满足该 clause（会凭空获得 +1 Might）；" +
    "解释器集合查询则把该字符串按玩家 id 字面比较，实测真正的友方 gear 反而判 false（fail-closed）。" +
    "显式玩家 id 才行，但卡程序不能写死玩家，故仍需来源相对语义。" +
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
