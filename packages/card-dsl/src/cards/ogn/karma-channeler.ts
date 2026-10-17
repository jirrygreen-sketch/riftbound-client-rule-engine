import type { CardProgram } from "../../ir/index.js";

/**
 * Karma, Channeler (ogn-235-298), CR v1.5 817 / 417 / 052 / 161.1 / 702.
 * programs/ keyword and trigger binding, inspect/recycle, and buff are merged.
 * Still blocked by one-trigger-per-recycle-batch semantics (excluding runes),
 * the card-recycled EventPattern adapter, and Vision's controller + ordered
 * resolution-time top-card bindings (RIFT-358). Tests execute the original
 * buff body and Vision's Predict subeffect with an explicitly ordered deck slice.
 */
const karmaChanneler = {
  canonicalCardId: "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「When you recycle one or more cards」需同一回收批次只触发一次，并排除符文（CR 417.1、052、161.1）；" +
    "action-adapter 按每个 recycle GameAction 发出 card-recycled，缺批次聚合/去重及该 EventPattern 的过滤适配。" +
    "[Vision] 展开的 object.id=self 入场过滤还需 programs/filters 适配；effect.inspect 仍固定 player=A，需注入真实控制者与结算时有序 vision-top picks（RIFT-358；817、437.1）。",
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "triggered",
      trigger: {
        at: "card-recycled",
        filter: { event: "card-recycled", player: "self" }
      },
      optional: false,
      body: [
        {
          id: "karma-channeler.buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "karma-channeler.friendly-unit" }
          },
          targets: [
            {
              id: "karma-channeler.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "controller" },
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

export default karmaChanneler;
