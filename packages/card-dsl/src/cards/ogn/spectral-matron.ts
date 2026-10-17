import type { CardProgram } from "../../ir/index.js";

/**
 * Spectral Matron (ogn-226-298) - Unit, Order, Spirit/Shadow Isles (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-226-298):
 *   When you play me, you may play a unit costing no more than :rb_energy_3:
 *   and no more than :rb_rune_rainbow: from your trash, ignoring its cost.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a：打出本永久物后，Play Effect 作为 Pending Item 入链（时点 card-played，
 *   见 events/timing-points.ts 的 card-played 定义与 ruleRefs 359/383.4.a）。
 * - 383.3.e.2 / 383.3.e.2.a：以 "you may" 开头的是可选触发，Finalize 时由控制者决定是否
 *   生效；不生效则从链上移除（TriggeredAbility.optional）。
 * - 契约 3.9：may 从句必须写成 choice.optional，把被选的指令包在 body 里。
 * - 355.10.a / 355.10.a.1：Trash 是 Public Zone，不符合 "非公开区域不指向目标" 的例外，
 *   所以 "a unit ... from your trash" 是目标选择（对照 355.10.a 的例子："play a unit from
 *   your hand" 才不指向手牌）。
 * - 356.1.b.1："ignoring its cost" 把该卡的 base Energy cost 与 base Power cost 设为 0。
 *   本卡把这一已 finalize 的费用计划（FinalizedCostPlan）形状交给 effect.play；
 *   计划里的 0 是实现 356.1.b.1 的费用改写，不是把印刷值 null 改写成 0。
 * - 420.3 / 420.3.b.1：这是 game effect 造成的 Limited Play，正常走 Play 流程，
 *   除效果另有规定（ignored costs 正属此列）。
 * - 355.4 / 420.3.b.1：被 Play 的单位需要一个合法落点，落点选择属于 Play/Finalize 流程。
 *
 * status: judge-required —— 两处当前实现缺口均不近似实现：
 * 1. "costing no more than [3] and no more than [A]" 是对印刷费用的比较
 *    （356.1.c）。TargetSpec/ObjectFilter 不支持 printedEnergyMax、printedPowerMax 或
 *    printedPowerAnyDomain；生产绑定会拒绝这些字段，不能把上限当成普通特征筛选。
 * 2. "ignoring its cost" 的 finalized 费用计划必须由费用计划系统产出（cost.printed /
 *    ignore-cost 改写）：当前 instruction registry 没有 cost.printed 指令，effect.play
 *    也只接受调用方已经生成的计划，因此本卡的动态计划无法产生。
 */
const spectralMatron = {
  canonicalCardId: "card.hash-3424a772092b9d250c6d4500599a350ba292ea19b57c3ce08f4fccf1289e6478",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「costing no more than [3] and no more than [A]」需要按印刷费用比较的目标谓词（356.1.c）：" +
    "TargetSpec/ObjectFilter 不支持 printedEnergyMax / printedPowerMax / printedPowerAnyDomain，" +
    "生产绑定会以不支持的 filter 字段拒绝，不能把上限当成普通特征筛选；" +
    "「ignoring its cost」（356.1.b.1 把 base Energy/Power 设为 0）的 finalized 费用计划必须由费用计划系统产出：" +
    "当前 instruction registry 没有 cost.printed 指令，effect.play 只接受调用方已经生成的计划，" +
    "无法从锁定 Trash 单位生成只忽略 Energy、保留 Power 的计划。",
  sourceText:
    "When you play me, you may play a unit costing no more than :rb_energy_3: and no more than :rb_rune_rainbow: from your trash, ignoring its cost.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { role: "self" } },
      // 383.3.e.2.a：以 "you may" 开头的触发在 Finalize 由控制者决定是否生效。
      optional: true,
      body: [
        {
          id: "spectral-matron.may-play",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Play a unit from your trash, ignoring its cost?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "spectral-matron.play-trash-unit",
                  op: "effect.play",
                  args: {
                    target: { kind: "constant", value: "spectral-matron.trash-unit" },
                    // 356.1.b.1 的 ignored-cost 计划形状（energy/power 是费用，不是印刷特征）。
                    cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } },
                    linkKey: { kind: "constant", value: "spectralMatronPlayed" }
                  },
                  targets: [
                    {
                      id: "spectral-matron.trash-unit",
                      filter: {
                        type: "unit",
                        zone: "trash",
                        owner: "controller",
                        // 356.1.c 的印刷费用上限；选择管线尚无该谓词（见 judgeReason）。
                        printedEnergyMax: 3,
                        printedPowerMax: 1,
                        printedPowerAnyDomain: true
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
  ]
} satisfies CardProgram;

export default spectralMatron;
