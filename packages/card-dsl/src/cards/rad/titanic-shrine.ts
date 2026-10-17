import type { CardProgram } from "../../ir/index.js";

/**
 * Titanic Shrine (rad-089-167) — Gear, 3 energy、power null，Body，tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-089-167）：
 *   "When you play a unit with Might greater than each other unit on the board,
 *    exhaust me to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4："当另一个对象被打出时触发"的能力不是 Play Effect，而是订阅 card-played
 *   时点的普通触发能力（条件包含“你打出一个单位”）。时点由 chain/engine.ts 产生。
 * - 204.1.c / 204.3 / 355.10.c.1："exhaust me to draw 1" 是成本内指令（[do X] to [do Y]）
 *   ——横置自身是费用、抽 1 是效果；费用必须支付，能力才成立。横置作为费用属于
 *   cost.exhaust / 费用计划（415.4/415.5），不是 effect.exhaust。
 * - 414.3："draw 1" 经 effect.draw 结算，抽牌者隐含为能力控制者（190.6.d）。
 *
 * status：judge-required。缺口：
 * 1. 成本内指令的费用表达与绑定：契约 3.1 的 TriggeredAbility 没有 cost 字段，
 *    programs/triggers.ts 也没有把卡牌程序里的触发费用绑定到 TriggerRegistration.cost；
 *    chain/engine.ts 已消费该注册费用并在 Finalize 支付计划，静态 IR 仍无法在 card-played
 *    时点表达“me”的 exhaust ObjectRef。
 * 2. "Might greater than each other unit on the board"：需要把被打出的单位从其
 *    card-played 事件载荷绑定出来（契约 3.6 的 ObjectSelector 没有“事件对象”形式），
 *    并对 Board 上其他单位做数值 Might 比较；events/pipeline-match.ts 的过滤器没有数值
 *    Might 匹配键，condition 也无法对“每个其他单位”逐一比较。
 * 3. 事件对象绑定与数值 Might 比较仍缺通用 IR/事件过滤消费方。
 * 不把条件近似成“总是成立”，也不把横置费用写成 effect.exhaust。
 */
export default {
  canonicalCardId: "card.hash-4647932ee2d6158c5f7a09247a187cb76e06c69e293aea63f24b3d7ee7dc2a7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「exhaust me to draw 1」是成本内指令（204.1.c/204.3/355.10.c.1）：" +
    "契约 3.1 的 TriggeredAbility 没有 cost 字段，programs/triggers.ts 也没有把该费用绑定到" +
    "TriggerRegistration.cost；chain/engine.ts 已消费注册费用并在 Finalize 支付计划，静态 IR 仍无法" +
    "在 card-played 时点给出“me”的具体 exhaust ObjectRef；(2)「Might greater than each other unit on the board」需要从 card-played " +
    "事件载荷绑定被打出的单位（ObjectSelector 没有事件对象形式），并对 Board 上其他单位做数值 " +
    "Might 比较（events/pipeline-match.ts 的过滤器没有数值 Might 键，condition 也无法逐一比较）；" +
    "(3) 事件对象绑定与数值 Might 比较仍缺通用 IR/事件过滤消费方。" +
    "Draw 1 原语已合入并单独执行；不近似实现条件与横置费用。",
  abilities: [
    {
      // 383.4.a.4：订阅 card-played（"you play a unit"）。"你"按触发控制者判定，
      // 用 trigger-spec.ts 的 PlayerSelector "self"；"Might greater than each other
      // unit on the board" 谓词无法表达（见 judgeReason 第 2 点），因此这里不写条件，
      // 不把条件近似成恒真。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // 被触发的能力必须确认“打出的牌是单位”。programs/filters.ts 只把嵌套
          // `filter` 之外的同级字段翻译成事件模式：`filter: { type, player }` 会整段
          // 被丢弃，只留下 self（实测会把对手打出的任意牌也算作“单位”）。
          // EventPattern.object（contract 3.5）才是被 events/pipeline-match.ts 消费的
          // 角色过滤器形状，因此把“类型是单位”写在这里。
          object: { type: "unit" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          // 204.3：横置自身是触发能力的费用（缺口见 judgeReason 第 1 点），触发体只声明
          // 费用支付后的效果——抽 1（414.3）。
          id: "titanic-shrine.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1."
} satisfies CardProgram;
