import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sandstone Chimera (ven-036-166) — Unit, Calm, 7 Energy + 2 Calm Power, Might 8,
 * tag Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-036-166，逐字）：
 *   While I'm at a battlefield, players only channel 1 rune at the start of their
 *   Channel Phase.
 *
 * 规则依据（Core Rules v1.5）：
 * - 363.2 / 363.2.a：条件持续能力（“While …”）只在条件成立期间生效；本卡的条件是
 *   「我在战场上」（107.1/198.1 的 Location，object-property 读 location）。
 * - 315.3 / 315.3.b / 431.4 / 431.4.a：Channel Phase 的开始由回合流程把“从符文牌库
 *   channel 2 枚符文”作为 Outstanding Task 执行（431.4.a 明确“该玩家在其回合的
 *   Channel Phase channel 两枚符文”）；本卡把该数量限制为 1。
 * - 054 / 054.1（Can't beats Can）与 808/818 等限制类文本一致：这不授予任何许可，
 *   只收缩回合流程的 channel 数量。
 * - 153.2.b / 190.6：本卡是战场上的单位，其持续能力对**所有玩家**生效（“players”），
 *   不是只对控制者。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. 没有可消费该限制的回合流程读数：continuous.restrict 原语已合入
 *    （effects/instructions/continuous.restrict.ts），programs/statics.ts 也能把该声明
 *    归一成 restriction 装进 ability 图层；但 layers 仍没有“回合流程查询”读数，
 *    turn/flow.ts 的 Channel Phase（315.3.b / 431.4.a）直接按 `runeDeckCount` 与固定
 *    2/3 计算 channel 数量，从不查询任何持续限制集合。
 * 2. “While I'm at a battlefield” 的 Location 谓词：object-property 能读 location，
 *    但持续效果在回合流程侧没有消费路径（同 sfd/tianna-crownguard 记录同一缺口）。
 * 依赖：Channel Phase 限制的消费任务（turn/ 侧查询持续限制集合）与条件持续效果的
 * 条件求值接线。不伪造 channel 指令，也不改写回合流程。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      // 315.3.b / 431.4.a 的回合流程动作：限制每次 Channel 的数量为 1。
      operation: "channel-rune",
      scope: "turn-channel-phase",
      appliesTo: "all-players",
      limit: { kind: "constant", value: 1 }
    },
    // 363.2.a：持续限制只在条件成立期间生效——本卡位于战场时。
    condition: {
      kind: "expression",
      value: {
        kind: "object-property",
        object: "self",
        property: "at-battlefield"
      }
    }
  }
];

export default {
  canonicalCardId: "card.hash-d0255097555a5da0f073d4ce07d5cc0f4bd79427917b9d1ea4b327b052d1cd20",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「players only channel 1 rune at the start of their Channel Phase」需要回合流程侧的可消费读数：" +
    "continuous.restrict 原语与 RIFT-257 的 static 绑定已合入（statics.ts 能把该声明归一成 restriction 装进 ability 图层），" +
    "但 layers 没有回合流程读数，turn/flow.ts 的 Channel Phase（315.3.b / 431.4.a）直接按 runeDeckCount 与固定 2/3 " +
    "计算数量、从不查询任何持续限制集合；程序以 continuous.restrict 的静态形状记录该限制（不伪造 channel 指令、不改写回合流程）；" +
    "(2)「While I'm at a battlefield」是 363.2.a 的条件持续能力，需要 Location 谓词与持续效果在回合流程侧的消费路径，" +
    "同 sfd/tianna-crownguard。依赖 Channel Phase 限制的消费任务与条件求值接线。",
  abilities,
  sourceText:
    "While I'm at a battlefield, players only channel 1 rune at the start of their Channel Phase."
} satisfies CardProgram;
