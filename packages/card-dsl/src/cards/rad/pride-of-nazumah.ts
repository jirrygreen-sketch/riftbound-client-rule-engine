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
 * status = judge-required（缺口均不近似实现）：
 * - 动态关键词授予没有可执行路径：continuous.grant-keyword（契约 3.7 / layers）
 *   尚未合入；而且授予值要读取“被授予单位当前的 Shield Value”——ObjectSnapshot
 *   只有 keywords: [{id, value}] 数组，Expr/Condition 没有读取某个关键词数值的
 *   位置（见 RIFT-87/91）。
 * - “this turn” 的到期处理需要 end-of-turn 持续效果（continuous.duration），同样
 *   属于 RIFT-91。
 * - 费用侧 cost.exhaust / cost.pay 没有已合入原语（RIFT-89）；另外契约的 ZoneId
 *   没有 Legend Zone（CR 107.4），传奇自身不能作为 Board 对象被横置——本仓其他
 *   传奇卡的注释记录了同一缺口。
 * 本卡只保留可审查的静态结构，golden 只做校验、结构断言与缺口 todo。
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
        // 契约 3.7 / RIFT-9 模板中的 continuous.grant-keyword；尚无已注册实现，
        // 本指令只作为待接线声明存在（见 judgeReason）。
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
    "「I have [Assault] equal to my [Shield] this turn」缺可执行路径：continuous.grant-keyword " +
    "持续效果与图层消费尚未合入（RIFT-91）；授予值还要读取被授予单位当前的 Shield Value" +
    "（CR 814.1.b.2；ObjectSnapshot 只有 keywords 数组，Expr/Condition 不能读取某个关键词数值）；" +
    "“this turn”的到期需要 end-of-turn 持续期限（continuous.duration，RIFT-91）。" +
    "费用侧 1 Energy + Exhaust this（CR 204.1.b / 415.4 / 415.5）需要 cost.exhaust / cost.pay " +
    "与费用计划（RIFT-89），且契约 ZoneId 没有 Legend Zone（CR 107.4），传奇自身无法作为可横置的 " +
    "Board 对象。依赖 RIFT-87（条件/谓词）、RIFT-89（batch3 费用计划）、RIFT-91（layers-continuous）；" +
    "不近似实现。",
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Give a friendly unit \"I have [Assault] equal to my [Shield]\" " +
    "this turn. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
} satisfies CardProgram;

export default program;
