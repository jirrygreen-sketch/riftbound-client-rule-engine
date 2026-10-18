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
 *   （:rb_rune_rainbow: = [A]，135.2.e.5.a）加上横置来源自身；现有 kind:power 的
 *   allowedDomains 可列出六域，表示任意域的一个 Power，而不是六个 Power。
 * - 355.9 / 355.10 + 355.5："an enemy unit attacking here" 是单个由能力控制者选择的敌方
 *   单位 → 选目标；424.1 / 424.1.a：Stun 是效果型受限动作，effect.stun 已合入。
 *   括注 "(It doesn't deal combat damage this turn.)" 是 424.1.b 的提醒文本。
 *
 * status = judge-required（2026-10-18 对源码逐条复核）：
 * 两处当前缺口：(1) If you play me to a battlefield（CR 143.4/359.2.c/369.3）读不出"本次打出的目的地"：
 * replacement/bind.ts 的 matchesEnterAction 分支只校验 replaces.filter，不检查 ability.condition
 * （condition 只在非入场事件分支里经 testCondition 求值）；该条件用的
 * object-property(self, "shadow.played-to-battlefield") 也不在 ObjectSnapshot 特征里，
 * 实测把本卡的替代绑定到真实入场流程时，进入 Base 与进入战场都会 matches()（无法区分），
 * 因此直接绑定就是错误近似。(2) enemy unit attacking here 的过滤仍未贯通：ObjectSnapshot 已有 combatRole，
 * 解释器与层 filter 支持 sameLocationAs，但 programs/filters.ts 的 translateObjectFilter 白名单拒绝
 * sameLocationAs 与 combatRole（实测 "Unsupported filter field sameLocationAs"）；
 * 把 combatRole 改放进 characteristics 时，生产 ResolveContext.query（测试内核的 matchesQueryFilter）
 * 对 characteristics 不做求值而直接放过，实测 atk 与 idle 两个单位都入选（过度匹配），
 * 而 layers/filter.ts 的 characteristicsMatch 才会区分（atk true / idle false）——两种写法都不能
 * 单独得到"确实是攻击者且在同一战场"的目标集合。
 * Action 启动、替代绑定与 [A] 费用均已有可用接口；[A] 按 135.2.e.5.a 表示为允许六域支付的一个 Power 费用，
 * 不需要把任意域费用误当成新增 Universal Power 资源。
 */

/**
 * "If you play me to a battlefield" 的保留条件形状：需要"本次打出选择的入场位置是战场"这一
 * 事实。ObjectSnapshot 的 location 特征只有在对象已进场后才有值，而入场替代在换区前做决定；
 * 该读取不被已合入的表达式求值支持，取不到信息时解释器按 MissingInformation 处理（fail closed），
 * 入场替代还需保留并检查该条件。
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
    // 替代绑定本身已合入，目的地条件仍有缺口（见 judgeReason 第 1 点）；with 体的
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
      // 135.2.e.5.a：[A] 可由任意一个域的 Power 支付。
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        },
        { kind: "exhaust", object: "self" }
      ]
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
            // （ObjectSnapshot 已有该特征，但目标过滤尚未贯通，见 judgeReason）。
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
    "两处当前缺口：(1) If you play me to a battlefield（CR 143.4/359.2.c/369.3）读不出「本次打出的目的地」：" +
    "replacement/bind.ts 的 matchesEnterAction 分支只校验 replaces.filter、不检查 ability.condition" +
    "（condition 只在非入场事件分支里经 testCondition 求值），" +
    "程序里用的 object-property(self, \"shadow.played-to-battlefield\") 也不在 ObjectSnapshot 特征中；" +
    "实测把该替代绑到真实入场流程时，进入 Base 与进入战场都会 matches()，无法区分，直接绑定即错误近似。" +
    "(2) enemy unit attacking here 的 sameLocationAs/combatRole 过滤尚未贯通：ObjectSnapshot 已有 combatRole，" +
    "解释器已支持 sameLocationAs，但 programs/filters.ts 的 translateObjectFilter 白名单拒绝这两个字段" +
    "（实测 \"Unsupported filter field sameLocationAs\"）；把 combatRole 改放进 characteristics 会过度匹配：" +
    "生产 ResolveContext.query（测试内核 matchesQueryFilter）不对 characteristics 求值、直接放过，" +
    "实测攻击者与非攻击者两个单位都入选，而只有 layers/filter.ts 的 characteristicsMatch 区分二者" +
    "（atk true / idle false），两种写法都不能单独得到「确实是攻击者且在同一战场」的目标集合。" +
    "Action 启动、替代绑定与 [A] 费用均已有可用接口；[A] 按 135.2.e.5.a 表示为允许六域支付的一个 Power 费用，" +
    "不需要把任意域费用误当成新增 Universal Power 资源。",
  abilities,
  sourceText:
    "If you play me to a battlefield, I enter ready.\n" +
    "[Action][>] :rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: [Stun] an enemy unit attacking here. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
