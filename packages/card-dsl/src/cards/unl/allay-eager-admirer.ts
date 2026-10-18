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
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
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
    "当前缺口（CR 809.1.b.3/809.1.c.1）：(1) continuous.grant-keyword 的静态 aura 仍不能绑定：programs/statics.ts 拒绝 exclude:self，sameLocationAs 只捕获绑定时的位置；缺来源移动后重新匹配其他友方单位的动态过滤。" +
    "(2) 默认 static binder 没有 target.tax 映射；KeywordGrantLayerEngine 已能对接收者重展开 Deflect，但默认 programs/lifecycle.ts 尚未接入该适配器与完整目标税集合。" +
    "(3) target/tax 的任意域 Power 费用适配器已存在，chain/engine.ts 的 Finalize 仍使用自身收集器并把 tax.amount 记作 Energy；缺该 Power 费用计划的生产接线。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "While I'm at a battlefield, your other units here have [Deflect]."
} satisfies CardProgram;

export default program;
