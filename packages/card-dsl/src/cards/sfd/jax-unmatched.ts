import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jax, Unmatched (sfd-054-221) — Unit, Calm, Jax/Icathia/Champion.
 * energy 5, power 1 (Calm), Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-054-221，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n"
 *   "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)"
 *
 * 规则依据（CR v1.5）:
 * - [Deflect]（809）：被动能力关键词；809.1.b.3 省略数值按 1，卡只声明 keyword，展开
 *   （static target.tax）由 effects/keywords/Deflect.ts 负责。
 * - "Each Equipment in your hand has [Quick-Draw]"（819）：这是把关键词授予另一组对象的
 *   持续能力——150.1 规定带 Equipment 标签的 Gear 称为 Equipment，150.5 说明该标签是
 *   Gear 的可读取特征；因此授予范围是「你手牌中带 Equipment 标签的 Gear」。它需要
 *   continuous.grant-keyword 类的持续授予效果，把 Quick-Draw 赋给手牌里的对象。
 *   按契约 3.7 关键词只声明不重写：
 *   - 819.1.b/c：Quick-Draw 授予 [Reaction]，即可打出、附着的时机许可（813）；
 *   - 819.1.d：打出时把它附着到一个你控制的单位（435 的 Attach）。
 *   本卡不手写 Quick-Draw 的展开，只声明授予关系；展开体在
 *   effects/keywords/Quick-Draw.ts（其文件头也把 continuous.timing 与 card-played
 *   附着触发标为未合入）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-18）。
 * 已支持：continuous.grant-keyword 及生产静态绑定器可授予手牌 Equipment quick-draw；
 * KeywordGrantLayerEngine 也能重新展开 Quick-Draw 的静态 timing，但它会对动态的 attach
 * 触发 fail-closed，production lifecycle 仍只按印刷关键词安装能力。
 * 尚缺：actionTimings 只读取 grants/timings，不能消费 Quick-Draw 展开的 `value: reaction`；
 * 静态展开默认的来源绑定仍只覆盖 Board，手牌上的 Reaction 许可没有生产时序路径；
 * production lifecycle 仍不会把图层授予的动态 attach 能力注册到链上。现有印刷 Quick-Draw
 * 的 card-played 触发可以匹配 event.object 并执行附着；这条路径不再列为缺口。
 * Deflect 的 target.tax 到目标费用的接线及任意域 Power 记账也仍缺（809.1.c.1）。
 * 不近似实现（不把授予写成逐张手牌的副本，也不把 Quick-Draw 近似为 Reaction 声明）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "quick-draw",
      // 150.1/150.5：Equipment 是 Gear 的标签；819 只授予手牌中的这些 Gear。
      filter: { zone: "hand", type: "gear", tags: ["Equipment"], controller: "controller" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-a83dac0c953bf9bfdee67886a82147cb411410a3e9967fae69b37320583c94f9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "continuous.grant-keyword 与生产静态绑定已支持，KeywordGrantLayerEngine 也能消费图层授予的 Quick-Draw 静态 timing，" +
    "但仍有三条当前生产缺口：(1) 该 re-expander 对 Quick-Draw 的动态 attach 触发 fail-closed，" +
    "production lifecycle 仍只按印刷关键词安装能力；(2) Quick-Draw 使用 value: reaction，" +
    "layers/rules/query.ts 的 grantsFor 只读 grants/timings，无法消费该许可（819.1.b/c）；" +
    "(3) 生命周期的 staticTarget 默认只匹配来源在 board 的对象，尚不覆盖手牌中的 Quick-Draw 时序；" +
    "此外 [Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax 接进目标选择与追加费用，" +
    "且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同 ogn/pouty-poro）。" +
    "不近似实现（不把授予写成逐张手牌副本，也不把 Quick-Draw 近似为单独的 Reaction 声明）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)"
} satisfies CardProgram;

export default program;
