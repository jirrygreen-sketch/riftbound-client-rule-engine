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
 * - ChainEngine 的 finalizeOrderedPickPlans 已接入 zoneSlice，有序来源已合入。
 *   Vision 展开仍只在 effect.inspect 参数中引用 picksSpecId: "vision-top"，
 *   没有在指令的 picks 中声明对应 zoneSlice，尚未迁移到这条生产路径。
 * - 关键词可展开，但触发注册尚不成功：Vision 的旧 filter 含 object.id，
 *   translateTriggerFilter 抛 Unsupported filter field object.id（817.1.c）。
 * - Vision 的 effect.inspect.player 仍是 constant("A")；expandProgram 没有
 *   将它绑定到实际能力控制者，B 控制的实例不能按 437.1 看自己的 Main Deck。
 * golden 保留用内核有序 picks 执行看牌/回收两条路径的局部证据；绑定测试
 * 另行验证实际关键词展开与注册阻断，不把局部执行视为整卡可执行。
 */
const mysticPoro = {
  canonicalCardId: "card.hash-85fa951465a6a8b081cd52e0a9b48fd7e3d80cca31309f23efcf0cdf0f302c0e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Vision 关键词的生产可执行路径（CR 817.1.c / 437.1），不近似实现：" +
    "ChainEngine 的 finalizeOrderedPickPlans 已通过 zoneSlice 提供生产有序来源；当前缺口在 keywords/Vision.ts 的迁移：" +
    "(1) object-enters-board 的旧触发 filter 含 object.id，programs/filters.ts 的 translateTriggerFilter 抛 Unsupported filter field object.id，尚不能注册本来源进场触发（817.1.c）；" +
    "(2) effect.inspect 只引用 picksSpecId: vision-top，未在指令 picks 声明对应的有序 zoneSlice 来源，Finalize 无法为该展开锁定牌库顶；" +
    "(3) effect.inspect.player 仍硬编码 constant(\"A\")，expandProgram 未按实际 controller 绑定查看玩家，B 控制的 Vision 不能据此查看自己的 Main Deck（437.1）。" +
    "卡牌按关键词契约只声明 vision；这些共享关键词迁移缺口仍阻断整卡，已有 setPicks golden 只证明看牌/可选回收子效果。",
  abilities: [{ kind: "keyword", keyword: "vision" }],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default mysticPoro;
