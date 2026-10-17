import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * drakehound-packmaster — Core Rules v1.5; see judgeReason for the current execution gaps.
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
    "CR 355.10.c：缺各对手主牌库顶真实有序集合及结算时从展示集合选择一张的动态 picks（RIFT-358）；effect.reveal 的单个 player 参数也不能遍历 each opponent。CR 356.1.b.1：cost.modify 已合入，但只基于 ctx.source 建计划，source 参数专用于 Weaponmaster；缺以刚被放逐的其他牌为来源并衔接 effect.play 的忽略基础费用 Finalize 适配。不能使用常量 finalized 零计划替代该流程。",
  abilities,
  sourceText:
    "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest."
} satisfies CardProgram;

export default program;
