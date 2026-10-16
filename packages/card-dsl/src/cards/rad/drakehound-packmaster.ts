import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Drakehound Packmaster (rad-018-167) — Unit, Fury, 9 energy / 2 power / 9 Might.
 *
 * 原文（deck-catalog rad-018-167，逐字）：
 *   "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish
 *    it, then play it, ignoring its cost. Recycle the rest."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me" 是 Play Effect（383.4.a）→ 时点 card-played、filter 自身；
 * - “reveal the top card of each opponent's Main Deck”：牌库顶必须按区域真实顺序提供
 *   （契约 3.6 zoneSlice；effect.reveal 文档：牌库子集必须由上游按顺序提供 pick，
 *   不能从 query 顺序推断）；“each opponent”是玩家集合；
 * - “Choose one and banish it”：非目标选择（355.10.c，选择发生在结算时）→ pick + effect.banish；
 * - “then play it, ignoring its cost”：356.1.b.1 忽略 Base Energy/Power，effect.play 消费
 *   已 Finalize 的费用计划；
 * - “Recycle the rest”：417.1.a 回收主牌库；"the rest" 是已展示集合减去被选牌，用
 *   ObjectFilter 的 exclude 锚点（契约 3.6）声明补给。
 *
 * status: judge-required（不近似实现）：
 * - effect.reveal 不能自己取对手牌库顶：非手牌区域的子集必须由上游“按牌库顺序”的
 *   pick 提供（target.query 有序 pick 融合属 RIFT-90，未合入）；
 * - “ignoring its cost” 需要公开打出流程产出 ignore-all-cost 的 Finalize 费用计划
 *   （cost.ignoreAllCosts 在 cost/ 已实现但没有接线到卡牌可声明的原语路径），RIFT-89~91；
 * - “each opponent” 的玩家集合（多人局）没有原语表达（effect.reveal 只接受单个 player）；
 * - “Recycle the rest” 的补集由 exclude 锚点声明，但补集解析需要上游提供完整已展示集合。
 *
 * golden 测试真实执行 effect.banish（被选牌入 Banishment）与 effect.recycle（余牌回收），
 * reveal/play 依赖写 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "drakehound-packmaster.reveal",
        op: "effect.reveal",
        args: { pick: { kind: "constant", value: "drakehound-packmaster.revealed" } },
        picks: [
          {
            id: "drakehound-packmaster.revealed",
            options: ["each-opponent-main-deck-top"],
            filter: { zone: "deck", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "drakehound-packmaster.banish",
        op: "effect.banish",
        linkedTo: "drakehound-packmaster.reveal",
        args: {
          objects: { kind: "constant", value: { pick: "drakehound-packmaster.chosen" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "drakehoundBanished" }
        },
        picks: [
          {
            id: "drakehound-packmaster.chosen",
            options: [
              {
                kind: "linked-value",
                instructionId: "drakehound-packmaster.reveal",
                key: "revealed"
              }
            ],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "drakehound-packmaster.play",
        op: "effect.play",
        linkedTo: "drakehound-packmaster.banish",
        args: {
          object: {
            kind: "linked-value",
            instructionId: "drakehound-packmaster.banish",
            key: "drakehoundBanishedObject"
          },
          // “ignoring its cost” = 356.1.b.1 忽略 Base Energy/Power，由 Finalize 产出
          // 已 Finalize 的零费用计划（当前无卡牌可声明的路径，见 judgeReason）。
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
        }
      },
      {
        id: "drakehound-packmaster.recycle",
        op: "effect.recycle",
        linkedTo: "drakehound-packmaster.reveal",
        // “Recycle the rest” = 已展示集合减去被选走的那张。被选牌在 banish 时换了区，其旧引用
        // 在结算时已失效（359.3.e.7-.8），因此这里直接消费 reveal 的 revealed 链接值，
        // 非目标集合（355.10.d）丢旧引用后剩下的就是“余牌”。
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "drakehound-packmaster.reveal",
            key: "revealed"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-13c973685ac41041e9a4132ebb47d2bd5e03e92ecad00fcf6d08ce9e0b8750f4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口：(1) “reveal the top card of each opponent's Main Deck” 无法由 effect.reveal 自行取到：" +
    "非手牌区域的子集必须由上游按牌库真实顺序提供 pick（effect.reveal 文件边界；target.query 有序" +
    "pick 融合依赖 RIFT-90），且 “each opponent” 的玩家集合在原语里没有表达（effect.reveal 只接" +
    "单个 player）。(2) “play it, ignoring its cost” 需要公开打出流程产出 ignore-all-cost 的" +
    "Finalize 费用计划（356.1.b.1；cost.ignoreAllCosts 已在 cost/ 实现但未接到卡牌可声明路径，" +
    "依赖 RIFT-89~91）。(3) “Recycle the rest” 的补集需要上游锁定完整展示集合（exclude 锚点已按" +
    "契约 3.6 声明）。已合入部分（effect.banish 选牌、effect.recycle 回收）在 golden 测试真实执行。不近似实现。",
  abilities,
  sourceText:
    "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest."
} satisfies CardProgram;

export default program;
