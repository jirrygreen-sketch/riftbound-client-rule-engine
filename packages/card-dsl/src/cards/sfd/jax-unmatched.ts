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
 *   - 819.1.a：Quick-Draw 授予 [Reaction]，即打出时机许可（813）；
 *   - 819.1.b/c：打出时把它附着到一个你控制的单位（435 的 Attach）。
 *   本卡不手写 Quick-Draw 的展开，只声明授予关系；展开体在
 *   effects/keywords/Quick-Draw.ts（其文件头也把 continuous.timing 与 card-played
 *   附着触发标为未合入）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 授予句需要 continuous.grant-keyword 的“给手牌里的对象授予关键词”能力：
 *   effects/instructions/ 下没有注册的 continuous.* 原语（只有 effect.* 文件），
 *   layers/（RIFT-91 已合入求值侧）没有把 CardProgram 的 static 能力注册进图层，
 *   且「手牌中的对象」需要图层作用域覆盖非 Board 区域。
 * - [Deflect] 的展开文件已合入，但没有生产方把永久物上的 target.tax 接进目标选择与
 *   追加费用，且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同
 *   ogn/pouty-poro 的记录）。
 * - Quick-Draw 自身的展开（Reaction 时机许可 + 打出时附着）同样未接线：
 *   continuous.timing 无消费方，card-played 上的附着触发依赖目标锁定与链批次。
 * 依赖：RIFT-9（continuous.keyword/grant-keyword）、RIFT-91（layers-continuous 与
 * 手牌作用域）、RIFT-90/RIFT-89（Deflect 目标税与费用）、RIFT-120（触发进链）。
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
    "两处依赖未合入：(1)「Each Equipment in your hand has [Quick-Draw]」需要 continuous.grant-keyword 式的关键词授予" +
    "（150.1/150.5 的 Equipment 标签是作用域，819 授予 Quick-Draw）：effects/instructions/ 下没有注册的 continuous.* 原语" +
    "（只有 effect.* 文件），layers/（RIFT-91 已合入求值侧）不把 CardProgram 的 static 能力注册进图层，" +
    "且该作用域覆盖手牌区域（非 Board），图层与过滤器的区域作用域需扩展；" +
    "Quick-Draw 自身的展开（effects/keywords/Quick-Draw.ts：continuous.timing 的 [Reaction] 许可（819.1.a）" +
    "与 card-played 打出时附着到受控单位（819.1.b/c、435））同样无消费方（continuous.timing 无图层消费方、" +
    "card-played 触发未接链，RIFT-91/RIFT-120）。" +
    "(2)[Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax 接进目标选择与追加费用，" +
    "且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同 ogn/pouty-poro，RIFT-90/RIFT-89）。" +
    "不近似实现（不把授予写成逐张手牌副本，也不把 Quick-Draw 近似为单独的 Reaction 声明）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)"
} satisfies CardProgram;

export default program;
