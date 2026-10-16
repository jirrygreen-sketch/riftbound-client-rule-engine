import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Shadow (unl-194-219) — Unit，3 能量、无印刷 Power、Might 3，Calm/Chaos，
 * 标签 Vex / Shadow Isles / Signature。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-194-219，逐字）：
 *   If you play me to a battlefield, I enter ready.
 *   [Action][>] :rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: [Stun] an enemy unit
 *   attacking here. (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 143.4 / 143.4.a / 359.2.c：单位默认横置进场；"I enter ready" 是入场状态改写
 *   （369.3、805.6 的同族：Accelerate 也把"横置进场"替换成"就绪进场"，明确不是"先横置再就绪"）。
 *   355.2.b：打出到战场的单位可以带着改写后的入场状态进场。
 * - 806.1 / 806.1.a–c：Action 是许可类关键词，"[Action][>]" 是启动能力的写法（806.1 的
 *   "On Activated Abilities"），授予该能力在任意玩家回合的 Showdown 期间启动的许可；
 *   只声明关键词，展开属关键词注册表（契约 3.7）。
 * - 377.1 / 404.1.a / 415.3.a / 415.5：":" 之前是费用——1 energy + 1 点任意域 Power
 *   （:rb_rune_rainbow: = [A]，135.2.e.5 / 163.2.b）加上横置来源自身；合并费用管线
 *   （cost/plan-values.ts、cost/payment.ts）支持 energy 与 { kind: "exhaust", object: "self" }。
 * - 355.9 / 355.10 + 355.5："an enemy unit attacking here" 是单个由能力控制者选择的敌方
 *   单位 → 选目标；424.1 / 424.1.a：Stun 是效果型受限动作，effect.stun 已合入。
 *   括注 "(It doesn't deal combat damage this turn.)" 是 424.1.b 的提醒文本。
 *
 * status 判定（README 第 2 节）：judge-required —— 三处依赖未合入，均不近似实现：
 * 1. "I enter ready" 是入场替代（143.4 / 359.2.c / 369.3），而 replacement.enter 没有
 *    已合入的消费管线：events 的替代注册表存在，但没有把 CardProgram 的 replacement 能力
 *    注册进去的入口（RIFT-120 之后的卡牌适配），且 effect.ready 明确不参与入场流程
 *    （事后 ready 会产生额外的"成为就绪"事件）。
 * 2. 条件 "If you play me to a battlefield" 读的是打出时的入场位置，而打出位置状态在读
 *    上下文里没有可求值入口（ObjectSnapshot.location 在进场那一刻的记录方式未定义）。
 * 3. 启动能力的费用含 [A]（任意域 Power）：契约的封闭 Domain 只有六个命名域
 *    （Domain = Fury|Calm|Mind|Body|Chaos|Order），cost/plan-values.ts 的 domains() 对
 *    "rainbow" 会 invalid('Expected unique cost domains')，且 cost/payment.ts 的
 *    planDuelRunePayment 没有 domainless Power 资源（"ResolveContext cannot represent a
 *    domainless Power resource"），因此不能近似成任一具体域（同 malzahar-fanatic 的判定）。
 * 另外 "attacking here" 需要「本次战斗中作为攻击者」与「与来源同位置」两个限定：
 * 契约 3.8 的 ObjectSnapshot.combatRole 未合入（attack-declared/designation 的缺口，
 * 同 nine-tailed-fox 记录），sameLocationAs 锚点已合入但对 combatRole 无维度。
 * 依赖：RIFT-84（Action 消费方）、RIFT-89（费用管线与 Domain 契约）、RIFT-90（目标计划）、
 * RIFT-120（入场替代 + 战斗身份/时点）。
 */

/**
 * "If you play me to a battlefield" 的保留条件形状：需要"本次打出选择的入场位置是战场"这一
 * 事实。ObjectSnapshot 的 location 特征只有在对象已进场后才有值，而入场替代在换区前做决定；
 * 该读取不被已合入的表达式求值支持，取不到信息时解释器按 MissingInformation 处理（fail closed），
 * 不会把条件当成恒真。真实求值属入场替代管线（RIFT-120）。
 */
const PLAYED_TO_BATTLEFIELD: Condition = {
  kind: "compare",
  left: {
    kind: "object-property",
    object: "self",
    property: "shadow.played-to-battlefield"
  },
  operator: "eq",
  right: { kind: "constant", value: true }
};

const abilities: Ability[] = [
  // 806.1："[Action][>]" 是启动能力上的许可类关键词。
  { kind: "keyword", keyword: "action" },
  {
    // 143.4 / 359.2.c / 369.3："I enter ready" 是入场替代——把"横置进场"替换成"就绪进场"。
    // 真实的替代管线未合入（见 judgeReason 第 1 点）；这里保留可审查的形状，with 体的
    // effect.ready 是唯一的就绪动作（不写成"先横置再 ready"的双指令）。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    condition: PLAYED_TO_BATTLEFIELD,
    with: [
      {
        id: "shadow.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    // 806.1 的许可 + 377.1 的启动式写法；本卡没有印刷 Action 之外的时机，默认 Action 时机。
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      // 135.2.e.5 / 163.2.b：[A] 是任意域 Power，封闭 Domain 集合下没有可执行值
      // （见 judgeReason 第 3 点）；保留印刷记号，不近似成任一具体域。
      power: { kind: "constant", value: ["rainbow"] },
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "shadow.stun-attacker-here",
        op: "effect.stun",
        args: { target: { kind: "constant", value: "shadow.enemy-attacker-here" } },
        targets: [
          {
            id: "shadow.enemy-attacker-here",
            // 355.9 的选目标 + 053.3 的 "here" 锚点；"attacking" 需要 combatRole
            // （契约 3.8，未合入，见 judgeReason）。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              sameLocationAs: "source",
              combatRole: "attacker"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-4c764cb6248ef9337fc1c8769d4b74fc1d4c1fff6a9e8d00ca6753a560b3e74b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入：(1)「If you play me to a battlefield, I enter ready」是入场替代" +
    "（143.4/359.2.c/369.3），但 replacement.enter 没有已合入的消费管线——events 的替代注册表无法注册" +
    "CardProgram 的 replacement 能力，且 effect.ready 明确不参与入场流程（会多产生一次" +
    "\"成为就绪\"事件）；打出位置的事实也没有可求值入口（ObjectSnapshot.location 在进场前未定义）。" +
    "(2)「[Action][>]」的许可类关键词（806.1）没有已合入消费方：continuous.timing 的展开与 chain 的" +
    "canAct 时机查询未接线（effects/keywords/Action.ts 自注）；同类的启动能力默认 Action 时机。" +
    "(3) 费用中的 :rb_rune_rainbow:（[A]，135.2.e.5/163.2.b）在封闭 Domain 集合下不可表示——" +
    "cost/plan-values.ts 的 domains() 会拒绝 \"rainbow\"，cost/payment.ts 也没有 domainless Power 资源，" +
    "因此不能近似成任一具体域（同 malzahar-fanatic 的判定）。(4)「an enemy unit attacking here」需要" +
    "「本次战斗中作为攻击者」（契约 3.8 的 combatRole，未合入）与「here」（sameLocationAs，已合入）两个限定，" +
    "当前 ObjectFilter 没有 combatRole 维度（同 nine-tailed-fox 记录的攻击者身份缺口）。" +
    "程序保留替代形状与目标过滤（sameLocationAs + combatRole 占位）供审查；effect.ready 与 effect.stun 本体" +
    "已合入，golden 分段真实执行并覆盖目标失效分支。依赖：RIFT-84、RIFT-89、RIFT-90、RIFT-120。不近似实现。",
  abilities,
  sourceText:
    "If you play me to a battlefield, I enter ready.\n" +
    "[Action][>] :rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: [Stun] an enemy unit attacking here. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
