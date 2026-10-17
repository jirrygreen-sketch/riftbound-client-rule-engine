import type { CardProgram } from "../../ir/index.js";

/**
 * Tricksy Tentacles（unl-054-219）— Spell，4 能量 + 1 Calm 力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-054-219，逐字）：
 *   "Move any number of enemy units with the same controller and a total Might of 8 " +
 *   "or less to a single location."
 *
 * 规则依据（CR v1.5）：
 * - 这是一次效果移动（451；不是 Standard Move 144、不是 Recall 457）。「any number of
 *   enemy units」是组目标：355.11 允许一组目标整体满足印刷的 Targeting Requirement，
 *   355.13 的 “any number” 允许选择 0 个，因此组用 TargetSpec（min 0、max null、
 *   selection "up-to"）声明。
 * - 「with the same controller」是 355.11 的组内约束（组内单位必须同属一个控制者）。
 * - 「a total Might of 8 or less」同样是组约束：按 143.2.a，Might 指算上图层修改后的
 *   有效值，判定发生在选择与结算时（355.11.a / 355.11.b 允许结算时改选合法子集）。
 * - 「to a single location」：目的地按 355.4 / 355.4.a 在结算时选择「这组单位都能存在
 *   的同一个地点」，且整组共用同一目的地。
 *
 * status = judge-required（README 第 2 节），两处依赖未合入，均不近似实现：
 * 1. 组约束没有可判定形态：object/EventPattern 过滤器只能逐键比较单个对象的特征
 *    （type/tag/controller/zone/location/状态/特征），没有任何已合入拼写能表达「组内
 *    同一控制者」与「组内 Might 合计 ≤ 8」这类的组整体要求（355.11 的 Targeting
 *    Requirement / 355.11.b 的结算期合法子集），condition 从句只作用于整条指令、不能
 *    过滤选择集合的成员。若按 type/controller 直接选，就会把 Might 超限或跨控制者的
 *    组合当成合法——正是红线禁止的近似。
 * 2. 目的地的运行期 Location 选择已可由 LocationTargetSpec + target-location 表达并执行；
 *    组约束仍缺。
 * 依赖：target 系统的组约束与合法子集重验（355.11）。
 * golden 只做校验、目标/选择器/参数的结构断言与缺口 todo；组约束不是可执行语义。
 */

const tricksyTentacles = {
  canonicalCardId: "card.hash-a7dc7d29f0a8ac49b8977b2261f476c440c7c3025285bd5e6a7250b52981b37d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 组整体约束没有可判定形态——「with the same controller」（355.11 组内同控制者）与" +
    "「a total Might of 8 or less」（组内 Might 合计上限，355.11.a/355.11.b 含结算期合法子集重验）都无法用逐键比较的 " +
    "ObjectFilter / TargetSpec / PickSpec 表达，condition 从句只作用于整条指令、不能过滤选择集合的成员；" +
    "按 type/controller 直接选会把 Might 超限或跨控制者的组合当成合法（组约束与结算期合法子集重验仍缺）。" +
    "(2)「to a single location」已用 LocationTargetSpec + target-location 在结算时选定并由 effect.move 消费。" +
    "「any number of enemy units」已按 355.11/355.13 声明为 min 0、up-to 的组目标。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        // 印刷 1 点 Calm Power（domains: ["Calm"]）。
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "tricksy-tentacles.move-group",
          op: "effect.move",
          locations: [
            {
              id: "tricksy-tentacles.destination",
              type: "any",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            objects: {
              kind: "constant",
              value: { target: "tricksy-tentacles.enemy-unit-group" }
            },
            to: {
              kind: "location",
              value: { kind: "target-location", target: "tricksy-tentacles.destination" }
            },
            // 整组移动到同一个地点：移动数量等于本组合法目标数，用 count 锚定同一组
            // 目标（组约束本身尚未可判定，见 judgeReason 第 1 点）。
            amount: {
              kind: "count",
              subject: "unit",
              // 契约 3.6 的对象锚点用符号选择器：{ target: "<TargetSpec id>" }
              // 引用 Finalize 锁定的本组目标。
              filter: { target: { target: "tricksy-tentacles.enemy-unit-group" } }
            }
          },
          targets: [
            {
              id: "tricksy-tentacles.enemy-unit-group",
              // sameController / totalMightAtMost 是 355.11 组约束的保留声明：
              // 没有已合入消费方求值它们，本卡据此保持 judge-required。
              filter: {
                type: "unit",
                controller: "opponent",
                zone: "board",
                sameController: true,
                totalMightAtMost: 8
              },
              min: 0,
              max: null,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Move any number of enemy units with the same controller and a total Might of 8 " +
    "or less to a single location."
} satisfies CardProgram;

export default tricksyTentacles;
