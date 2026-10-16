import type { CardProgram } from "../../ir/index.js";

/**
 * Ol' Poro (ven-029-166) — Unit, 2 Energy（无印刷 Power），4 Might,
 * Calm, Poro/Bandle City。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-029-166，逐字）：
 *   I can't be played on your first, second, or third turns.
 *
 * 规则依据（CR v1.5）：
 * - 420.1 / 420.2.a：打出（Play）是 Discretionary Action，只有在费用与合法条件都满足时才
 *   能打出；“can't be played” 是对该行为的禁止（054/054.1 的 Can't beats Can）。
 * - 349 / 356 / 357 / 358.2：打出的合法性检查发生在 Finalize；本句是“必须满足才能打出”的
 *   强制要求，按契约 3.4 归 Requirement（与“只能打到某处”的 Restriction 分开建模）。
 * - “your first, second, or third turns” 是**按玩家**的回合序数：需要“本局中该玩家的第几回合”
 *   这一谓词。冻结的 Condition 只有 always/never/compare/all/any/not/expression，
 *   condition.history 的 HistoryQuery（scope/action/timingPoint/player/object）只计数动作/时点
 *   次数，没有“某玩家的第 N 回合”范围（同已合入的 sfd/forgotten-monument 的判定）。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 没有“某玩家第 N 回合”的可求值谓词（context 无回合序数读数；也协议/内核没有把该序数暴露
 *    给卡牌侧 Condition）；
 * 2. Finalize 侧没有 Requirement 的消费方：chain/engine.ts 的 Finalize 只吃调用方传入的
 *    requirements/restrictions（Condition 列表），没有任何模块把卡牌程序的 play 要求接进该流程
 *    （RIFT-89/RIFT-90 的打出计划接线）。
 * 本文件按契约 3.1 的 PlayAbility 形状记录该要求（descriptive kind + 常量“第 3 回合为止”），
 * 空 body 表示该牌没有任何指令；不写成恒真的 Condition、也不把该禁止改成任何可执行近似。
 */
export default {
  canonicalCardId: "card.hash-2ffb19822a72dc6ca4fc7111ad103487e5e4a120251c9b158b1064e31aa11748",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「your first, second, or third turns」需要按玩家的回合序数谓词——冻结的 Condition" +
    "（always/never/compare/all/any/not/expression）与 HistoryQuery 的封闭字段（scope/action/timingPoint/player/object）" +
    "都只计数动作/时点，没有“某玩家的第 N 回合”范围（同已合入的 sfd/forgotten-monument 判定）；" +
    "(2) Finalize 侧没有 play 要求的消费方——chain/engine.ts 只消费调用方传入的 requirements/restrictions，" +
    "没有把卡牌程序的 PlayAbility 要求接进打出校验的路径（RIFT-89/RIFT-90 的打出计划接线）。" +
    "程序按契约 3.1 的 PlayAbility 记录该 Requirement（空 body，因为该牌没有其它指令），不写成恒真条件、" +
    "也不把该禁止改成任何近似实现。依赖：回合序数谓词与打出计划的 Requirement 接线。",
  abilities: [
    {
      kind: "play",
      // 本牌没有指令（原文只有这一条禁止），body 为空。
      body: [],
      // 349 / 356 / 357 / 358.2：打出的合法性检查在 Finalize；该要求没有可求值谓词
      // （见 judgeReason），以描述性 Requirement 保留原文的限制窗口。
      requirements: [
        {
          kind: "not-before-own-turn",
          value: { kind: "constant", value: 4 }
        }
      ]
    }
  ],
  sourceText: "I can't be played on your first, second, or third turns."
} satisfies CardProgram;
