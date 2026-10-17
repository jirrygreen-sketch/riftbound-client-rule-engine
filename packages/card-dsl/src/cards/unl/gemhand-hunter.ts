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
 * status = judge-required（已按当前代码复核，缺口不近似实现）：
 * - [Hunt] 的 KeywordDef 展开、关键词注册以及 card-program → TriggerRegistration 适配均已合入；
 *   effect.xp 也有真实执行证据。剩余的征服/固守归因缺口在计分事件：turn/flow.ts 的 conquer/hold
 *   emission 只有 player 与 battlefieldId，没有把发生事件绑定到这张单位，故 Hunt 的 source:self
 *   过滤仍无法命中本卡。
 * - [Level 6] 的 KeywordDef 只发布带 controller-xp / threshold 的 level-active 谓词；当前条件求值
 *   没有读取玩家 XP，也没有把 `[>]` 后的依赖文本绑定成带该谓词的 continuous.might 能力，故无法按
 *   824.1.c 即时启用/停用「I have +1 :rb_might:」。
 * 依赖：计分事件的征服/固守单位载荷、Level predicate 的 XP 求值与 dependent-ability 绑定。
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
    "两处缺口，均不近似实现：(1) [Hunt] 的 KeywordDef 展开、关键词注册、card-program → TriggerRegistration 适配与 effect.xp 均已合入；" +
    "剩余问题是计分事件归因：turn/flow.ts 发出的 conquer/hold 只有 player 与 battlefieldId，没有发生征服/固守的单位对象，" +
    "因此 Hunt 展开出的 source:self 过滤无法命中本卡（823.1.b / 383.4.c.2 / 383.4.d.2）。" +
    "(2) [Level 6] 的 KeywordDef 只发布 controller-xp / threshold 的 level-active 谓词；当前条件求值不读取玩家 XP，" +
    "也没有把 `[>]` 后的「I have +1 :rb_might:」绑定成受该谓词控制的 continuous.might 能力，缺少 824.1.c 的即时 Active/Inactive 语义。" +
    "依赖：计分事件的征服/固守单位载荷、Level predicate 的 XP 求值与 dependent-ability 绑定。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "[Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default program;
