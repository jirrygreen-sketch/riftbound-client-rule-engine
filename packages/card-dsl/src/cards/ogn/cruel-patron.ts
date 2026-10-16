import type { CardProgram } from "../../ir/index.js";

/**
 * Cruel Patron (ogn-208-298) — Unit, 4 energy, Might 6（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-208-298）：
 *   As an additional cost to play me, kill a friendly unit.
 *
 * 规则依据（CR v1.5）：
 * - 356：Additional Costs 在总费用步骤加入基础费用；Finalize 必须能支付（356/357.2），
 *   无法支付则整笔费用回滚（203.3）。
 * - 429：Kill 是受限动作；作为费用的消灭与作为效果的消灭分开建模（原语 effect.kill 只做效果
 *   消灭，见 effect.kill.ts 的边界注释：费用消灭归 cost 计划）。
 * - 355.10.c：「As an additional cost to play me, kill a friendly unit」不指目标——费用里的
 *   对象选择不是目标，不触发「成为目标」类触发。
 *
 * 结构（契约 3.1/3.2）：
 * - 单个 play 能力，费用里声明一个 additional 支付的 kill 组件；body 为空（打出本身无其余效果）。
 * - kill 支付用 PickSpec（非目标选择）表达「一个友方单位」；契约 3.6 禁止 IR 出现运行时
 *   ObjectRef，因此选项只能写成描述性占位（对照 sfd/assembly-rig.ts、sfd/strike-down.ts 的写法）。
 *
 * status = judge-required：费用侧形状与已合入的费用计划器不一致，且静态 IR 无法给出 kill 支付
 * 的动态对象集合。见 judgeReason。
 */
const cruelPatron = {
  canonicalCardId: "card.hash-ea1f0540f042966387899650fa2fbb3646f2d1d8ad7264dd83eb0fee4bd953de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺已合入的费用入口与动态对象选择：(1) 已合入的 cost 计划器（RIFT-89）只接受 kind 为 " +
    "printed/activated/explicit 的 CostSpec，卡面「As an additional cost」无法用它表达" +
    "（CostPlanError: Unsupported cost kind: additional），且 printed 费用禁止附带 payments，" +
    "卡牌程序没有把「印刷基础费用 + 强制附加费用」合成一个计划的字段；" +
    "(2) kill 支付需要精确的运行时 ObjectRef 或枚举出全部合法对象，而契约 3.6 规定静态 IR " +
    "不能出现 ObjectRef，PickSpec.options 又是静态值，因此「一个友方单位」无法落到费用计划。" +
    "依赖：RIFT-89（费用计划的卡牌侧附加费用形状）、以及费用对象选择的契约扩展；" +
    "不近似实现（不用占位字符串冒充运行时引用，也不把费用消灭写成效果 effect.kill）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "kill",
            choice: {
              // 非目标费用选择（355.10.c）；options 是描述性占位，最终必须由引擎按 filter 展开为
              // 运行时合法对象集合（契约 3.6：静态 IR 不写 ObjectRef）。
              id: "friendly-unit",
              options: ["friendly-unit-on-board"],
              min: 1,
              max: 1,
              selection: "one",
              zone: "board",
              type: "unit",
              controller: "controller"
            }
          }
        ]
      },
      body: []
    }
  ],
  sourceText: "As an additional cost to play me, kill a friendly unit."
} satisfies CardProgram;

export default cruelPatron;
