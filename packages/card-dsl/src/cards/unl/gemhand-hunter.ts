import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gemhand Hunter (unl-094-219) — Unit, 2 energy，无印刷力量，Might 2，Body，
 * 标签 Yordle/Mount Targon。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-094-219，逐字）：
 *   [Hunt] (When I conquer or hold, gain 1 XP.)
 *   [Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - [Hunt]（823.1 / 823.1.c.1 / 823.1.c.2）：触发能力关键词，功能等价于“当我征服或固守时，
 *   我的控制者获得 X XP”；省略数值按 Hunt 1（823.1.c.2），因此 keyword 声明省略 value。
 *   展开（两条 triggered：conquer / hold + effect.xp）属关键词注册表。
 * - [Level 6][>]（824.1.a / 824.1.b.1 / 824.1.c）：依赖式关键词，从关键词到子句结尾整段是
 *   Level Ability；“I have +1 :rb_might:” 是依赖能力文本，门槛 6 写在 keyword 的 value 上
 *   （824.1.c：控制者 XP ≥ 6 时 Active，XP 变化即时生效）。
 *
 * status = judge-required（缺口均不近似实现）：
 * - [Hunt]（823）的展开体（keywords/Hunt.ts，RIFT-265）只是数据：scoring/ 目前只返回
 *   triggerScore/triggerMethod 标志而不把 conquer/hold 发进唯一事件管线，
 *   也没有 CardProgram/keyword → TriggerRegistration 的注册路径（RIFT-120），所以“征服或固守时
 *   获得 XP”无法进入链。
 * - [Level 6]（824.1）依赖式关键词没有消费方：keywords/Level.ts（RIFT-268）只输出
 *   condition.predicate / controller-xp 的谓词声明，合并 IR 的 Condition 无法读取控制者 XP，
 *   也没有把它绑定到 dependent ability 的注册路径；依赖能力“I have +1 :rb_might:”还需要
 *   continuous.might 图层修正的消费方（RIFT-91）。
 * 依赖：RIFT-265 / RIFT-268 的关键词展开接线、RIFT-120（触发注册与 conquer/hold 事件）、
 * RIFT-91（图层 Might 修正与依赖能力绑定）。
 */
const abilities: Ability[] = [
  // 823.1.c.2：省略数值按 Hunt 1，故省略 value。
  { kind: "keyword", keyword: "hunt" },
  // 824.1.a：[Level 6][>]；门槛 6 是关键词数值，依赖能力文本见文件头。
  { kind: "keyword", keyword: "level", value: 6 }
];

const program = {
  canonicalCardId:
    "card.hash-ab13903af22d097efdc5e4e666b4055e6ef532fd5138f05aef5bd99a8ae78a8c",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口，均不近似实现：(1) [Hunt]（823.1）的展开体（keywords/Hunt.ts，RIFT-265）只是数据：" +
    "scoring/ 只返回 triggerScore/triggerMethod 标志、未把 conquer/hold 发进唯一事件管线，也没有 keyword → TriggerRegistration 的注册路径" +
    "（RIFT-120），因此「When I conquer or hold, gain 1 XP」（823.1.c.1 / 823.1.c.2）无法获得 XP。" +
    "(2) [Level 6]（824.1）依赖式关键词没有消费方：keywords/Level.ts（RIFT-268）只输出 condition.predicate / controller-xp 的谓词声明，" +
    "合并 IR 的 Condition 无法读取控制者 XP（824.1.c 的即时 Active/Inactive 判定缺失），也没有把门槛绑定到 dependent ability 的注册路径；" +
    "依赖能力「I have +1 :rb_might:」还需要 continuous.might 图层修正的消费方（RIFT-91）。" +
    "依赖：RIFT-265 / RIFT-268 的关键词展开接线、RIFT-120（触发注册与 conquer/hold 事件）、RIFT-91（图层 Might 修正与依赖能力绑定）。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "[Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default program;
