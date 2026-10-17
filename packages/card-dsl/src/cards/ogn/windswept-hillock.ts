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
 * ("Ganking", keywords/Ganking.ts), and the merged
 * continuous.grant-keyword instruction (RIFT-258) can express the grant: the
 * golden test executes it through the interpreter with the 053.3 "here"
 * scoping carried by the sameLocationAs anchor that
 * effects/interpreter/selectors.ts implements, and reads the granted keyword
 * back through the layer engine. The card itself is still not executable:
 * - the static CardProgram binder can register the grant and resolve the
 *   source-relative sameLocationAs anchor;
 * - the granted Ganking expansion produces continuous.movement, and only
 *   layers/rules/query.ts movement() reads it; the production Standard Move
 *   (zones/movement.ts) still consumes caller-supplied readiness/hasGanking
 *   records, so Battlefield→Battlefield stays rejected (144.4.c);
 * - 190.6's controller resolution for a Battlefield ability is missing.
 */
export default {
  canonicalCardId: "card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units here have [Ganking]」授予的是已注册的 KeywordId（effects/keywords/Ganking.ts，RIFT-83；810 / 144.4.c）：" +
    "① 授予本体可用已合入的 continuous.grant-keyword 指令表达，解释器与 static binder 都能解析 053.3 的 sameLocationAs 锚点，" +
    "golden 用解释器 + 参考内核真实执行「只授予此战场单位」并通过图层引擎读回授予结果；" +
    "② 整卡仍不可执行：授予关键词展开出的 continuous.movement 许可只能经 layers/rules/query.ts 的 movement() 查询读取，生产移动路径 zones/movement.ts 仍只读调用方传入的 readiness/hasGanking 记录，" +
    "战场→战场的 Standard Move 在生产链路仍被拒绝（144.4.c / 144.4.c.1）；" +
    "③ 190.6 的战场能力控制者解析缺失。依赖：移动许可的生产消费方与 Battlefield controller 解析。不近似实现。",
  sourceText: "Units here have [Ganking]. (They can move from battlefield to battlefield.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        // 479.3.b ability layer: grant the keyword to every unit (both
        // controllers) at this Battlefield; 053.3 "here" travels as
        // sameLocationAs, evaluated by the merged interpreter query (the layer
        // matcher itself does not implement the anchor; see judgeReason).
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
