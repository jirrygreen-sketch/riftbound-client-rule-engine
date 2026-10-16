import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Herald of Spring (unl-034-219) — Unit, 4 Energy + 1 power, Might 4, Calm, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-034-219，逐字）：
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   When you play me, gain 2 XP.
 *
 * 规则依据（CR v1.5）：
 * - [Hunt]：823.1 的 Triggered Ability 关键词；823.1.b 说明它同时是 Conquer Effect 与
 *   Hold Effect，823.1.c.1 的功能写法是 “When I Conquer or Hold, my controller gains X XP”，
 *   823.1.c.2 规定省略 X 时按 1（本卡的提醒文字也正是 1 XP），823.1.c.3 的 Hunt Value 与
 *   823.2 的多来源求和都由关键词文件与注册表负责。按契约 3.7 / README 第 5 节，卡文件只
 *   声明 `{ kind: "keyword", keyword: "hunt" }`，不手写展开。
 * - “When you play me, gain 2 XP”：383.4.a / 383.4.a.1 的 Play Effect，420.4.a 规定在打出
 *   完成后进链；时点用封闭表的 card-played，filter 以契约 3.6 的符号选择器指向来源自身。
 * - “gain 2 XP”：728 / 729 / 730.1 的 XP 资源增加，额度在结算时取值；已合入的 effect.xp
 *   只提交封闭集合里的 gain-xp 动作，获得者缺省是能力控制者（190.6.d 的隐含 “you”）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - effects/keywords/ 没有 Hunt 的 KeywordDef（823 的展开：conquer 与 hold 两个触发时点 +
 *   effect.xp），因此 [Hunt] 这条能力本身没有可执行展开；823.1.b 的两个时点载荷（尤其是
 *   hold 的“本卡是在场固守的单位”，383.4.d.2）也尚未接线。
 * - 卡牌 keyword 能力 → KeywordDef 展开 → 触发注册的生产方未合入（契约 3.5/3.7）。
 * 依赖：kw-hunt 关键词任务（823；ability-templates 的 kw-hunt 行列为 trigger.score +
 * effect.xp）与触发→链管线（RIFT-33/RIFT-120）。
 * 不近似实现：不把 [Hunt] 手写成 conquer/hold 触发体（那是关键词文件的职责）。
 * “When you play me, gain 2 XP” 只用已合入的 effect.xp，golden 用解释器 + 参考内核真实执行。
 */
const abilities: Ability[] = [
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理（提醒文字同值）。
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "herald-of-spring.gain-2-xp",
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-31eb0f7b272ead3837c42e44cd4050722667b2142fc50acd5a91843a859b42cf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Hunt]（823.1）没有可执行的展开：effects/keywords/ 下没有 Hunt 的 KeywordDef，" +
    "823.1.b/823.1.c.1 要求的 conquer 与 hold 两个触发（823.1.c.2 省略值按 1；823.2 多来源求和）" +
    "以及卡牌 keyword 能力 → 关键词展开 → 触发注册的生产方（契约 3.5/3.7）都未合入，" +
    "hold 侧的“本卡是在场固守的那个单位”载荷绑定（383.4.d.2/.2.a）也没有接线。" +
    "依赖：kw-hunt 关键词任务（ability-templates 的 kw-hunt 行：trigger.score + effect.xp）" +
    "与触发→链管线（RIFT-33/RIFT-120）。" +
    "「When you play me, gain 2 XP」只用已合入的 effect.xp（728/729/730.1，获得者缺省为能力控制者，190.6.d），" +
    "golden 用解释器 + 参考内核真实执行。不近似实现：不把 [Hunt] 手写成 conquer/hold 触发体。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" + "When you play me, gain 2 XP."
} satisfies CardProgram;

export default program;
