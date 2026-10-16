import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Undying Loyalty (unl-168-219) — Spell, 2 energy + 1 Order power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-168-219，逐字):
 *   This costs :rb_energy_2: less if you choose a Bird, Cat, Dog, or Poro.
 *   Play a unit with cost no more than :rb_energy_2: and no more than
 *   :rb_rune_rainbow: from your trash, ignoring its cost.
 *
 * 规则依据（CR v1.5）:
 * - 「This costs [2] less if you choose a Bird, Cat, Dog, or Poro.」是印刷费用的
 *   条件折扣，在 Finalize 的费用步骤按 356.4（356.4.a/b/c）结算：条件成立时按
 *   356.4.d 对总费用减少 2 能量。折扣属费用系统，用 cost.modify 形状声明
 *   （与已合入的 ogn/find-your-center、sfd/production-surge 同一写法）。
 * - 「if you choose a Bird, Cat, Dog, or Poro」是折扣条件：需要判断本次打出的
 *   （或本次效果选择的）对象是否具有任一指定标签；四个标签是析取关系。
 * - 「Play a unit ... from your trash」是效果式 Play（420.3）。Trash 是公开区域，
 *   355.10.a / 355.9.a 使该牌成为目标（355.7）。
 * - 「cost no more than :rb_energy_2: and no more than :rb_rune_rainbow:」是 356.1.c
 *   的印刷费用上限：能量不超过 2，且力量不超过 1 点；:rb_rune_rainbow: 是 163.2.b 的
 *   Universal Power（[A]，任意域），由 effect.resources 记录为「封闭 Domain 类型不可表达、
 *   绝不近似成具名域」。
 * - 「ignoring its cost」按 356.1.b.1 把基础 Energy/Power 设为 0，必须由费用管线生成
 *   已 finalize 的计划。
 *
 * status: judge-required（缺口不近似实现）:
 * - 折扣条件需要「本卡打出的选择对象」与标签集合，冻结 IR 的 Condition 只读对象特征、
 *   链接值与计数，没有指向「本次费用选择结果」的读数（调研记为 condition.result）；
 *   费用系统侧的 cost.modify 折扣入口同样未合入（RIFT-89/RIFT-90）。
 * - 印刷费用上限谓词不存在：未知 filter 键会被 layers/filter.ts 与测试内核静默忽略，
 *   写成过滤器会放开对垃圾场单位的限制。
 * - :rb_rune_rainbow: 是 163.2.b 的 Universal Power，封闭 Domain 类型与 gain-power
 *   不表达（effect.resources 明确不近似；已合入程序的同一记录）。
 * - 「ignoring its cost」需要 finalized 零基础费用计划（RIFT-89）。
 * golden 用已合入的 effect.play + 显式零费计划对锁定目标真实执行，并单独执行
 * effect.channel 与 effect.draw 无关半段不适用（本卡无其它已合入指令）。
 *
 * 依赖：RIFT-89（费用计划/折扣/ignore-cost 接线）、RIFT-90（印刷费用上限谓词）、
 * Universal Power 的契约变更请求（163.2.b）。无本任务自有的契约变更。
 */
const abilities: Ability[] = [
  {
    // 「This costs [2] less if you choose a Bird, Cat, Dog, or Poro.」——
    // 356.4 的印刷费用折扣，由 Finalize 的费用系统消费（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "cost.modify",
      id: "undying-loyalty.discount",
      value: { kind: "constant", value: { energy: -2 } },
      resource: "energy",
      appliesTo: "play-cost"
    },
    // 折扣条件：「你选择了 Bird/Cat/Dog/Poro 之一」。四个标签是析取；读取的是
    // 本次打出的选择结果，冻结 IR 没有该读数（描述性名称，见 judgeReason）。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "you-choose-Bird-Cat-Dog-or-Poro" }
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 },
      power: { kind: "constant", value: 1 }
    },
    body: [
      {
        id: "undying-loyalty.play-unit",
        op: "effect.play",
        args: {
          target: { kind: "constant", value: "undying-loyalty.unit-in-trash" },
          // 356.1.b.1：ignoring its cost；计划由费用系统生成（RIFT-89）。
          cost: {
            kind: "constant",
            value: { finalized: true, energy: 0, power: [], xp: 0 }
          },
          linkKey: { kind: "constant", value: "played" }
        },
        targets: [
          {
            id: "undying-loyalty.unit-in-trash",
            // 356.1.c 的印刷费用上限（Energy <= 2、Power <= 1 且可为 [A]）：
            // 描述性写法，无消费方（见 judgeReason）。
            filter: {
              zone: "trash",
              type: "unit",
              owner: "controller",
              printedEnergyMax: 2,
              printedPowerMax: 1
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

const program = {
  canonicalCardId: "card.hash-7931567b3f67164c8892f798e2afcb96c5f980a4e74c3677fdb5e52bb602b376",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处依赖未合入：(1)「This costs :rb_energy_2: less if you choose a Bird, Cat, Dog, or Poro.」是 356.4 的印刷费用折扣，" +
    "Finalize 的费用系统需要 cost.modify 折扣入口（RIFT-89），且其条件需要一个指向「本次费用/打出选择结果」的读数" +
    "（调研记为 condition.result；冻结 IR 只读对象特征、链接值与计数）。(2)「cost no more than :rb_energy_2: and no more than " +
    ":rb_rune_rainbow:」是 356.1.c 的印刷费用上限谓词：冻结 ObjectFilter 没有该键，未知键会被 layers/filter.ts 与测试内核静默忽略，" +
    "写成过滤器等于放开选择范围。(3)「:rb_rune_rainbow:」是 163.2.b 的 Universal Power（[A]），封闭 Domain 类型与 gain-power " +
    "不表达；effect.resources 明确记录其 unsupported、绝不用具名域近似。(4)「ignoring its cost」按 356.1.b.1 需要 base Energy/Power 为 0 的 " +
    "finalized 费用计划，effect.play 从不自行推导印刷费用（RIFT-89）。golden 用已合入的 effect.play + 显式零费计划对锁定目标真实执行；不近似实现。" +
    "依赖：RIFT-89（费用计划/折扣/ignore-cost）、RIFT-90（印刷费用上限谓词）、Universal Power 的契约变更请求。",
  abilities,
  sourceText:
    "This costs :rb_energy_2: less if you choose a Bird, Cat, Dog, or Poro.\n" +
    "Play a unit with cost no more than :rb_energy_2: and no more than :rb_rune_rainbow: from your trash, ignoring its cost."
} satisfies CardProgram;

export default program;

