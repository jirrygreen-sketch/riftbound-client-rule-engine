import type { CardProgram } from "../../ir/index.js";

/**
 * Petricite Monument (sfd-104-221) — Gear, 2 Energy, no printed Power, no Might,
 * Body, no tags.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-104-221):
 *   "[Temporary] (Kill this at the start of its controller's Beginning Phase,
 *    before scoring.)
 *    Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose
 *    them with a spell or ability.)"
 *
 * Rules (CR v1.5):
 * - 816.1 / 816.1.a / 816.1.b: Temporary is a Triggered Ability keyword present on
 *   Permanents; it is functionally short for "At the start of this permanent's
 *   controller's Beginning Phase, before scoring, kill this." 816.1.c gives the
 *   trigger condition (the controller's Beginning Phase starting), and 816.2/816.2.a
 *   make multiple instances redundant.
 * - 809.1/809.1.b.3/809.1.c: Deflect is a Passive Ability keyword; omitted X is 1,
 *   and it adds a mandatory additional Power cost of any Domain to opponents'
 *   spells/abilities that choose the object.
 * - 364.1/364.2: "Friendly units have [Deflect]" is a continuous passive granting
 *   the keyword to units you control; ongoing grants are layer effects (contract 3.7).
 *
 * status: judge-required, no part approximated:
 * 1. the Temporary KeywordDef, its effect.kill expansion and the card-program
 *    lifecycle are merged, but the beginning-start filter's event spelling and
 *    the trigger payload cannot yet bind the kill to this permanent: the
 *    KeywordDef emits event "beginning-start" which is not in the TriggerSpec's
 *    EVENT_PATTERN_TYPES vocabulary (validation fails closed), and the turn
 *    flow's beginning-start emission carries no object.
 * 2. the continuous.grant-keyword primitive and the static binder are merged, so
 *    the Deflect grant now really lands in the ability layer; the granted Deflect's
 *    target.tax still has no target-plan consumer, and chain/engine.ts books the
 *    Deflect tax as an Energy constant instead of any-Domain Power (809.1.c.1).
 * The golden tests validate the identity/structure and execute the merged Temporary
 * sub-effect; the card remains judge-required until both integration gaps close.
 */
export default {
  canonicalCardId: "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) [Temporary]（CR 816.1.b）的 KeywordDef、effect.kill 展开与卡牌生命周期均已合入，" +
    "但 beginning-start 触发的 filter.event 用的时点名与 TriggerSpec 词汇表不一致（events/trigger-spec.ts），" +
    "且 turn/flow.ts 的 beginning-start 载荷不含对象，无法把 kill 绑到本永久物。" +
    "(2) \"Friendly units have [Deflect]\" 的 continuous.grant-keyword 原语与 static 绑定已合入，" +
    "授予现在能真正落到 ability 图层；但被授予的 Deflect target.tax 仍缺目标计划消费方，" +
    "链上又把税记成 Energy 常量而非任意域 Power（809.1.c.1）。" +
    "No approximate implementation is provided; the executable Temporary sub-effect is covered in isolation.",
  abilities: [
    // 816.1: the printed [Temporary] declaration. Expansion belongs to the
    // merged keyword registry; production registration remains a lifecycle gap.
    { kind: "keyword", keyword: "temporary" },
    {
      // "Friendly units have [Deflect]" — an ongoing grant to your units.
      // Descriptive static shape (contract 3.7 continuous grant); the card-static
      // binder and the granted Deflect target-tax consumer remain integration gaps.
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "deflect",
        // 809.1.b.3: omitted X is 1.
        value: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          // "Friendly" on a static ability = the ability controller's permanents (740.1).
          controller: "controller",
          zone: "board"
        }
      }
    }
  ],
  sourceText:
    "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
    "Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell or ability.)"
} satisfies CardProgram;
