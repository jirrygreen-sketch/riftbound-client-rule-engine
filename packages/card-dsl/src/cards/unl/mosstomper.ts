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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 没有 Hunt 的 KeywordDef（effects/keywords/ 无 Hunt 文件）：823.1.b 的 conquer / hold 触发与
 *   effect.xp 展开、823.2 的求和都无从执行。
 * - 没有 Level 的展开（kw-level）：824.1.c/824.1.d 的 XP 门槛依赖能力需要可求值的 XP 谓词，
 *   而合并的 Condition 仅 always/never/expression/compare/all/any/not，PlayerSnapshot.xp 没有进入
 *   Expr 的路径（count 只数被查询对象）。因此 824.1.c 的门控在本程序里只是保留形状。
 * - “I have +1 [M]” 是 arithmetic 层 Might 修正，尚无卡牌可用的注册入口（continuous.might；
 *   layers 只消费经 ResolveContext.addContinuous 注册的 ContinuousEffectSpec）；
 *   “I have [Deflect]” 是 continuous.grant-keyword 持续授予，也没有已注册原语，且被授予的
 *   Deflect 还需在接收者上再按 809 展开（两级处理），缺消费方。
 * 依赖：kw-hunt 与 kw-level 关键词任务（ability-templates 的对应行）、RIFT-91（layers-continuous
 * 的卡牌接线与条件求值）、RIFT-89/90（条件/谓词管线）、RIFT-84/RIFT-90（Deflect 目标税）。
 * 不近似实现：不把 [Hunt 2] 手写成触发体，不把 3+ XP 门控删成无条件能力，也不把 Deflect 授予
 * 写成固定数值加算。
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
    "三处缺口，均不近似实现：(1) [Hunt 2]（823.1）没有 KeywordDef：effects/keywords/ 下无 Hunt 文件，" +
    "823.1.b/823.1.c.1 的 conquer 与 hold 触发（823.1.c.3 的印刷值 2、823.2 多来源求和）与 " +
    "卡牌 keyword 能力 → 关键词展开 → 触发注册的生产方（契约 3.5/3.7）都未合入。" +
    "(2) [Level 3][>]（824.1）没有展开：824.1.b.1 的“当你有 3 点或更多 XP 时获得 [Text]”与 " +
    "824.1.c/824.1.d 的动态 Active/Inactive 需要可求值的 XP 谓词，合并的 Condition 只有 " +
    "always/never/expression/compare/all/any/not，PlayerSnapshot.xp 没有进入 Expr 的路径（count 只数被查询对象），" +
    "所以本程序里的 3+ XP 门控只是保留形状。" +
    "(3) 依赖能力的两半都没有已注册的卡牌侧消费方： “I have +1 :rb_might:” 属 arithmetic 层 Might 修正" +
    "（continuous.might；layers 只消费经 ResolveContext.addContinuous 注册的 ContinuousEffectSpec，CardProgram static 未接线），" +
    "“and [Deflect]” 属 continuous.grant-keyword 持续授予（effects/instructions/ 无该原语），且被授予的 Deflect 还需在接收者上" +
    "再按 809 展开一次（两级处理）也缺消费方。依赖：kw-hunt 与 kw-level 关键词任务、RIFT-91（layers 接线与条件求值）、" +
    "RIFT-89/90（条件/谓词管线）、RIFT-84/RIFT-90（Deflect 目标税）。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and [Deflect]. (While you have 3+ XP, get the effect. " +
    "Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)"
} satisfies CardProgram;

export default program;
