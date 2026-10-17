import type { CardProgram } from "../../ir/index.js";

/**
 * Mechanical Bandit (rad-111-167) — Gear, 4 energy + 1 Fury power，tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-111-167）：
 *   "At the start of your Beginning Phase, each player reveals the top card of
 *    their Main Deck. If you revealed a card with the lowest Energy cost, draw
 *    it. Recycle the rest."
 *
 * 规则依据（CR v1.5）：
 * - 315.2.a.1："At the start of your Beginning Phase" 对应 events/timing-points.ts 的
 *   beginning-start 时点（"you" 由时点拥有者按回合玩家判定）。
 * - 425.1 / 425.1.a.2 / 425.3：Reveal 把牌库等信息对全体公开且不改变区域；
 *   "the top card of their Main Deck" 必须按区域真实顺序取牌库顶（契约 3.6 的 zoneSlice
 *   语义），而不是集合查询。
 * - 206："lowest Energy cost" 读的是印刷（或复制）费用，null 不是 0。
 * - 414.1.a："draw it" 是把那张被展示的牌拿到手牌；417.1.a / 417.6："Recycle the rest"
 *   把其余被展示的牌回收到拥有者 Main Deck 底。
 *
 * status：judge-required（2026-10-17 复核）。beginning-start 的发出者已不再缺失：
 * turn/flow.ts 的 enter('beginning') 会发出 beginning-start（docs/rules/timing-point-producers.md
 * 第 12 行记录为「已有」）。其余三处缺口保持 judge-required、不近似实现：
 * 1. "each player reveals" 没有玩家扇出：effect.reveal 的 player 只接受单个 PlayerId，
 *    卡牌侧没有对每名玩家执行一次指令的结构。
 * 2. "the top card" 的按序取牌未接通：effect.reveal 对非手牌区域的真子集明确抛
 *    "a subset of this zone requires upstream ordered picks"（实测 2 张牌库取 1 张即抛错），
 *    契约 3.6 的 zoneSlice 尚未被 reveal 消费（RIFT-64 记录的同一缺口）。
 * 3. 「lowest Energy cost → draw it → Recycle the rest」需要跨玩家比较被展示牌的 Energy
 *    （取最小值）、把“那一张”绑定给抽牌、再对余下集合做差集回收；现有表达式没有跨对象
 *    最小值，也没有“集合减去已抽牌”的集合运算。
 * 另有卡牌程序触发注册缺口：没有已合入路径把 CardProgram 的 triggered 能力注册进事件
 * 管线并订阅 beginning-start（RIFT-257 进行中）。
 *
 * golden 只执行已支持部分（单张牌库顶的 Reveal 不与 count 组合）并实测上述缺口；不写近似语义。
 * 依赖：玩家扇出（指令级）、zoneSlice 被 reveal 消费（RIFT-64）、跨对象极小值与集合差、
 * 卡牌程序触发注册（RIFT-257）。
 */
export default {
  canonicalCardId: "card.hash-fbba24cf4707d7016fafc967822809401157688fd7d9c1ae90a2287ae2a2ea06",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核：beginning-start 已有发出者（turn/flow.ts enter('beginning') 发出，" +
    "docs/rules/timing-point-producers.md 记为已有），该缺口删除。其余缺口：(1)「each player reveals」没有玩家扇出：" +
    "effect.reveal 的 player 只接受单个 PlayerId，卡牌侧没有「对每名玩家各执行一次」的结构；" +
    "(2)「the top card of their Main Deck」的按序取牌未接通：effect.reveal 对非手牌区域的真子集直接抛 " +
    "\"a subset of this zone requires upstream ordered picks\"（实测 2 张牌库取 1 张即抛错），" +
    "契约 3.6 的 zoneSlice 尚未被 reveal 消费（RIFT-64 缺口）；" +
    "(3)「lowest Energy cost → draw it → Recycle the rest」需要跨对象取费用最小值、把被选中的那张" +
    "绑定给抽牌、再对余下集合做差集回收，现有表达式没有跨对象 minima 与集合差。" +
    "另有卡牌程序触发注册缺口：没有已合入路径把 CardProgram 的 triggered 能力订阅到 beginning-start（RIFT-257）。" +
    "Reveal 在可表达的范围（整区域 / 单张牌库）已单独执行；不近似实现比较、抽牌与回收。",
  abilities: [
    {
      // 315.2.a.1：Beginning Phase 开始的时点。"your" 由时点拥有者按回合玩家判断。
      kind: "triggered",
      trigger: { at: "beginning-start", filter: {} },
      optional: false,
      body: [
        {
          // 425.1 / 425.3：展示 Main Deck 顶的 1 张。player 值 \"each-player\" 是描述性占位
          // （真实的每名玩家扇出未表达，见 judgeReason 第 2 点）；\"top card\" 的顺序取值
          // 依赖 zoneSlice 被 reveal 消费（第 3 点）。因此该指令当前不可执行，
          // 不会被当成已实现语义。
          id: "mechanical-bandit.reveal",
          op: "effect.reveal",
          args: {
            player: { kind: "constant", value: "each-player" },
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    "At the start of your Beginning Phase, each player reveals the top card of their Main Deck. " +
    "If you revealed a card with the lowest Energy cost, draw it. Recycle the rest."
} satisfies CardProgram;
