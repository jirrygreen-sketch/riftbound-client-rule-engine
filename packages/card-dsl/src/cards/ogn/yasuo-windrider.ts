import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Windrider (ogn-205-298) — Unit, 5 energy + 1 Chaos power, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-205-298）：
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   The third time I move in a turn, you score 1 point.
 *
 * 规则依据（CR v1.5）：
 * - 810 Ganking：被动能力关键词（810.1/810.1.b/810.1.c），只声明关键词，展开由
 *   effects/keywords/Ganking.ts 负责（契约 3.7 与 §5 关键词只声明不重写）。
 * - 383.1.b：「the [Nth] time」是触发条件；383.2.a「the Nth Time」从句即触发条件。
 * - 470.2：卡面「score 1 point」指 Gaining Points，不是战场征服 / 固守的 Scoring 流程。
 * - 458/458.1：Recall 不是 Move，不触发移动类触发，因此不能用「每三次循环」近似第三次。
 *
 * 结构：
 * - abilities[0] 声明 [Ganking] 关键词；
 * - abilities[1] 在封闭时点 object-moved 上订阅自身移动（449 的 Move 定义），条件用 count 表达式
 *   读「本回合本单位被移动的次数」并要求等于 3（第三次）；
 * - body 用 effect.score 获得 1 点（470.2）。
 *
 * status = judge-required（复核 2026-10-17）：effect.score 原语与历史查询都可执行（golden 真实执行），
 * 阻断在：(1) 触发不可注册："object-moved" 不在 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES，
 * 实测 programs/triggers.ts 经 assertTriggerSpec 抛 TriggerSpecValidationError(invalid-event-type)；
 * 且「第 N 次恰好触发一次」（383.1.b）需要按对象的本回合 Move 历史边沿：TriggerSpec.condition
 * 的 count 表达式只做当前区域对象查询（参考内核实测对在板单位返回 1），condition.history 是
 * body 指令、不能作为 TriggerSpec 条件；EventPipeline 已有事件感知条件求值，
 * 但没有每对象/每回合 Move 序号、同时满足去重与 Recall 排除的历史谓词；
 * (2) [Ganking] 展开的 continuous.movement 许可已有 zones/movement.ts 的
 * moveDuelUnitsStandard 可选 rules 桥（layers/rules/query.ts 消费 canGank），但生产装配缺失：
 * duel/standard-move-executor-v2.ts 调 moveDuelUnitsWithMetadata 时不传 rules，
 * apps/game-server 的 authoritative-runtime-p4.ts 只对 no-ability/pure-accelerate 单位返回 ganking，
 * 本卡会抛 "unresolved movement keyword"；同时关键词静态展开经 programs/statics.ts 原样注册字符串
 * permission，而查询器读取 permission.routes，仍需规范化。
 *
 * 数据备注（不在本任务改数据）：同一 canonicalCardId 的 SFD 印刷在本地 catalog 中不存在
 * （docs/plans/survey/unclassified-ogn.json 把 ogn-205-298 记为 data-issue：OGN 带 Ionia、
 * SFD 两个印刷缺失）。
 */
const yasuoWindrider = {
  canonicalCardId: "card.hash-03848f0e530587876003913478c758509f6b05e8b89b33575cb4fd9da70f9cf1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 The third time I move in a turn 的事件历史条件（CR 383.1.b）：object-moved 不在 EVENT_PATTERN_TYPES，" +
    "触发注册报 invalid-event-type；count 表达式查询当前对象，condition.history 是 body 指令，" +
    "不能充当 TriggerSpec 的逐事件历史条件。EventPipeline 已有事件感知条件求值；" +
    "缺的是兼容 testTrigger 的本回合、本对象 Move 序号和同时满足时只触发一次的历史谓词，" +
    "以及生产移动原因/Recall 排除（458.1），不能仅按 action:move-location 推断。" +
    "Ganking（810.1.b/810.1.c）的静态 permission 字符串未规范化为 permission.routes，" +
    "canGank 查询不能消费；duel/standard-move-executor-v2.ts 未装配 DuelMovementRuleContext，" +
    "apps/game-server 的 authoritative-runtime-p4.ts 仍对本卡拒绝 unresolved movement keyword。" +
    "effect.score 获得点数（470.2）仍缺上述第三次移动触发前置，不能无条件发放。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", source: "self" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "self-moves-this-turn",
            filter: { object: "self", action: "move-location", scope: "turn" }
          },
          operator: "eq",
          right: { kind: "constant", value: 3 }
        }
      },
      optional: false,
      body: [
        {
          // 「score 1 point」= 获得 1 点（470.2）；effect.score 已合入并由 golden 真实执行。
          id: "yasuo-windrider.score-1",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "The third time I move in a turn, you score 1 point."
} satisfies CardProgram;

export default yasuoWindrider;
