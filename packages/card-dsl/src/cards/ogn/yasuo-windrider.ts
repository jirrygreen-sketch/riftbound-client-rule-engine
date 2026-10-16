import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Windrider (ogn-205-298) — Unit, 5 energy + 1 Chaos power, Might 4。
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
 * status = judge-required：Ganking 展开（continuous.movement）与 effect.score 原语都未接通，
 * 且第 N 次事件触发缺少可用的历史/批次语义。见 judgeReason。
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
    "缺三件已合入依赖：(1)「you score 1 point」按 CR 470.2 是 Gaining Points，需要 effect.score 指令原语" +
    "（effects/instructions/ 没有该文件；RIFT-9 原语清单列出的 score 尚无实现），不能拿战场 Scoring 流程代替；" +
    "(2) [Ganking] 的展开虽已存在（effects/keywords/Ganking.ts 展开成 continuous.movement 静态效果），" +
    "但移动系统还没有读取该许可的接口（810.1.c/144.4.c），因此关键词不可执行，依赖 RIFT-83 后续；" +
    "(3)「The third time I move in a turn」是 CR 383.1.b 的第 N 次触发，需要按对象、按回合的移动历史" +
    "（每次 Move 不同 event，458 Recall 不计入）；现有 Expr/Condition 只有集合 count 与 condition.history 计数，" +
    "没有「第 N 次事件恰好触发一次」的触发形状。依赖：effect.score 原语、RIFT-83/EIFT-144.4.c 移动许可接通、" +
    "以及第 N 次事件触发任务。不近似实现（不用每三次循环代替第三次）。",
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
          // 「score 1 point」= 获得 1 点（470.2），待 effect.score 原语。
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
