import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Allay, Eager Admirer (unl-041-219) — Unit, 3 Energy, Might 3, Calm, tags Yordle/Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-041-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   While I'm at a battlefield, your other units here have [Deflect].
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]：809.1 的 Passive Ability 关键词；809.1.a 通常出现在永久物上；809.1.b / 809.1.b.3
 *   规定印刷形式 "Deflect [X]" 且省略 X 时按 1；809.1.c / 809.1.c.1 功能上等于「对手控制的选择我的
 *   咒语与能力需要支付等量的追加费（该费用始终可以用任意域的力量支付）」；809.1.d 说明它是施加在
 *   选择该对象的咒语/能力上的强制追加费用；809.2 多来源数值相加；809.3 是可读取特征。按契约 3.7 /
 *   README 第 5 节，卡文件只声明 `{ kind: "keyword", keyword: "deflect" }`（无数值 → 809.1.b.3 按 1），
 *   展开（static target.tax）由 effects/keywords/Deflect.ts 负责。
 * - “While I'm at a battlefield, your other units here have [Deflect]”：364.1 / 364.2 的持续性被动
 *   能力（陈述句，不是触发），作用范围是「与我在同一位置的其他友方单位」。位置比较用契约 3.6 的
 *   sameLocationAs 锚点（"here" 指本卡所在的位置；eager-apprentice 记下了同一族写法），
 *   排除本卡自身用 exclude（与 captain-farron 的 “Other friendly units here” 同款）。
 *   本卡的 “While I'm at a battlefield” 是能力生效的前置条件：只有我在战场上时授予才成立。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - Deflect 的展开文件已合入，但没有生产方把永久物上的 target.tax 持续效果接进目标选择：
 *   target/target-plan.ts 的 taxSpecs / appendTaxes 只在调用方显式传入 tax 时才追加 Deflect 税，
 *   链侧也没有从永久物特征派生 Deflect 税（RIFT-90 的目标税接线；ogn/pouty-poro 记录同一缺口）。
 * - 已合入的 tax→费用换算按 Energy 记账（chain/engine.ts 把税额写成 energy 形态的 mandatory
 *   additional cost），而 809.1.c.1 要求这笔追加费用始终可用任意域（rainbow）力量支付。
 * - “your other units here have [Deflect]” 是 continuous.grant-keyword 的持续授予，没有已注册的
 *   卡牌侧原语（effects/instructions/ 下只有 effect.* 文件），layers（RIFT-91）也只消费经
 *   ResolveContext.addContinuous 注册的 ContinuousEffectSpec，CardProgram 的 static 能力尚未接线；
 *   被授予的 Deflect 还需要在接收者上再展开一次（两级处理），该消费方同样未合入。
 * 依赖：RIFT-90（target.tax 接线与任意域支付）、RIFT-84（kw-deflect-hidden 的消费）、RIFT-91（layers 接线）。
 * 不近似实现：不把授予写成固定数值加算，也不用别的关键词顶替。
 */
const abilities: Ability[] = [
  // 809.1.b.3：印刷省略 Deflect Value，按 1 处理（默认值由 keywords/Deflect.ts 承担）。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "static",
    // 801.3.a / 364.1：给同一位置的其他友方单位授予 [Deflect]（持续效果，不进链）。
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "deflect",
      // 809.1.b.3：被授予的 Deflect 无数值，按 1；多个来源的数值按 809.2 相加（由关键词文件求和）。
      value: { kind: "constant", value: 1 },
      filter: {
        type: "unit",
        controller: "controller",
        zone: "board",
        // “your other units”：排除本卡自身。
        exclude: "self",
        // “here”：与来源同一位置（契约 3.6 的 sameLocationAs 锚点）。
        sameLocationAs: "self"
      }
    },
    // “While I'm at a battlefield”：我在战场上时授予才生效。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "objects",
        filter: { object: "self", location: "battlefield" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-bd653b8aaef730f2cda1c769f847ec6222a08a3ec41066a74de13321000d898d",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1) 自带的 [Deflect]（809.1.b.3 省略值按 1）虽然展开文件 " +
    "effects/keywords/Deflect.ts 已合入（static target.tax），但没有任何生产方把永久物上的 target.tax 持续效果接进目标选择：" +
    "target/target-plan.ts 的 taxSpecs/appendTaxes 只在调用方显式传入 tax 时才追加，chain 侧也没有从永久物特征派生 Deflect 税" +
    "（RIFT-90；ogn/pouty-poro 记录同一缺口）。(2) 已合入的 tax→费用换算按 Energy 记账（chain/engine.ts 把税额写成 energy 形态的" +
    " mandatory additional cost），与 809.1.c.1 要求的“该 Power 始终可用任意域支付”不符。" +
    "(3) “While I'm at a battlefield, your other units here have [Deflect]” 需要 continuous.grant-keyword 持续效果" +
    "（801.3.a/364.1）：effects/instructions/ 下没有该原语，layers（RIFT-91）也只消费经 ResolveContext.addContinuous " +
    "注册的 ContinuousEffectSpec、CardProgram static 未接线，被授予的 Deflect 还需在接收者上再按 809 展开一次（两级处理）也没有消费方。" +
    "依赖：RIFT-90（target.tax 接线与任意域支付）、RIFT-84（kw-deflect-hidden）、RIFT-91（layers 接线）。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "While I'm at a battlefield, your other units here have [Deflect]."
} satisfies CardProgram;

export default program;
