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
 * status = judge-required：effect.score 原语与 object-moved 历史都可执行（golden 真实执行），
 * 阻断在：(1) 「第 N 次恰好触发一次」的触发形状——封闭 TriggerSpec 只在每次事件命中时求值
 * condition，condition.history 计数到 3 的那一刻命中第三次移动与其后每一次移动，
 * 没有「第 N 次事件恰好一次」的判定；(2) CardProgram 触发注册（RIFT-257）与
 * object-moved 事件源「是本卡移动」的载荷都未接通；(3) Ganking 展开的 continuous.movement
 * 许可只有 layers/rules/query.ts 读取，生产 Standard Move（zones/movement.ts）不消费。
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
    "已合入并已用真实执行核验：「you score 1 point」按 CR 470.2 用 effect.score 原语执行（golden 里真实获得 1 点）；" +
    "「本回合本单位被移动的次数」用 object-moved 的历史查询（action: move-location）计数，golden 里真实走完三次 effect.move 并读到 count = 3（458 Recall 不计入）。" +
    "整卡仍不可执行：(1)「The third time I move in a turn」（383.1.b）需要「第 N 次事件恰好触发一次」的触发形状——" +
    "封闭 TriggerSpec 在每次事件命中时求值 condition，condition.history 到 3 之后每次移动仍会满足，会重复计分；现有 Expr/Condition 没有该形状；" +
    "(2) 没有已合入的消费方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（卡牌程序绑定 RIFT-257 进行中），" +
    "object-moved 事件源也缺「是本卡移动」的可判定载荷（events/action-adapter.ts 的 move-location 映射带 object，无来源区分）；" +
    "(3) [Ganking] 的展开虽已存在（effects/keywords/Ganking.ts 展开成 continuous.movement 静态效果），但该许可只有 layers/rules/query.ts 的 movement() 查询读取，" +
    "生产移动路径 zones/movement.ts 仍只读调用方传入的 readiness/hasGanking 记录（810.1.c/144.4.c）。" +
    "依赖：第 N 次事件触发任务、RIFT-257（触发绑定）与移动许可的生产消费方。不近似实现（不用每三次循环代替第三次，也不用战场 Scoring 流程代替 Gaining Points）。",
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
