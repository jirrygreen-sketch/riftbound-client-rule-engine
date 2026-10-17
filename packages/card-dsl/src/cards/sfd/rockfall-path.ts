import type { CardProgram } from "../../ir/index.js";

/**
 * Rockfall Path (sfd-216-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-216-221):
 *   "Units can't be played here."
 *
 * CR v1.5 anchors:
 * - 054 / 054.1 ("Can't beats Can"): this is a prohibition. It removes a play
 *   destination that other permissions (355.2.b) would otherwise make Valid;
 *   it never grants one.
 * - 355.2 / 355.2.a / 355.2.b: playing a Unit includes choosing a Valid
 *   Location (by default the controller's Base or a Battlefield they control),
 *   and Game Effects may add permitted locations. Those locations become Valid
 *   "for the purposes of Playing the Unit" (355.2.b) — which is exactly the
 *   step a prohibition on this Battlefield has to intercept.
 * - 053.3: Battlefields say "here", so the prohibited destination is this
 *   Battlefield itself.
 *
 * Current review:
 * CR v1.5 054/054.1, 053.3 and 355.2.b: a prohibition removes this
 * Battlefield from valid unit play locations. It must not prohibit other
 * battlefields or the controller's Base. Static registration and rule-query
 * consumers exist; a destination-specific Battlefield identity is still missing.
 */
export default {
  canonicalCardId: "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units can't be played here」仍缺 CR v1.5 054/054.1、053.3、355.2.b 的逐战场打出禁止。continuous.restrict 已有默认 static 注册与链动作查询；但本卡的 action/cardType/location 描述没有转成规则查询所读的 actions/目的地条件，filter.sameLocationAs:self 也不能代表没有 Location 的 Battlefield 对象。ChainEngine.playDestinationIsLegal 虽已读取 continuous.location，只识别 no-battlefield 等位置类别，不能仅禁止此战场而允许基地/其它战场。依赖：以宿主 Battlefield 身份绑定的打出目的地限制与 Finalize 查询适配。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // 054.1: a prohibition only removes the option; it grants no permission.
        restriction: "units-cannot-be-played-here",
        prohibits: true,
        // The prohibited action and the population it applies to (355.2).
        action: "play",
        cardType: "unit",
        // "here" is this Battlefield (053.3); the merged ObjectFilter has no
        // source-battlefield anchor, so the destination is carried as the
        // sibling spelling used by rad/rakelstake and ogn/vilemaws-lair.
        location: "self",
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Units can't be played here."
} satisfies CardProgram;
