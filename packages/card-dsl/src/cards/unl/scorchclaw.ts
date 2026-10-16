import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scorchclaw (unl-016-219) — Unit, 3 Energy + 1 Fury power, Might 3, Fury,
 * tags Dog/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-016-219，逐字）：
 *   "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n"
 *   "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)"
 *
 * 规则依据（CR v1.5）：
 * - [Hunt 2]（823）：823.1 是 Triggered Ability 关键词、823.1.a 出现在单位上；823.1.b 同时是
 *   Conquer 与 Hold 效果；823.1.c / 823.1.c.1 定义格式与功能文本 "When I Conquer or Hold, my
 *   controller gains X XP."；823.1.c.2 省略 X 时视为 1（本例印刷 X = 2）；823.2 多来源的 Hunt
 *   Value 相加；823.3 说明这是可被引用的特征。卡按契约 3.7 只声明 keyword 与印刷值，展开
 *   （conquer/hold 触发 + effect.xp）归 effects/keywords/Hunt.ts。
 * - [Level 3][>]（824）：824.1 是 Dependent Keyword，824.1.a 的格式为 "[Level [N][>] [Text]"；
 *   824.1.b / 824.1.b.1 说明从关键词到子句结尾整段是 Level Ability，功能上等价于 "While you
 *   have [N] or more XP, this card gains '[Text]'"；824.1.c / 824.1.d 说明控制者 XP 变化会即时让
 *   依赖能力 Active / Inactive。因此这里的两条子效果是同一依赖能力的两个部分：
 *   · "I have +1 :rb_might:" 是对 Effective Might 的算术修正（143.2.a / 475 / 477），归 layers 的
 *     continuous.might（不是 702 的 Buff 计数器）；
 *   · "enter ready" 是入场替代（359.2.c / 369.3；805.6.a 说明不经过先横置再就绪的中间状态），
 *     按契约 3.1 写成 replacement 能力。
 *   括号内的 "(While you have 3+ XP, get the effect.)" 是 824.1.b.1 的提醒文本，不是第三条能力。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Hunt 2] 没有 KeywordDef（effects/keywords/ 下无 Hunt.ts），823.1.c.1 的 conquer/hold
 *   触发与 XP 获得没有展开实现；卡文件不自行手写一套等价触发（README 第 5 节：关键词只声明，
 *   展开归关键词文件）。
 * - [Level 3][>] 的依赖关键词没有展开：824.1.c 的"控制者 XP ≥ N"需要可求值的 XP 谓词，
 *   合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，PlayerSnapshot.xp
 *   没有进入 Expr / 谓词的路径；824.1.c.1 / 824.1.d 的即时失活同样缺失。
 * - 两条子效果各自的依赖也未合入：continuous.might（图层算术修正）与 replacement.enter
 *   （入场替代消费方）都没有卡牌可用的注册与执行路径。
 *
 * 依赖：Hunt / Level 的关键词展开任务、RIFT-91（layers-continuous 与入场替代接线）、
 * RIFT-89/90（条件与谓词管线）、RIFT-120（卡牌触发注册）。
 */
const abilities: Ability[] = [
  // 823.1.c：印刷为 "Hunt 2"，Hunt Value = 2（823.1.c.2 的缺省 1 不适用）。
  { kind: "keyword", keyword: "hunt", value: 2 },
  {
    kind: "static",
    // 824.1.b.1：Level 3 依赖能力的 "I have +1 :rb_might:" 分支；XP 门槛见 judgeReason。
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    condition: {
      // 824.1.c："While you have 3+ XP"。count 表达式的 subject 记录 XP 门槛语义；
      // PlayerSnapshot.xp 没有 Expr 读取路径（见 judgeReason），该形状当前不可求值。
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 3 }
    }
  },
  {
    kind: "replacement",
    // 824.1.b.1 的第二个分支 "and enter ready"（359.2.c / 369.3 的入场替代）。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
      operator: "gte",
      right: { kind: "constant", value: 3 }
    },
    with: [
      {
        id: "scorchclaw.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-2958889db75762be77762e57c20843ec822b4e17041923975b21d9edc0fd4494",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) [Hunt 2]（823）没有 KeywordDef——effects/keywords/ 下无 Hunt.ts，" +
    "823.1.c.1 的「When I Conquer or Hold, my controller gains 2 XP」没有展开实现；按 README 第 5 节，" +
    "卡文件不自行手写一套等价触发，也不把该关键词近似成 effect.xp 的常驻指令。" +
    "(2) [Level 3][>]（824.1 的 Dependent Keyword）没有展开：824.1.c 的「控制者 XP ≥ N」需要可求值的 XP 谓词，" +
    "合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，PlayerSnapshot.xp 没有进入 Expr / 谓词的路径，" +
    "824.1.c.1 / 824.1.d 的即时失活同样缺失。" +
    "(3) 依赖能力的两条子效果各自也缺执行路径：「I have +1 :rb_might:」是 arithmetic 图层的 continuous.might" +
    "（143.2.a / 475），卡牌可用的注册入口未合入（registerContinuousEffect 无调用方）；「enter ready」是入场替代" +
    "（359.2.c / 369.3），replacement.enter 管线未合入，effect.ready 不能模拟（会多产生一次“成为就绪”事件）。" +
    "依赖：Hunt / Level 的关键词展开任务、RIFT-91（layers-continuous 与入场替代接线）、RIFT-89/90（条件与谓词管线）、" +
    "RIFT-120（卡牌触发注册）。不近似实现。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
