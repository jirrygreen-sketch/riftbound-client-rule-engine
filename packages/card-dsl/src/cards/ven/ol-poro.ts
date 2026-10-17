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
 *   condition.history 的 HistoryQuery（含 exclude/objectFilter）只计数动作/时点
 *   次数，没有“某玩家的第 N 回合”范围（同已合入的 sfd/forgotten-monument 的判定）。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 没有“某玩家第 N 回合”的可求值谓词（TurnFlow 私有计数尚未暴露
 *    给卡牌侧 Condition）；
 * 2. translateLegalityCondition 没有把自定义的 not-before-own-turn Requirement 转成可执行 Condition；
 *    现有打出计划已能转交标准 requirements/restrictions，但没有这个回合序数适配器。
 * 本文件按契约 3.1 的 PlayAbility 形状记录该要求（descriptive kind + 常量“第 3 回合为止”），
 * 空 body 表示该牌没有任何指令；不写成恒真的 Condition、也不把该禁止改成任何可执行近似。
 *
 * Execution evidence (RIFT-703): test/cards/templates/play-703.test.mjs pins the real
 * describePlay rejection of this requirement and runs the printed play procedure without
 * it; test/cards/ven/ol-poro.test.mjs keeps the structure assertions.
 */
export default {
  canonicalCardId: "card.hash-2ffb19822a72dc6ca4fc7111ad103487e5e4a120251c9b158b1064e31aa11748",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) “your first, second, or third turns”需要每位玩家各自的回合序数。turn/flow.ts 虽在私有 turns 中计数，ResolveContext / Condition 没有该读数；HistoryQuery 的 scope/action/timingPoint/player/object/exclude/objectFilter 仅查询已提交历史，未把玩家回合序数暴露给合法性判断（同 sfd/forgotten-monument 的限制）。" +
    "(2) translateLegalityCondition 不接受 not-before-own-turn Requirement，缺从上述序数到 Finalize requirements 的规则适配器（420.2.a / 358.2）。保留第 4 个己方回合才可打出的描述性要求；不按全局回合推算，也不改成恒真或恒假。",
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
