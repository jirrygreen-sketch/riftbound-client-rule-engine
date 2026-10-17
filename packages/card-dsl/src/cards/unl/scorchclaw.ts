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
 * status = judge-required：
 * 两处当前缺口：(1) Hunt 2（CR 823.1.c.1）的 conquer/hold 时点已经由 turn/flow.ts 发出，但事件只有 player 与 battlefieldId，
 * 没有承载 Hunt 的单位 object，无法匹配 programs/triggers.ts 翻译出的自身过滤。(2) Level 3（824.1.b.1/824.1.c/824.1.d）
 * 需要实时读取控制者 XP；现有 count 表达式不读取 controller-xp，Level 展开的 condition.predicate 也未接入依赖能力绑定。
 * 此外 replacement/bind.ts 的 matchesEnterAction 分支未检查 ability.condition，不能证明带 XP 门槛的入场替代正确（RIFT-359）。
 * continuous.might、replacement.enter 与 programs/ 的图层/替代绑定均已合入，不能再将注册路径列为缺口。
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
    "两处当前缺口：(1) Hunt 2（CR 823.1.c.1）的 conquer/hold 时点已经由 turn/flow.ts 发出，但事件只有 player 与 battlefieldId，" +
    "没有承载 Hunt 的单位 object，无法匹配 programs/triggers.ts 翻译出的自身过滤。(2) Level 3（824.1.b.1/824.1.c/824.1.d）" +
    "需要实时读取控制者 XP；现有 count 表达式不读取 controller-xp，Level 展开的 condition.predicate 也未接入依赖能力绑定。" +
    "此外 replacement/bind.ts 的 matchesEnterAction 分支未检查 ability.condition，不能证明带 XP 门槛的入场替代正确（RIFT-359）。" +
    "continuous.might、replacement.enter 与 programs/ 的图层/替代绑定均已合入，不能再将注册路径列为缺口。",
  abilities,
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
