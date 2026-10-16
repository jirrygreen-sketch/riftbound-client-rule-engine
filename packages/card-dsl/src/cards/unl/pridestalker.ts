import type { CardProgram } from "../../ir/index.js";

/**
 * Pridestalker (unl-183-219) — Legend, Fury/Body, tag Rengar.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-183-219，逐字）：
 *   When you play a unit, give a unit +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4：“when another object is played” 的触发不是 Play Effect；时点用
 *   封闭表的 card-played，filter 取事件对象为 unit 且由能力控制者控制。
 * - 355.9 / 355.10：“give a unit” 是单个由玩家选择的单位，属选目标（targets），
 *   不是 pick（355.7：pick 不触发“成为目标”相关触发）。
 * - “+1 [M] this turn” 是带 end-of-turn 期限的临时 Might 修正：effect.buff 的
 *   文档明确临时 Might 归 layers 的 continuous.might（CR 702/703 的 Buff 计数
 *   是另一回事），因此需要未合并的原语与到期消费者。
 *
 * status = judge-required：
 * - 缺连续的 Might 修正原语：封闭 GameAction 集合没有 might 修改动作，
 *   effects/instructions/ 下没有 effect.might-modify / continuous.might 文件，
 *   卡牌程序没有把该持续效果注册进 layers/ 的指令入口（ctx.addContinuous 目前
 *   没有原语消费者）；
 * - “this turn” 的期限需要按 CR 315.4 / 清理步骤移除，该期限本身由 layers 的
 *   duration 机制表达，但没有卡牌可用的注册路径（同上）。
 * 本程序保留已支持的触发结构与目标形状；body 的 continuous.might 记录意图，
 * 不近似用 effect.buff 表达（Buff 是 702 的计数器，不是“this turn”修正）。
 *
 * 依赖：RIFT-91（layers-continuous 的卡牌指令入口）、RIFT-89/90（目标与条件管线）。
 */
export default {
  canonicalCardId:
    "card.hash-0498072c7fa1411e598b868d1675b34cf40890cde5ab313bf5598e1fcf1f08eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正的可执行路径：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，" +
    "effects/instructions/ 下没有 continuous.might / effect.might-modify 原语文件，" +
    "卡牌程序也没有把该持续效果注册进 layers/ 的指令入口（ctx.addContinuous 目前没有原语消费者）；" +
    "effect.buff 文档明确临时 Might 归 layers 的 continuous.might（702/703 的 Buff 计数器不是本效果），" +
    "“this turn” 按 CR 315.4 / 清理步骤移除的期限需要上述注册路径才能落地。" +
    "依赖 RIFT-91（layers 的卡牌接线）与 RIFT-89/90（目标/条件管线）；触发结构与目标形状已保留，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a unit”：事件对象是刚打出的单位，由能力控制者控制。
          object: { type: "unit", controller: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "pridestalker.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "pridestalker.unit",
              // “a unit”：任意单位，由能力控制者在结算前选择（355.10）。
              filter: { zone: "board", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play a unit, give a unit +1 :rb_might: this turn."
} satisfies CardProgram;
