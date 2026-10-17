import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Mosstomper (unl-047-219) — Unit, 3 Energy + 1 power, Might 3, Calm, tags Dog/Ixtal.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-047-219，逐字）：
 *   [Hunt 2] (When I conquer or hold, gain 2 XP.)
 *   [Level 3][>] I have +1 :rb_might: and [Deflect]. (While you have 3+ XP, get the effect.
 *   Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - [Hunt 2]：823.1 的 Triggered Ability 关键词（823.1.b：同时是 Conquer 与 Hold effect）；
 *   823.1.c.1 的功能写法是 “When I conquer or hold, my controller gains X XP”，823.1.c.3 说明 X
 *   是 Hunt Value（本卡印刷值 2，与提醒文字一致）；823.2 多来源求和。按契约 3.7 / README 第 5 节，
 *   卡文件只声明 `{ kind: "keyword", keyword: "hunt", value: 2 }`。
 * - 第一段括号内 “When I conquer or hold, gain 2 XP.” 是 [Hunt 2] 的提醒文本（135.2.d.3 无游戏
 *   功能），不重复实现。
 * - [Level 3][>]：824.1 的 Dependent Keyword；824.1.a 给出格式，824.1.b / 824.1.b.1 说明从关键词
 *   到子句结尾整段是 Level Ability，功能上等于“当你有 [N] 点或更多 XP 时，本牌获得「[Text]」”，
 *   824.1.b.2 的 [Text] 是 Dependent Ability；824.1.c 规定控制者有 [N] XP 期间依赖能力 Active
 *   （824.1.c.1 换控制者时重判、824.1.d 掉到 [N] 以下立即 Inactive）；824.2 是可读取特征。
 *   本卡的 [Text] 是 “I have +1 :rb_might: and [Deflect].” 所以依赖能力是两条静态持续效果：
 *   (a) arithmetic 层的 Might 加算 1（143.2 的 Effective Might / 475 图层）；
 *   (b) 给自身授予 [Deflect]（809.1.b.3 无数值按 1，801.3.a / 364.1 的持续授予）。
 *   第二段括号（“Opponents must pay …”）只是 [Deflect] 的提醒文本，同样不重复实现。
 * - “I have +1 [M] and [Deflect]” 是能力文本自带的两个持续效果，不是印刷关键词：本卡没有印刷
 *   [Deflect]（徽记来自 [Level 3] 的依赖能力），所以 abilities 里不写 deflect keyword 条目，
 *   而是把授予放在 824.1.c 门控的持续效果里（否则默认会假定本卡无条件下带 1 点 Deflect 值，与
 *   809.2/814.2 式的求和含义冲突）。
 *
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */
const LEVEL_THREE_XP: Condition = {
  kind: "compare",
  left: {
    kind: "count",
    subject: "controller-xp",
    filter: { player: "controller" }
  },
  operator: "gte",
  right: { kind: "constant", value: 3 }
};

const abilities: Ability[] = [
  // 823.1.c.3：印刷 Hunt Value 是 2（展开由 keywords/Hunt.ts 承担）。
  { kind: "keyword", keyword: "hunt", value: 2 },
  {
    kind: "static",
    // 824.1.b.1 的 [Text] 第一半：“I have +1 [M]”（arithmetic 层 Might 加算）。
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: LEVEL_THREE_XP
  },
  {
    kind: "static",
    // 824.1.b.1 的 [Text] 第二半：“and [Deflect]”（809.1.b.3 无数值按 1；801.3.a 的授予）。
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "deflect",
      value: { kind: "constant", value: 1 },
      appliesTo: "self"
    },
    condition: LEVEL_THREE_XP
  }
];

const program = {
  canonicalCardId:
    "card.hash-3237f73ddd77661179f659d36e72559c7bdf667aadbeeb1a45d74e35b239ea35",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Hunt 的事件名适配（823.1）：programs/filters.ts 已把嵌套 filter 翻译成 object，但 conquer/hold 仍与封闭 EventPattern 的 conquered/held 不一致，订阅不能注册。" +
    "缺 Level 的 controller-xp 表达式读取 PlayerSnapshot.xp（824.1.c/824.1.d）：continuous.might 与 continuous.grant-keyword 已有静态绑定条件求值，count 仍只数对象而不读取 subject。" +
    "缺授予 Deflect 后的 target.tax 到 Chain Finalize 费用接线（809.1.c.1）；target/tax 已能收集分层关键词并计算任意域 Power，链仍使用自身按 Energy 记账的适配器。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and [Deflect]. (While you have 3+ XP, get the effect. " +
    "Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

export default program;
