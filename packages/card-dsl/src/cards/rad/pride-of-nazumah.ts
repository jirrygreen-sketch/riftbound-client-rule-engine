import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pride of Nazumah (rad-147-167 / rad-172-167) — Legend, Calm/Body, tag K'Sante.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-147-167，逐字）：
 *   ":rb_energy_1:, :rb_exhaust:: Give a friendly unit \"I have [Assault] equal to
 *    my [Shield]\" this turn. (+1 :rb_might: for each instance of Assault while
 *    it's an attacker.)"
 *
 * 规则依据（CR v1.5）：
 * - 204.1.b / 415.5：冒号前的 ":rb_energy_1:, :rb_exhaust:" 是启动能力的费用
 *   （1 点 Energy + “Exhaust this”）；415.4 要求费用必须能完成，所以横置属于费用
 *   而不是 effect.exhaust 的状态改变。费用计划由 chain/cost 在 Finalize 检查
 *   （契约 3.1 的 ActivatedAbility.cost、3.5 的链）。
 * - 355.9.a.1 / 355.10：“Give a friendly unit …”指定的友方单位是目标（Board 是
 *   公开信息），因此写成 TargetSpec（type unit、controller 为本能力控制者）。
 * - “I have [Assault] equal to my [Shield] this turn”：把 Assault 关键词授予该
 *   单位，数值等于它自己的 Shield Value（807.2 多个 Assault 相加；814.1.b.2 定义
 *   Shield Value），期限到本回合结束。
 *
 * status = judge-required（2026-10-17 复核，两条缺口均实测，不近似实现）：
 * - continuous.grant-keyword 已合入（RIFT-258），但授予值 “equal to my [Shield]” 仍不可
 *   求值：Expr 没有读取某个关键词数值的位置——object-property 只按 ObjectSnapshot 的
 *   属性表取值，keywords 是 [{id, value}] 数组而非 "shield" 属性（interpreter/expr.ts 的
 *   hasOwn 检查）。实测两条路径都不产生 Assault：经解释器抛出 MissingInformation 后该指令
 *   ignored/mistargeted；直接调 continuous.grant-keyword 则因求值结果不是整数而抛
 *   「value must be a non-negative integer」。需要“关键词值读取”表达式契约支持。
 * - 费用侧 1 Energy + "Exhaust this" 已能构建费用计划（实测 buildCostPlan 读到 "activated"
 *   的 energy 1 与一条 exhaust action），但支付被 cost/payment.ts 拒绝，实测
 *   payCostPlan 抛 cannot-pay-cost「An exhaust cost requires a ready controlled object on the Board」：
 *   契约 ZoneId 没有 Legend Zone（CR 107.4），传奇不在 Board 上，无法作为启动费用对象。
 * - “this turn” 的到期本身由 continuous.might/grant-keyword 的 duration 别名支持
 *   （end-of-turn），但必须与该动态值一起落地。
 * 本卡保留可审查的静态结构，golden 做校验、结构断言、真实执行证据与缺口 todo。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // 传奇的默认时机是 310.1.a / 415.3 的 Limited Action；这里只声明速度，合法性
    // 判定归 chain（契约 3.1 ActivatedAbility.timing、3.5 时机许可）。
    timing: "action",
    cost: {
      // cost/plan-values.ts 接受的 CostSpec.kind 词汇是 "activated" / "explicit"；
      // 这里用 "activated" 表示印刷在冒号前的启动费用（204.1.b）。
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      // [E] 是“Exhaust this”（415.5）的费用，必须可完成（415.4）。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    body: [
      {
        id: "pride-of-nazumah.grant-assault",
        // 契约 3.7 / 连续效果模板中的 continuous.grant-keyword；op 与图层消费已合入，
        // 本指令的动态数值读取仍缺（见 judgeReason）。
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Assault" },
          // “equal to my [Shield]”：读取被授予单位自己的 Shield Value。
          // 关键词数值读取在合并 IR 里没有表达位置，见 judgeReason。
          value: {
            kind: "object-property",
            object: { target: "pride-of-nazumah.friendly-unit" },
            property: "shield"
          },
          // “this turn”：end-of-turn 期限（continuous.duration）。
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            id: "pride-of-nazumah.friendly-unit",
            filter: { type: "unit", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-429ae86450b57eb8b5283953594d1e2375732b2cc9c460d030a5a5b418afd418",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I have [Assault] equal to my [Shield] this turn」仍不可执行：(1) 授予值读取——" +
    "continuous.grant-keyword 与图层消费已合入，但 Expr 没有读取某对象关键词数值" +
    "（Shield Value，814.1.b.2）的位置：ObjectSnapshot.keywords 是 [{id, value}] 数组，" +
    "object-property 按属性表取值并对缺失属性抛 MissingInformation（interpreter/expr.ts）；" +
    "实测经解释器该指令 ignored/mistargeted，直接调 continuous.grant-keyword 则抛" +
    "「value must be a non-negative integer」，两种路径都不产生 Assault。" +
    "需要关键词数值读取表达式（契约变更请求）。(2) 费用侧 1 Energy + Exhaust this" +
    "（204.1.b / 415.4 / 415.5）：费用计划已能读到 activated 的 energy 1 与 exhaust action" +
    "（实测 buildCostPlan），但 cost/payment.ts 的 exhaust 校验只接受 board/rune-zone，实测 " +
    "payCostPlan 抛 cannot-pay-cost「An exhaust cost requires a ready controlled object on the " +
    "Board」；契约 ZoneId 没有 Legend Zone（CR 107.4 的 Champion Legend 就在该区域且不是 Board 对象）。" +
    "依赖：关键词数值读取表达式（契约变更请求）与 Legend Zone 的契约支持；不近似实现" +
    "（不把 Shield 值写成固定常量，不为传奇伪造 Board 目标）。",
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Give a friendly unit \"I have [Assault] equal to my [Shield]\" " +
    "this turn. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
} satisfies CardProgram;

export default program;
