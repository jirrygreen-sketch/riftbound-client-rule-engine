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
 * 1. the Temporary KeywordDef and its effect.kill expansion are merged (RIFT-265),
 *    but the card-program lifecycle still has to register the beginning-start trigger
 *    and enqueue it through the production chain (RIFT-257).
 * 2. continuous.grant-keyword is merged (RIFT-258/259), but there is no RIFT-257 card-static
 *    ability binder in the production lifecycle; the granted Deflect target.tax also
 *    has no target-plan consumer (RIFT-90) or any-Domain Power payment path (RIFT-261).
 * The golden tests validate the identity/structure and execute the merged Temporary
 * sub-effect; the card remains judge-required until both integration gaps close.
 */
export default {
  canonicalCardId: "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) [Temporary]（CR 816.1.b）的 KeywordDef 与 effect.kill 展开已合入（RIFT-265），但卡牌生命周期仍未把 " +
    "beginning-start 触发注册并送入生产结算链（RIFT-257）。" +
    "(2) \"Friendly units have [Deflect]\" 的 continuous.grant-keyword 原语已合入，但没有 RIFT-257 卡牌 static " +
    "能力绑定入口；被授予的 Deflect target.tax 还缺目标计划消费方（RIFT-90）与任意域 Power 支付路径（RIFT-261）。" +
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
