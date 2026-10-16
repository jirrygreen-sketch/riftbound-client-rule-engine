import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bandle Soldier (unl-151-219) — Unit, Order, tags Yordle/Bandle City.
 * energy 4, power 1, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-151-219，逐字）：
 *   [Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 824.1.a / 824.1.b / 824.1.b.1：“[Level N][>] [Text]” 中从关键词到从句结尾整段是 Level Ability，
 *   功能上等于“当你有 3 点或更多 XP 时，本牌获得 ‘[Text]’”；824.1.b.2 规定 [Text] 是 Dependent Ability。
 * - 824.1.c / 824.1.c.1 / 824.1.d：控制者 XP 变化会即时让 Dependent Ability 生效/失活。
 * - “I enter ready” 是入场替代：单位默认横置进场（143.4、359.2.c），369.3 说明 “I enter ready”
 *   这类文本是替代进场方式的效果（该条以 Master Yi, Honed 为例）。effect.ready 的文件头明确它
 *   不参与入场替代，先横置入场再补一次 ready 会产生错误的“成为就绪”事件，故不近似。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Level N][>] 的 Dependent Ability 绑定没有消费方：effects/keywords/Level.ts 只发布
 *   condition.predicate（predicate \"level-active\"）供条件/图层管线使用，而卡牌侧既没有把
 *   Dependent Ability 挂在关键词实例上的编译形式，也没有 condition.predicate 的表达式/条件消费方
 *   （Condition 只有 always/never/compare/all/any/not/expression；读取 PlayerSnapshot.xp 没有
 *   Expr 路径）。卡内的 expression 常量 \"level-active:3\" 是谓词占位，不写成恒真条件。
 * - “I enter ready” 是入场事件替代（369.3 / replacement.enter 家族）：没有把 CardProgram
 *   replacement 能力注册进替代的消费方（事件管线只以动作匹配器注册替代）。
 * 依赖：RIFT-268 的 Level 展开后续（Dependent Ability 绑定与 XP 谓词求值）、
 * RIFT-260（入场替代绑定）、RIFT-91（图层条件求值）。with 体内的 effect.ready 原语已合入，
 * golden 用解释器 + 参考内核真实执行该半段。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    // 824.1.a：印刷的 “[Level 3]” 是带数值的关键词；Dependent Ability 由卡牌程序持有（824.1.b.2）。
    keyword: "level",
    value: 3
  },
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    // 824.1.c：“当控制者有 3 点或更多 XP 时 Dependent Ability 生效”。
    // 谓词占位（见 judgeReason）：XP 不是 ObjectSnapshot 特征，Condition 也没有读取它的形态。
    condition: { kind: "expression", value: { kind: "constant", value: "level-active:3" } },
    with: [
      {
        id: "bandle-soldier.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-121fc6b958b52f3a54986facd825169683558bc6c00ae71fbb3323be8b3a1f7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（均不近似实现）：(1) [Level 3][>] 的 Dependent Ability 没有可执行绑定——" +
    "effects/keywords/Level.ts 只发布 condition.predicate（predicate \"level-active\"，阈值 3）供条件/图层管线消费，" +
    "但卡牌侧没有把 Dependent Ability 挂在关键词实例上的编译形式，Condition 也没有读取控制者 XP 的形态" +
    "（只有 always/never/compare/all/any/not/expression，PlayerSnapshot.xp 没有 Expr 路径），" +
    "卡内的 expression 常量 \"level-active:3\" 是谓词占位，不写成恒真条件（824.1.b.1/824.1.c/824.1.c.1/824.1.d）。" +
    "(2) “I enter ready” 是入场替代（143.4/359.2.c，369.3 以 Master Yi, Honed 为例）：" +
    "没有把 CardProgram 的 replacement 能力注册进替代的消费方，effect.ready 不能代替" +
    "（其文件头明确不参与入场替代，先横置再补一次 ready 会多出一次“成为就绪”事件）。" +
    "依赖：RIFT-268 的 Level 展开后续（Dependent Ability 绑定与 XP 谓词求值）、RIFT-260（入场替代绑定）。" +
    "with 体内的 effect.ready（416.1）已合入，golden 用解释器 + 参考内核真实执行该半段。",
  abilities,
  sourceText: "[Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)"
} satisfies CardProgram;
