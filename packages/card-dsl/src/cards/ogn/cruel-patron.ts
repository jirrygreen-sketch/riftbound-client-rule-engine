import type { CardProgram } from "../../ir/index.js";

/**
 * Cruel Patron (ogn-208-298) — Unit, 4 energy, Might 6（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-208-298）：
 *   As an additional cost to play me, kill a friendly unit.
 *
 * 规则依据（CR v1.5）：
 * - 356.2.a.1 / 356.7：没有 may 的附加费用必须与印刷基础费用一同支付（357.1 / 357.2）；
 *   无法支付则不能完成打出（203.3）。
 * - 429：Kill 是受限动作；作为费用的消灭与作为效果的消灭分开建模（原语 effect.kill 只做效果
 *   消灭，见 effect.kill.ts 的边界注释：费用消灭归 cost 计划）。
 * - 355.10.c：「As an additional cost to play me, kill a friendly unit」不指目标——费用里的
 *   对象选择不是目标，不触发「成为目标」类触发。
 *
 * 结构（契约 3.1/3.2）：
 * - 单个 play 能力，费用里声明一个 additional 支付的 kill 组件；body 为空（打出本身无其余效果）。
 * - kill 支付用 PickSpec（非目标选择）表达「一个友方单位」；契约 3.6 禁止 IR 出现运行时
 *   ObjectRef，因此选项保留描述性占位，尚不能直接交给费用计划器。
 *
 * status = judge-required：cost/kinds/additional.ts、cost.modify、cost.pay 和 programs/ 已合入，
 * 但 programs/play.ts 尚未把本声明绑定到 mandatoryAdditional；cost/plan-values.ts 的
 * choiceObjects 仍只读取精确引用，未展开友方单位筛选。Golden 通过真实原语执行已绑定引用的
 * 费用层路径（计划、非目标选择、支付、失败不提交），不作为整卡打出流程已接线的证据。
 */
const cruelPatron = {
  canonicalCardId: "card.hash-ea1f0540f042966387899650fa2fbb3646f2d1d8ad7264dd83eb0fee4bd953de",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.additional 的卡牌费用接线与动态非目标选择：(1) programs/play.ts 的 translateCost " +
    "仍拒绝 additional，未把本卡的强制 kill 费用转为 CostPlanInput.mandatoryAdditional，" +
    "与印刷 4 Energy 合并后交给 Finalize（CR 356.2.a.1 / 357.2）；" +
    "(2) cost/plan-values.ts 的 choiceObjects 只读取 PickSpec.options 中的精确 ObjectRef，" +
    "未按 type=unit、zone=board、controller=controller 展开并校验「一个友方单位」的合法选项" +
    "（CR 355.10.c）。静态 IR 的描述性占位不能作为支付对象；不把费用消灭改写成 effect.kill。",
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
