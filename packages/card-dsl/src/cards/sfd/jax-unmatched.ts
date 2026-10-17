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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - 授予句：RIFT-258 的 continuous.grant-keyword 已合入，golden 证明该静态声明的
 *   过滤（zone: hand + Equipment 标签）注册为 ability 层效果后，手牌里的 Equipment
 *   真的获得 quick-draw（其它手牌与非法对象不受影响）；static → 图层的生产路径
 *   也已合入（RIFT-257 的 attachProgramLifecycle 默认 createEngineStaticBinder，
 *   bindStaticToLayers 注册图层）。仍未合入的是 Quick-Draw 展开的触发注册路径：
 *   该展开把 card-played 附着触发挂在被授予的 gear 上，而手牌中的 gear 没有触发
 *   attach 管线（triggerRegistrations 只在 attachProgramLifecycle attach 时调用，
 *   手牌对象无人 attach），因此打出装备时附着触发不进链。
 * - filter 里的 controller: "controller" 是卡面写法；程序绑定把它归一化为 self
 *   （programs/filters.ts normalizePlayer），golden 按该归一化执行。
 * - [Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax
 *   接进目标选择与追加费用，且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power
 *   （同 ogn/pouty-poro）。
 * - Quick-Draw 授予的 continuous.timing（819.1.a 的 [Reaction] 许可）已被
 *   chain.canAct 的图层时序读取消费（旧理由的“无消费方”已过时）；待接线的是
 *   卡程序 granted-keyword 到图层时序的注册路径（同上（1）的管线缺口）。
 * 依赖：手牌对象的触发 attach 管线、Deflect 目标税（RIFT-90）。
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
    "两处依赖仍未合入：(1)「Each Equipment in your hand has [Quick-Draw]」的授予（continuous.grant-keyword，RIFT-258）" +
    "与 static→图层的安装管线（attachProgramLifecycle 默认 createEngineStaticBinder→bindStaticToLayers）均已合入，" +
    "golden 以声明的手牌 Equipment 过滤真实注册 ability 层效果并读到 quick-draw；缺的是 Quick-Draw 展开的触发注册路径——" +
    "该展开把 819.1.b/c 的 card-played 附着触发挂到被授予的 gear 上，而手牌中的对象没有触发 attach 管线" +
    "（triggerRegistrations 只在 attachProgramLifecycle attach 时调用，手牌 gear 无人 attach），打出装备时附着触发不进链；" +
    "819.1.a 的 [Reaction] 时序许可已被 chain.canAct 的图层时序读取消费（旧理由的 continuous.timing 无消费方已过时），" +
    "待接线的是卡程序 granted-keyword 到图层时序的注册路径（同本条管线缺口）。" +
    "(2)[Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax 接进目标选择与追加费用，" +
    "且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同 ogn/pouty-poro）。" +
    "不近似实现（不把授予写成逐张手牌副本，也不把 Quick-Draw 近似为单独的 Reaction 声明）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)"
} satisfies CardProgram;

export default program;
