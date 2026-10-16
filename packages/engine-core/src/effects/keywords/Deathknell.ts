import type { Ability, Instruction, TriggeredAbility } from "@riftbound/card-dsl";

import type { KeywordDef } from "../keyword-contract.js";

/**
 * Deathknell —— v1.5 规则 808（触发式能力关键词，仅存在于 Permanent 上）。
 *
 * 规则依据（Core Rules v1.5，/root/swarm-rift/shared/rules/CR-v1.5.txt）：
 * - 808.1 / 808.1.a：Deathknell 是触发式能力关键词，存在于 Permanent 上。
 * - 808.1.c：功能上等同于 "When I die, [Effect]."
 * - 808.1.d / 429.1 / 429.1.a.1.b：其触发条件是承载永久物被消灭（Killed）并送入 Trash，
 *   对应封闭时点枚举中的 object-killed（429.1.a.1.b：拥有 Deathknell 等自身死亡触发的
 *   单位被消灭时，触发在其离场前收集）。若死亡被替代（如召回），触发从链上移除
 *   （808.1.d.1），这由 chain / events 对替代结果的处理负责，不属于本展开。
 * - 808.1.d.2 / 808.1.d.3：触发在该卡进入 Trash 之前即作为 Pending Item 入链，并记录最后
 *   已知信息；由 object-killed 时点与触发系统的最后已知信息机制承载（时点定义见
 *   packages/engine-core/src/events/timing-points.ts）。
 * - 808.2 / 808.2.a：同一永久物上的每个 Deathknell 实例**各自独立**触发（控制者决定入链
 *   顺序）——因此 stacking: "separate"，每个关键词实例展开为一个独立的触发能力，**不**像
 *   Assault/Shield/Disarm 那样数值相加合并（对照 807.2 的求和规则仅适用于带数值的被动
 *   关键词）。
 * - 808.3：Deathknell 及其持有状态是永久物的特征，可被其他游戏效果检查或引用。
 *
 * 关键词与效果正文的边界（契约 3.7）：Deathknell 本身只展开为「触发时点 + 过滤条件」的
 * 触发能力骨架，**不写任何流程**。[Effect]（808.1.b.1 的 Deathknell 效果正文，例如
 * "Recycle me to ready your runes."）由卡牌程序在编译时挂到所选的 trigger-leave 能力上
 * （payload 引用的 ability id 即 deathknell:<host>:leave）；关键词不持有、也不执行效果
 * 正文。808.1.c.2 中"过去式指触发入链时刻"的语义由效果正文内的取值时机表达，不属于
 * 关键词展开。
 *
 * 依赖尚未合入的部分（均按计划由其他任务实现，本文件只按契约引用其 id，不近似实现）：
 * - trigger.leave 原语：死亡 / 离场触发的订阅原语（RIFT-9 调研 ability-templates.md 原语
 *   清单，47/47 张卡使用）。本展开的指令体仅引用该 op id。
 * - 事件管线在 object-killed 时点收集触发并作为 Pending Item 入链的流程（契约 3.5）由
 *   chain / events 模块提供。
 */
const deathknell = {
  keyword: "Deathknell",
  valued: false,
  stacking: "separate",
  expand({ host }) {
    const instructionId = `deathknell:${host.canonicalCardId}:leave`;
    const body: readonly Instruction[] = [
      {
        id: instructionId,
        op: "trigger.leave",
        args: {
          cause: { kind: "constant", value: "kill" }
        }
      }
    ];
    const ability: TriggeredAbility = {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { self: true, cause: "kill", destination: "trash" }
      },
      optional: false,
      body
    };
    return [ability] as readonly Ability[];
  },
  ruleRefs: [
    "808",
    "808.1",
    "808.1.a",
    "808.1.b",
    "808.1.c",
    "808.1.d",
    "808.1.d.1",
    "808.1.d.2",
    "808.1.d.3",
    "808.2",
    "808.2.a",
    "808.3",
    "429.1",
    "429.1.a.1.b"
  ]
} satisfies KeywordDef;

export default deathknell;

