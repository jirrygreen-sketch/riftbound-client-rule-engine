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
 * status = judge-required：
 * - [Hunt] 的征服/固守事件仅有 player 与 details.battlefieldId，缺少在场单位归因；
 *   programs/filters.ts 把 source:self 翻译为事件 objectId，无法据此匹配本卡（383.4.c.2/d.2）。
 * - [Level 6] 的 controller-xp / level-active 谓词尚无求值与依赖能力绑定；
 *   programs/statics.ts 也没有 condition.predicate 的图层映射，不能即时启停 +1 Might（824.1.c）。
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
    "缺 [Hunt] 的计分单位归因（CR 823.1.b、383.4.c.2/383.4.d.2）：turn/flow.ts 的 conquer/hold 只带 player 与 details.battlefieldId，未携带在场单位对象/快照，source:self 翻译后的 objectId 无法匹配本卡。缺 [Level 6] 的 controller-xp / level-active 求值与 [>] 依赖能力绑定（824.1.c）：programs/statics.ts 没有 condition.predicate 的图层映射，无法随控制者 XP 即时启停 continuous.might 的 +1 Might。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "[Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)"
} satisfies CardProgram;

export default program;
