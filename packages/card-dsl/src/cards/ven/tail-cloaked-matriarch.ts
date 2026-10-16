import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tail-Cloaked Matriarch (ven-104-166) — Unit, Chaos, tag Ionia.
 * 4 Energy, no printed Power（`power: null`，不是 0），Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-104-166，逐字）：
 *   [Empower] :rb_energy_2::rb_rune_chaos: (:rb_energy_2::rb_rune_chaos:: Empower me. Use only if not
 *   Empowered.)
 *   When I become [Empowered], you may choose a unit in your trash with Energy cost no more than
 *   :rb_energy_3: and Power cost no more than :rb_rune_rainbow:. Play it to your base, ignoring its cost.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是启动能力关键词，功能等价于「[2 Energy + 1 Chaos Power]：
 *   Empower me。仅当未 Empowered 时启动。」827.1.b.1 说明来源自身不是目标。卡只声明关键词身份
 *   （契约 3.1 的 KeywordAbility 没有 params 字段承载印刷费用，见回复里的契约变更请求）。
 * - 828.1.d：「When I become [Empowered]」是 Dependent Ability 的触发条件；442.2.a 规定成为
 *   Empowered 是可被引用的游戏事件，封闭时点对应 empowered-changed（828.1.c 要求只取增加方向）。
 * - 383.3.a：效果首部的 “you may” 是触发能力的执行决定；契约 3.9 要求把被选指令包进
 *   choice.optional 的 body。
 * - 355.7 / 355.9.a：“choose a unit in your trash” 明确要求选择具体 Game Object，且垃圾场是
 *   公开区域（355.10.a.1），所以这是 Target（355.9.a 的 “Recycle a unit from your trash” 例子）。
 * - 356.1.b / 356.1.b.1：“ignoring its cost” 把该牌的基础 Energy 与基础 Power 费用置零
 *   （不是 356.1.a 的 “for [Cost]” 替换）；effect.play 只消费已 Finalize 的费用计划，
 *   从不自行推导印刷费用。
 * - 420.3：“Play it” 是游戏效果导致的 Play（Limited Action），位置由本效果指定为
 *   “to your base”，即能力控制者的 Base（440.2.b.1 的永久物创建位置）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，四处缺口均不近似实现：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的启动费用
 *    与“仅当未 Empowered 时”限制、828.1.b.1/828.1.d 的依赖能力门槛都无法展开（RIFT-83/84 批次
 *    不含它们，需新任务）。
 * 2. 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 里，empowered-changed 的
 *    载荷也没有增加方向过滤的消费方（同 souls-reflection/covert-informant 的记录，RIFT-87）。
 * 3. “with Energy cost no more than [3] and Power cost no more than [A]” 需要印刷费用上限比较：
 *    冻结的 ObjectFilter 没有费用谓词，已合入过滤器（layers/filter.ts、参考内核）也不读这类键，
 *    写成过滤器会让任意垃圾场单位合法（同 sfd/glasc-mixologist 的记录）。:rb_rune_rainbow: 是
 *    135.2.e.5.a/163.2.b 的 [A] 任意域 Power，六域封闭 Domain 集合无法表达。
 * 4. “ignoring its cost” 需要费用管线为**已被选中的那张牌**产出 ignore-base 的 Finalize 计划
 *    （356.1.b.1）；cost/cost-plan.ts 能表达 ignore-base，但没有卡牌程序 → 费用计划的接线
 *    （RIFT-89）。程序把它写成已 Finalize 的零基础费用计划形状（同 glasc-mixologist），
 *    并把“这个计划必须由费用管线为该目标产出”记在此处。
 * 已支持部分：effect.play 本体（在参考内核里把锁定的垃圾场单位按给定计划打出到基地）在 golden
 * 中真实执行。
 */
const abilities: Ability[] = [
  {
    // 印刷费 2 Energy + 1 Chaos Power 见 judgeReason 第 1 点；不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    kind: "triggered",
    trigger: {
      // 828.1.d / 442.2.a：成为 Empowered 的时点；“增加方向”过滤器见 judgeReason 第 2 点。
      at: "empowered-changed",
      filter: {
        event: "empowered-changed",
        filter: { player: "self", direction: "increase" }
      }
    },
    // 383.3.a：效果首部的 “you may” 是执行决定。
    optional: true,
    body: [
      {
        id: "tail-cloaked-matriarch.may-play",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a unit from your trash to your base, ignoring its cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "tail-cloaked-matriarch.play-it",
                op: "effect.play",
                args: {
                  target: {
                    kind: "constant",
                    value: "tail-cloaked-matriarch.unit-in-your-trash"
                  },
                  // “to your base”（420.3 / 440.2.b.1）：单位 Base 为目的地的静态写法。
                  location: {
                    kind: "constant",
                    value: { type: "base", player: "controller" }
                  },
                  // 356.1.b.1：“ignoring its cost” 把基础 Energy/Power 置零；effect.play 只接受
                  // 已 Finalize 的计划，本常量是该计划的形状（产出接线见 judgeReason 第 4 点）。
                  cost: {
                    kind: "constant",
                    value: { finalized: true, energy: 0, power: [] }
                  },
                  linkKey: { kind: "constant", value: "played" }
                },
                targets: [
                  {
                    id: "tail-cloaked-matriarch.unit-in-your-trash",
                    // “a unit in your trash”：垃圾场是公开区域（355.10.a.1），因此是目标。
                    // costEnergyLte / costPowerLte 是 356.1.b 印刷费用上限的描述性记录
                    // （无消费方，见 judgeReason 第 3 点）。
                    filter: {
                      zone: "trash",
                      type: "unit",
                      owner: "controller",
                      costEnergyLte: 3,
                      costPowerLte: 1
                    },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-3799ed0e95297410e29a35f17acda5f84a6efe71a60d927d529051f350de1aa6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的「2 Energy + 1 Chaos Power：Empower me，仅当未 Empowered 时启动」与 828.1.d 的依赖能力门槛" +
    "都无法展开（RIFT-83/84 批次不含它们，需新的关键词任务）；(2) 442.1.a 的 Empowered 二元状态不在 " +
    "ObjectSnapshot / Condition 里，empowered-changed 载荷也没有增加方向过滤的消费方（RIFT-87）；" +
    "(3)「with Energy cost no more than :rb_energy_3: and Power cost no more than :rb_rune_rainbow:」需要印刷费用上限比较，" +
    "但冻结的 ObjectFilter 没有费用谓词、已合入过滤器也不读这类键（写成过滤器会让任意垃圾场单位合法）；" +
    "[A] 任意域 Power（135.2.e.5.a / 163.2.b）在六域封闭 Domain 集合里不可表达（同 sfd/glasc-mixologist）；" +
    "(4)「ignoring its cost」需要费用管线为被选中的那张牌产出 ignore-base 的 Finalize 计划（356.1.b.1），" +
    "cost/cost-plan.ts 能表达 ignore-base 但没有卡牌 → 计划的接线（RIFT-89）。" +
    "已支持部分：effect.play 本体在 golden 中按锁定目标与零基础费用计划真实执行。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_chaos: (:rb_energy_2::rb_rune_chaos:: Empower me. Use only if not Empowered.)\n" +
    "When I become [Empowered], you may choose a unit in your trash with Energy cost no more than " +
    ":rb_energy_3: and Power cost no more than :rb_rune_rainbow:. Play it to your base, ignoring its cost."
} satisfies CardProgram;
