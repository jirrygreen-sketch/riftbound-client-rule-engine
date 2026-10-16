import type { CardProgram } from "../../ir/index.js";

/**
 * Pack of Wonders (ogn-181-298) — Gear, 2 Energy, Chaos.
 *
 * ":rb_exhaust:: Return another friendly gear, unit, or [Hidden] card to its
 *  owner's hand."
 *
 * CR v1.5 anchors:
 * - 415.4 / 415.5: the leading exhaust symbol is the cost "Exhaust this"; it
 *   must be completable at Finalize (contract 3.5); cost-plan support for the
 *   exhaust payment is merged.
 * - 355.10: "another friendly gear, unit, or [Hidden] card" names objects the
 *   player chooses, so they are targets unless an exception applies. The gear
 *   and unit live on the public Board; 355.10.a.1 also lists Facedown Zones as
 *   public zones, so the facedown branch is not automatically converted to a
 *   pick. Returning an object to its owner's hand (056.1) is the merged
 *   effect.zone destination "hand" / return-to-hand action.
 * - 107.3 / 422: facedown cards live in a Facedown Zone at a battlefield. The
 *   frozen ZoneId set has no facedown-zone member and ObjectSnapshot has no
 *   "facedown zone" predicate, so the [Hidden] branch cannot be selected or
 *   legal-target-checked without inventing a zone (the cost module records the
 *   same gap in its contract requests).
 * - 811.5.a: "a facedown card is not a card with [Hidden]", so the printed
 *   "[Hidden] card" branch is itself ambiguous as to whether it refers to a
 *   facedown card or to a card with the Hidden keyword elsewhere; that needs a
 *   judge call before it can be encoded as executable semantics.
 * - "another" must exclude the source Gear itself; the engine's ObjectFilter
 *   has no "other" predicate binding yet (1325-style placeholder used by
 *   other card programs under the same RIFT-1 target-filter dependency).
 *
 * Structure: one action-speed activated ability with the exhaust cost and a
 * single effect.zone instruction. The TargetSpec below covers the Board half
 * of the printed choice (another friendly gear or unit); the [Hidden] facedown
 * branch is the judged part.
 */
const packOfWonders = {
  canonicalCardId: "card.hash-e4f131a5d6aa5e08d250cdcde82ff81ed20a9131732bcaf3d7dec6b22e490535",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「another friendly gear, unit, or [Hidden] card」含规则未定与表达缺口：CR 811.5.a 规定 facedown card 不是带 [Hidden] 关键词的牌，" +
    "故「[Hidden] card」分支究竟指 facedown card 还是别处的 Hidden 牌需要裁定；若指 107.3/422 的 Facedown Zone 卡，" +
    "冻结的 ZoneId 集合没有 facedown-zone，ObjectSnapshot 也没有 facedown-zone 判定，无法选择或重验该目标" +
    "（费用模块契约变更请求第 3 条记录同一缺口）；「another」排除来源自身的 predicate 也尚未接线（RIFT-1 target-filter 依赖）。" +
    "已合入的 effect.zone 可把 gear/unit 送回其拥有者手牌（056.1）；整卡不可执行，不近似实现。",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          id: "pack-of-wonders.return-to-hand",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "pack-of-wonders.returned-object" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "pack-of-wonders.returned-object",
              // Board half of the printed choice; the [Hidden] facedown
              // branch has no representable zone (see judgeReason).
              filter: {
                type: ["gear", "unit"],
                controller: "self",
                zone: "board",
                other: true
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
  sourceText: ":rb_exhaust:: Return another friendly gear, unit, or [Hidden] card to its owner's hand."
} satisfies CardProgram;

export default packOfWonders;
