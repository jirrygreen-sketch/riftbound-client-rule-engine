import type { CardProgram } from "../../ir/index.js";

/**
 * Mystic Poro (ogn-171-298) — Unit, Chaos, Poro.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-171-298):
 *   [Vision] (When you play me, look at the top card of your Main Deck.
 *   You may recycle it.)
 *
 * 规则依据（CR v1.5）：
 * - 817.1：Vision 是触发能力关键词；817.1.a 出现在永久物上。
 * - 817.1.b / 817.1.c：功能上等于「When this is played, [Predict]」，
 *   触发点是该永久物进入 Board。
 * - 817.2 / 817.2.a：多个 Vision 实例各自独立触发、各自决定是否回收。
 * - 437.1 / 437.3 / 437.3.a：Predict 看牌库顶一张并选择是否回收它，
 *   未写数值时按 1 张处理；437.4 牌库不足时尽可能多看、不 Burn Out。
 *
 * 结构：整张卡只有关键词能力，按契约 3.1 / README 第 5 节写
 * `{ kind: "keyword", keyword: "vision" }`（无印刷数值，省略 value）。
 * 展开（订阅 object-enters-board、看牌 + 可选回收）由 engine-core 的关键词
 * 注册表负责（RIFT-83 已合入 keywords/Vision.ts），卡牌程序不重复展开。
 *
 * status 判定（README 第 2 节；不因「能写出声明」标 executable）：
 * - CardProgram binding 已能把关键词能力展开并注册到 object-enters-board；
 *   但生产路径上 Vision 的 Predict 仍需要有序的牌库顶选择。
 * - 即使接线完成，已合入的 Vision 展开在生产路径仍不可执行：Predict 需要
 *   有序的牌库顶选择，effect.inspect 在 top scope 缺少上游有序 picksSpecId 时
 *   按自身文档记录的分区顺序契约缺口直接 negated（契约 3.6 的 zoneSlice 已能
 *   按区域顺序读牌库顶，但 inspect 不消费它；测试内核可用 setPicks 提供有序
 *   集合，生产装配层尚无等价入口）。
 * golden 真实执行 Vision 展开 body（先 negated 证据，再用内核有序 picks 执行
 * 看牌/回收两条路径），不近似实现。
 */
const mysticPoro = {
  canonicalCardId: "card.hash-85fa951465a6a8b081cd52e0a9b48fd7e3d80cca31309f23efcf0cdf0f302c0e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Vision 关键词的生产可执行路径（CR 817.1.c / 437.1），不近似实现：" +
    "CardProgram binding 已能把 Vision 展开为 object-enters-board 触发；但生产路径上 Predict 仍无法取得有序牌库顶：effect.inspect 在 top scope 需要上游有序 picksSpecId，" +
    "缺少时按分区顺序契约缺口直接 negated（契约 3.6 的 zoneSlice 已能按区域顺序读牌库顶，但 inspect 不消费；" +
    "有序 picks 目前只有测试内核的 setPicks 提供，生产装配层没有等价入口）。",
  abilities: [{ kind: "keyword", keyword: "vision" }],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default mysticPoro;
