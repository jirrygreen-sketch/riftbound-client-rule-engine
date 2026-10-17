import type { CardProgram } from "../../ir/index.js";

/**
 * Magma Wurm (ogn-011-298) — Unit, Fury, Freljord, energy 8, Power 1, Might 8.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-011-298，逐字）:
 *   "Other friendly units enter ready."
 *
 * 规则依据（Core Rules v1.5）:
 * - 359.2.c：单位默认以横置状态进场；改动"进入 Board 的方式"的能力是替代效果。
 * - 369.3："Replacement Effects that apply to a unit as it enters the Board"，
 *   官方示例 "I enter ready." 即把横置进场事件替换为就绪进场；364.3/364.3.a 说明
 *   被动能力可以是持续生效的替代效果。
 * - 366 / 365.1：战场上永久物的被动能力在 Board 上生效；"Other friendly units"
 *   排除来源自身。注意本卡与 Accelerate（805.6）不同：Accelerate 的替代来源就是
 *   进场单位本身，本卡的替代来源是 Magma Wurm、被替代事件的对象才是进场的友方单位。
 *
 * 结构说明（本卡标记 judge-required，见下）:
 * - 用一个 replacement 能力（契约 3.1）声明：被替代事件是其他友方单位进入 Board，
 *   替代结果是该单位以就绪状态进场；filter 的 other: true 排除本卡自身，
 *   exhausted: true 只命中默认的横置进场（CR 370.1.b：入场过滤读取被替代事件的状态）。
 * - 替代体按已合入的 RIFT-260 声明式写法：外层 `replacement.event` 包装常量
 *   EventPattern + `instead` 指令体，被替代事件对象经 REPLACED_EVENT_LINK
 *   （"replacement.object"）以契约 3.6 的 `{ linked: "replacement.object" }` 选择符引用；
 *   不给「进场单位」建 TargetSpec（那会错误地引入目标相关触发，355.7）。
 * - effect.ready 自己的文档声明 "enter ready 是入场替代，不是事后重置"，因此
 *   instead 体描述的是同一次入场动作的取向改写（359.2.c、369.3、805.6），
 *   由替代管线在 move-zone 提交时把就绪动作排在被替代动作之前完成。
 *
 * 合入后的复核（RIFT-260 replacement 管线）：
 * - events/pipeline.ts 的替代注册表 + replacement/bind.ts 的 bindReplacement 已合入，
 *   能按 { replaces.event, filter } 匹配 object-enters-board 的入场 move-zone 动作；
 *   "Other friendly units" 的 filter（other: true / controller / zone）由
 *   replacement/pattern.ts 的规范化过滤求值。
 * - 替代体引用被替代事件对象的绑定由 REPLACED_EVENT_LINK（"replacement.object"）提供，
 *   因此可以按契约 3.6 的 { linked: "replacement.object" } 选择符给「进场的那个友方单位」
 *   就绪进场，不再依赖未写入契约的 source 绑定。
 *
 * 仍未合入的消费方（不近似实现）：
 * - 卡牌程序绑定（RIFT-257，src/programs/ 未合入）：没有任何生产方读取 CardProgram 的
 *   replacement 能力并调用 bindReplacement，所以本卡的替代在真实对局里不会被注册。
 *   golden 测试用 bindReplacement + 事件管线真实执行替代本身（入场就绪、友方/敌方边界、
 *   重复触发）。
 * 依赖：RIFT-257（CardProgram → replacement 注册）。
 */
const magmaWurm = {
  canonicalCardId: "card.hash-d92b1df4324a20717aaeab68c916883889ea337f917bdf10104e9df82f9a3c19",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Other friendly units enter ready』是入场替代效果（CR 369.3；单位默认横置进场 359.2.c）：RIFT-260 的替代管线已合入" +
    "（replacement/bind.ts 的 bindReplacement 匹配 object-enters-board 的入场 move-zone，替代体用 { linked: \"replacement.object\" } 读取被替代事件对象），" +
    "golden 已用该管线真实执行入场就绪。仍缺的消费方是 CardProgram → replacement 注册（RIFT-257，src/programs/ 未合入）：" +
    "没有生产方读取本卡的 replacement 能力并调用 bindReplacement，真实对局不会注册这条替代。依赖：RIFT-257。不近似实现。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        // 143.4 / 359.2.c：只替换「横置进场」这条默认；快照在替代匹配时仍位于 Chain，
        // 因此过滤条件按入场状态（exhausted: true）而不是 zone: board 表达（CR 370.1.b）。
        filter: { type: "unit", controller: "controller", other: true, exhausted: true }
      },
      with: [
        {
          id: "magma-wurm.register-entry",
          op: "replacement.event",
          args: {
            event: {
              kind: "constant",
              value: {
                event: "object-enters-board",
                filter: { type: "unit", controller: "controller", other: true, exhausted: true }
              }
            },
            instead: {
              kind: "constant",
              value: [
                {
                  id: "magma-wurm.enter-ready",
                  op: "effect.ready",
                  args: {
                    objects: { kind: "constant", value: { linked: "replacement.object" } }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "Other friendly units enter ready."
} satisfies CardProgram;

export default magmaWurm;
