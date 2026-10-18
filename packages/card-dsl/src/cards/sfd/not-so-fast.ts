import type { CardProgram } from "../../ir/index.js";

/**
 * Not So Fast — sfd-045-221 (Spell, 2 energy + 1 Calm power, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-045-221, verbatim):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Counter an enemy spell or ability that chooses a friendly unit or gear.
 *
 * Catalog evidence: energy 2, power 1 (Calm), might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword; the card declares it and the
 *   merged KeywordDef owns the Closed State / Showdown permission (contract
 *   3.7); admission is the chain's canAct check (3.5).
 * - "a spell or ability" refers to finalized objects on the Chain
 *   (355.9.a.2), so the countered item is the instruction's target (355.7) and
 *   effect.counter rechecks that the locked reference is still on the Chain
 *   (359.3.e.1-e.6). "enemy" is the controller relationship (740.1.b).
 * - Countering follows 426.1-426.3: the countered item does nothing, is
 *   cleared from the Chain, and its costs are not refunded.
 * - The restriction "that chooses a friendly unit or gear" asks whether the
 *   targeted chain item selected a unit or gear controlled by this spell's
 *   controller (754 records who became targeted). The merged target system
 *   validates target candidates only against the current object's filter
 *   fields (target/target-plan.ts); it does not expose a chain item's
 *   finalized target plans to a card filter, and no ObjectSnapshot
 *   characteristic records them. The filter key "choosesFriendly" below is
 *   therefore descriptive: layers/filter.ts silently ignores unknown keys, and
 *   programs/filters.ts translateObjectFilter rejects it outright
 *   (ProgramBindingError: Unsupported filter field choosesFriendly), so the
 *   production trigger/target translation cannot even bind this TargetSpec.
 *
 * Status: judge-required. The counter instruction itself is merged and is
 * executed by the golden test with a Finalize-locked Chain target, but the
 * printed restriction cannot be checked yet, so the card is not claimed
 * executable and the restriction is not dropped (that would silently allow
 * countering any enemy Chain item). Dependency: the target system exposing a
 * chain item's chosen targets / a target-history predicate, with the merged
 * 754 became-target notifications made queryable from a card filter. Measured
 * 2026-10-18: the restriction is still absent from every layer — the filter key
 * is rejected by the production translator, and no ObjectFilter field or layer
 * rule can read "the targets this Chain item chose", so no merged spelling
 * exists to author the restriction with.
 *
 * Note on the target system itself: this card needs the OPPOSITE of the
 * target-history dimension — the chain item's own chosen-target set, not the
 * acting player's history. TestWorld.history(query) only counts committed
 * GameActions (became-target is a Chain timing point, not an action), so even a
 * future history field would not answer this question.
 */
const notSoFast = {
  canonicalCardId: "card.hash-33c64673bc887d04d061bcae6dce39ed0eb58011d8102f4f2426e9d43b6a8bdc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "目标限制「that chooses a friendly unit or gear」无法求值：355.9.a.2 把 spell/ability 指向链上项，" +
    "但判断该链项是否选择（754 的成为目标记录）了你控制的单位或装备，需要读取该链项的 Finalize 目标计划；" +
    "契约 3.6/3.8 的目标接口不向卡牌暴露链项已选目标，target-plan 只校验当前对象的 filter 字段，" +
    "因此 filter 里的 choosesFriendly 是描述性键：layers/filter.ts 对未知键静默忽略，" +
    "programs/filters.ts 的 translateObjectFilter 实测拒绝（ProgramBindingError: Unsupported filter field " +
    "choosesFriendly，describePlay 同样在 Finalize 前失败）。全仓库也没有别的字段或图层规则能读「该链项选过哪些目标」，" +
    "所以这条限制目前没有可用来拼写的合并形状；事后 history 计数帮不上忙：TestWorld.history(query) 只统计已提交的 " +
    "GameAction，而 became-target 是链在 Finalize 发射的时点而非动作。" +
    "effect.counter（426.1-426.3）与 [Reaction]（813）本体已合入并有 golden 真实执行测试；不近似实现（不省略限制去反制任意链项）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "not-so-fast.counter-chosen-item",
          op: "effect.counter",
          args: { target: { kind: "constant", value: "not-so-fast.enemy-item" } },
          targets: [
            {
              id: "not-so-fast.enemy-item",
              // "a spell or ability" = finalized Chain items (355.9.a.2);
              // controller "opponent" is 740.1.b. choosesFriendly is the
              // descriptive part of the printed restriction (754).
              filter: {
                type: ["spell", "ability"],
                zone: "chain",
                controller: "opponent",
                choosesFriendly: ["unit", "gear"]
              },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter an enemy spell or ability that chooses a friendly unit or gear."
} satisfies CardProgram;

export default notSoFast;
