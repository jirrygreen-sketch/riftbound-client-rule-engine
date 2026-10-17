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
 * status: judge-required —— 2026-10-17 复核后的当前真实缺口（均已实测，不近似实现）：
 * 1. "costing no more than [3] and no more than [A]" 是按印刷费用比较的目标谓词
 *    （356.1.c）。programs/filters.ts 的 translateObjectFilter 只允许
 *    objectId/cardId/canonicalCardId/type/controller/owner/zone/location/states/tags/
 *    characteristics，实测对这些印刷费用上限字段直接抛 ProgramBindingError
 *    "Unsupported filter field printedEnergyMax"，因此整卡在生产绑定处 fail-closed。
 *    需要选择管线支持印刷费用谓词（或契约变更）。
 * 2. choice.optional 体内的指令带 targets，而链的 Finalize 面拒绝嵌套目标：
 *    chain/engine.ts 的 assertFinalizationSurface 抛 ChainContractBlockedError
 *    "Nested/repeated targets require an interpreter target-selection lifecycle adapter"。
 *    需要指令内目标的 Finalize/Resolve 选择生命周期。
 * 3. "ignoring its cost" 需要一个按被锁定 Trash 对象动态生成的 finalized 计划：
 *    instruction registry 里没有读取对象印刷费用的指令（无 cost.printed），
 *    cost.modify 只消费调用方提供的印刷目录投影（printed 参数），effect.play 只接受已
 *    finalize 的计划，两者之间没有「锁定对象 → 忽略费用计划 → 打出」的接线。
 *
 * 已合入且由 golden 真实执行的部分：choice.optional 的接受/拒绝、effect.play 的
 * 零费用计划打出（Trash → Board）、以及真实程序在生产绑定处的 fail-closed 行为。
 */
const spectralMatron = {
  canonicalCardId: "card.hash-3424a772092b9d250c6d4500599a350ba292ea19b57c3ce08f4fccf1289e6478",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（复核 2026-10-17，均已实测）：(1)「costing no more than [3] and no more than [A]」" +
    "需要按印刷费用比较的目标谓词（356.1.c）：programs/filters.ts 的 translateObjectFilter 只允许 " +
    "objectId/cardId/canonicalCardId/type/controller/owner/zone/location/states/tags/characteristics，" +
    "实测对 printedEnergyMax 直接抛 ProgramBindingError「Unsupported filter field printedEnergyMax」，" +
    "整卡在生产绑定处 fail-closed，需要选择管线支持印刷费用谓词（或契约变更）。" +
    "(2)「选择一张 Trash 单位」是 choice.optional 体内的指令目标，而链的 Finalize 面拒绝嵌套目标——" +
    "chain/engine.ts 的 assertFinalizationSurface 抛 ChainContractBlockedError「Nested/repeated targets " +
    "require an interpreter target-selection lifecycle adapter」，需指令内目标的 Finalize/Resolve 选择生命周期。" +
    "(3)「ignoring its cost」（356.1.b.1：base Energy/Power 置 0）需要按被锁定的 Trash 对象动态生成 finalized " +
    "计划：instruction registry 中不存在读取对象印刷费用的指令（无 cost.printed——本程序里的 cost.printed 是待合入声明），" +
    "cost.modify 只消费调用方提供的印刷目录投影，effect.play 只接受已 finalize 的计划；缺「锁定对象 → 忽略费用计划 → 打出」的接线。" +
    "已合入并由 golden 真实执行：choice.optional 的接受/拒绝、effect.play 的零费用计划打出（Trash → Board）。不近似实现。",
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
                        // 356.1.c 的印刷费用上限；选择管线尚无该谓词（见 judgeReason 第 1 点）。
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
