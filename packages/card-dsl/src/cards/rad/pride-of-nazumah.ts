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
 * 2026-10-18 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
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
        // 运行时仍不能从目标的 Shield 关键词特征得到动态值（见 judgeReason）。
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Assault" },
          // “equal to my [Shield]”：读取被授予单位自己的 Shield Value。
          // object-property 可声明该读取形状，但当前 ObjectSnapshot 没有 shield
          // characteristic，运行时只能保持 judge-required（见 judgeReason）。
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
    "continuous.grant-keyword 与 end-of-turn 持续期限已合入；「I have Assault equal to my Shield this turn」的 object-property 声明形状也能通过 IR 校验，但当前 ObjectSnapshot 只有 keywords 数组，没有可读取的 shield characteristic。" +
    "interpreter/expr.ts 因此对 object-property shield 抛 MissingInformation，解释器把指令标为 ignored/mistargeted；直接调用 grant primitive 也只能在收到 non-negative integer 时执行，不能用固定 Assault 值替代 CR 814.1.b.2 的动态 Shield Value。" +
    "1 Energy + Exhaust this（204.1.b、415.4/415.5）的计划能构建，但 cost/payment.ts 的 exhaust 校验只接受 board/rune-zone 对象；Legend Zone（107.4）不在当前 ZoneId/支付契约中，实测 payCostPlan 报 cannot-pay-cost。固定数值授予及 this-turn 到期已支持，不构成整卡执行证据。",
  abilities,
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Give a friendly unit \"I have [Assault] equal to my [Shield]\" " +
    "this turn. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
} satisfies CardProgram;

export default program;
