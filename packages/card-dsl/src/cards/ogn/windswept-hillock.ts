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
 * ("Ganking", keywords/Ganking.ts, RIFT-83), and the merged
 * continuous.grant-keyword instruction (RIFT-258) can express the grant: the
 * golden test executes it through the interpreter with the 053.3 "here"
 * scoping carried by the sameLocationAs anchor that
 * effects/interpreter/selectors.ts implements, and reads the granted keyword
 * back through the layer engine. The card itself is still not executable:
 * - no merged consumer turns a CardProgram's static ability into a registered
 *   ContinuousEffectSpec or an instruction execution (card-program binding,
 *   RIFT-257, in progress), so the grant is never registered in production;
 * - the layer engine's own object matcher (layers/filter.ts) implements no
 *   sameLocationAs anchor, so a spec that copied this filter verbatim would
 *   grant Ganking to units at every Battlefield; the evaluable "here" path is
 *   the interpreter query, not the layer matcher;
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
    "① 授予本体可用已合入的 continuous.grant-keyword 指令（RIFT-258）表达，解释器的集合查询已实现 053.3 的 sameLocationAs 锚点，" +
    "golden 用解释器 + 参考内核真实执行「只授予此战场单位」并通过图层引擎读回授予结果；" +
    "② 整卡仍不可执行：没有已合入的消费方把 CardProgram 的 static ability 注册成 ContinuousEffectSpec（卡牌程序绑定 RIFT-257 进行中），授予在正式对局中从不注册；" +
    "③ 图层引擎自身的 filter 匹配器（layers/filter.ts）不实现 sameLocationAs 锚点，把本卡 filter 原样填进图层 spec 会向任意战场的单位过度授予；可执行的 here 语义只在解释器查询路径（effects/interpreter/selectors.ts）成立；" +
    "④ 授予关键词展开出的 continuous.movement 许可只能经 layers/rules/query.ts 的 movement() 查询读取，生产移动路径 zones/movement.ts 仍只读调用方传入的 readiness/hasGanking 记录，" +
    "战场→战场的 Standard Move 在生产链路仍被拒绝（144.4.c / 144.4.c.1）；" +
    "⑤ 190.6 的战场能力控制者解析缺失。依赖：RIFT-257（static 能力绑定）与移动许可的生产消费方。不近似实现。",
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
