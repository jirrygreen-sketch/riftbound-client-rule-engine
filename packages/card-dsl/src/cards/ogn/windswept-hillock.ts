import type { CardProgram } from "../../ir/index.js";

/**
 * Windswept Hillock (ogn-297-298) — Battlefield, Colorless.
 *
 * sourceText:
 *   Units here have [Ganking]. (They can move from battlefield to battlefield.)
 *
 * CR v1.5 anchors:
 * - 810 / 810.1 / 810.1.c: Ganking is a Passive Ability keyword that adds the
 *   Battlefield→Battlefield option to a Unit's Standard Move (810.1.c.1 adds
 *   options without removing any; 810.1.c.2 has no cost; 810.1.c.3 grants no
 *   extra Move). 810.3: whether a unit has Ganking is a readable characteristic.
 * - 144.4.c / 144.4.c.1: units with Ganking may use their Standard Move from
 *   Battlefield to Battlefield.
 * - 479.3.b: "have [keyword]" is an ability-altering static effect ("have" is
 *   the identifying phrase).
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required. The granted keyword is a registered KeywordId
 * ("Ganking", keywords/Ganking.ts, RIFT-83), and the golden test executes the
 * equivalent layers registration to show the grant's shape; the card itself is
 * not executable because:
 * - nothing turns a CardProgram's static ability into a registered
 *   ContinuousEffectSpec (registerContinuousEffect has no caller), so the grant
 *   is never registered by the engine;
 * - layers/filter.ts implements no sameLocationAs anchor, so "here" would grant
 *   Ganking to units at every Battlefield;
 * - the granted Ganking expansion produces continuous.movement, and
 *   zones/movement.ts reads its own explicit readiness/timing inputs rather than
 *   the layered movement permissions, so Battlefield→Battlefield would still be
 *   rejected in production;
 * - 190.6's controller resolution for a Battlefield ability is missing.
 */
export default {
  canonicalCardId: "card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units here have [Ganking]」授予的是已注册的 KeywordId（effects/keywords/Ganking.ts，RIFT-83 已合入；810 / 144.4.c），并按 479.3.b 的 “have” 写成 static 授予，" +
    "但整卡不可执行：① 没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（registerContinuousEffect 无调用方），授予从未注册；" +
    "② layers/filter.ts 不实现 sameLocationAs 锚点，053.3 的 here 会变成任意战场的单位都有 Ganking（过度授予）；" +
    "③ 授予后的 Ganking 展开为 continuous.movement，而 zones/movement.ts 只读自己的 readiness/timing 输入，不读图层 MovementPermissions，生产链路仍会拒绝战场→战场的 Standard Move；" +
    "④ 190.6 的战场能力控制者解析缺失。依赖：RIFT-83（kw-ganking-vision）、RIFT-91（layers-continuous）、RIFT-75（batch1-zones）之后的注册与移动许可消费任务。不近似实现。",
  sourceText: "Units here have [Ganking]. (They can move from battlefield to battlefield.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        // 479.3.b ability layer: grant the keyword to every unit (both
        // controllers) at this Battlefield; 053.3 "here" travels as
        // sameLocationAs, which the merged layers filter does not implement yet
        // (see judgeReason).
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
