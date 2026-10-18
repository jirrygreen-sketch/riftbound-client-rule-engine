import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vex, Mocking (unl-055-219) — Unit, 5 Energy + 1 Calm Power, Might 5，Calm，
 * tag Yordle/Vex/Shadow Isles/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-055-219，逐字，含换行）：
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *   When you [Stun] an enemy unit at a battlefield, you may move me to that battlefield.
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.b.3 / 814.1.c：印刷的 [Shield] 未写数值，按 1 处理（功能上等价于
 *   "我是防御者时 +1 [M]"）；展开（带 Defender designation 条件的 static
 *   continuous.might）由已合入的 effects/keywords/Shield.ts 负责，卡牌只声明 keyword。
 * - 815.1 / 815.1.b/.c：印刷的 [Tank]，展开（continuous.combat 的分配优先级）由
 *   effects/keywords/Tank.ts 负责，卡牌只声明 keyword。
 * - 383.1："When you [Stun] an enemy unit at a battlefield" 是状态触发；Stun 是
 *   424.1 的动作，对应封闭时点 unit-stunned（events/timing-points.ts；由动作管线发出）。
 *   "you" 的责任与归因按 412.4/412.5（触发控制的玩家），因此 filter 用事件对象为敌方单位
 *   的写法（ogn/eclipse-herald、ogn/radiant-dawn 同型），不写 source: "self"——本卡不是
 *   该 Stun 的来源。
 * - 383.3.a.3："you may" 不在触发效果最开头之外的其它位置——它紧跟在触发条件之后、位于
 *   效果开头，按 383.3.a 是触发能力自身的 finalize 决定，由 TriggeredAbility.optional
 *   承载（exemplar-of-demacia / azir-sovereign 同型），而不是额外的 choice 节点。
 * - 421.1 / 449.1 / 359.3.f.1："move me to that battlefield" 是 Move 到「那次 Stun 发生的
 *   战场」；目的地是触发事件的信息，359.3.f.1 规定这类指代在指令执行时从参考对象读取。
 *   移动的对象是本卡（ObjectSelector "source"）；移动由已合入的 effect.move 提交。
 *
 * status = judge-required（2026-10-17 复核后更新缺口）：
 * - unit-stunned 的发射与触发注册已可运行：ChainEngine 构造 EventPipeline 时安装
 *   events/action-adapter.ts 的 host，programs/triggers.ts + filters.ts 能把本卡的对象过滤器
 *   翻成绝对 objectId 绑定并注册；golden 用真实 ChainEngine 提交一次 stun，实测
 *   unit-stunned 事件 + Pending Item 都进链（383.3）。仍缺的是“那次 Stun 的位置”载荷：
 *   事件只带被 Stun 的对象，而本卡目的地是事件里的战场。
 * - "that battlefield" 需要触发事件中目标单位的 location：合并 ObjectSelector 只有
 *   self/source/target/pick/linked，没有事件位置选择器，effect.move 的 to 只接受
 *   静态 LocationRef / controller-base / 静态候选列表。程序里的目的地是描述性标记，
 *   解释器会按 effect.move 的目的地校验拒绝它，不会把本卡移到错误地点。
 * - [Shield]（814.1.d.1 的 Defender designation）与 [Tank]（815.1.c 的分配优先级）的展开
 *   本身也没有默认路径的 designation 求值与战斗分配消费方，故关键词声明也不能算整卡可执行。
 * golden 用真实解释器 + 参考内核执行已合入的 effect.move 子指令（目的地由事件位置锁定后传入）。
 *
 * 依赖：事件位置选择器（受 Stun 单位所在地）、Shield/Tank 的战斗消费方。
 */

/**
 * 描述性目的地标记（不是可执行的 LocationRef）：“that battlefield” 是那次 Stun 发生的
 * 战场（359.3.f.1 的 referent）。effect.move 的 destination() 只接受 base / battlefield
 * 字面量或候选列表，因此该形状会被明确拒绝而不是移动到一个猜测的战场。
 */
const THAT_BATTLEFIELD = {
  kind: "destination-selector",
  referent: "stunned-unit-battlefield"
} as const;

const abilities: Ability[] = [
  // 814.1：印刷的 [Shield] 未写数值，按 README 第 5 节省略 value
  // （814.1.b.3 的预设 X = 1 由关键词展开负责）；卡只声明，不重写展开。
  { kind: "keyword", keyword: "shield" },
  // 815.1：印刷的 [Tank]；卡只声明，不重写展开。
  { kind: "keyword", keyword: "tank" },
  {
    kind: "triggered",
    trigger: {
      at: "unit-stunned",
      // 412.4/412.5："you [Stun] an enemy unit" —— 事件对象是被 Stun 的敌方单位
      // （424.1）；本卡不是该 Stun 的来源，因此不写 source: "self"。
      filter: { type: "unit", zone: "board", controller: "opponent" }
    },
    // 383.3.a：效果开头的 "you may" 是触发能力自身的 finalize 决定。
    optional: true,
    body: [
      {
        id: "vex-mocking.move-me",
        op: "effect.move",
        args: {
          // "me" = 能力宿主（契约 3.6 的符号选择器；effect.move 的对象选择符用
          // 它声明的 "source" 拼写，由解释器在运行时绑定）。
          objects: { kind: "constant", value: "source" },
          to: { kind: "constant", value: THAT_BATTLEFIELD },
          amount: { kind: "constant", value: 1 }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-6c81da534f503cae7bc5118d6be12f7c349fa24deecee1dad3aff06abb20eefd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5，2026-10-17 实测），均不近似实现：（1）unit-stunned 时点（424.1）的发射与订阅已可运行：" +
    "ChainEngine 构造 EventPipeline 时安装 events/action-adapter.ts 的 host，programs/triggers.ts + filters.ts 能把本卡的" +
    "对象过滤器翻成绝对 objectId 绑定并注册；golden 用真实 ChainEngine 提交一次 stun，实测 unit-stunned 事件与 Pending Item 都进链" +
    "（383.3 路径已通）。仍缺的是事件位置载荷：该事件只带被 Stun 的对象，不带那次 Stun 发生的战场。" +
    "（2）『move me to that battlefield』的『that battlefield』是那次 Stun 发生的战场（359.3.f.1 的 referent），" +
    "合并 ObjectSelector 只有 self/source/target/pick/linked，没有事件位置选择器，" +
    "effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表；程序里的目的地是描述性标记，" +
    "解释器会按目的地校验拒绝它，不会把本卡移到错误地点。" +
    "（3）[Shield]（814.1.d.1 的 Defender designation 条件）与 [Tank]（815.1.c 的分配优先级）的展开文件虽已合入，" +
    "designation 事实也由 ObjectSnapshot.combatRole + effects/interpreter/expr-ext/evaluate.ts 提供，" +
    "但默认条件/图层分派不接 expr-ext（condition.ts 的 evaluateCondition 只走 evaluateExpression、" +
    "programs/statics.ts 把条件异常吞成 false、layers/engine.ts 不调用 resolveLayerEffectExpressions），" +
    "且 continuous.combat 没有战斗分配消费方。" +
    "依赖：事件位置选择器（受 Stun 单位所在地）、默认路径的 designation 求值与 Shield/Tank 的战斗消费方。" +
    "effect.move 本体已合入，golden 用真实解释器 + 参考内核执行它（目的地按事件位置锁定后传入）。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When you [Stun] an enemy unit at a battlefield, you may move me to that battlefield."
} satisfies CardProgram;
