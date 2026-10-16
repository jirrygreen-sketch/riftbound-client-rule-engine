import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Runeblade Anvil (rad-012-167) — Unit, Chaos, 1 energy, no printed Might / power.
 *
 * 原文（deck-catalog rad-012-167，逐字）：
 *   "When you play this or when this leaves the board, banish the top card of your Main
 *    Deck. Until your next Ending Phase, you may play that card. (You still pay its
 *    costs.)\n:rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this."
 *
 * 规则依据（CR v1.5）：
 * - "When you play this"：Play Effect（383.4.a）→ 时点 card-played、filter 自身；
 *   "when this leaves the board" 是离开 Board 触发（383.2.c.3），对应已定义时点
 *   object-leaves-board，需要最后已知信息（383.2.c.3.b）与离场前收集；
 * - "banish the top card of your Main Deck"：牌库顶必须按区域真实顺序取（契约 3.6
 *   zoneSlice；query 不保证顺序），effect.banish 的 zone 选择（{zone:"deck", from:"top"}）
 *   已合入；
 * - ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this." 是启动能力（400 起）：
 *   费用 2 能量 + 1 Chaos Power + 横置自身，效果 Kill this（429.1.a.1）。

 * status: judge-required（不近似实现）：
 * - “Until your next Ending Phase, you may play that card. (You still pay its costs.)”
 *   需要一个带期限的“可打出该牌”许可（从 Banishment 打出、比照 811/812 的
 *   hidden/alternative play 许可）。当前契约 3.6/3.1 没有该许可原语：
 *   effect.play 只消费已 Finalize 的费用计划，continuous.timing 没有“从 Banishment
 *   打出”的时机/来源改写，Duration 也没有“your next Ending Phase”的具名期限表达；
 * - 离场触发（object-leaves-board）与启动能力的 Kill this 已合入，卡牌侧只声明形状。
 *
 * 依赖：RIFT-89~91（cost.* 与 continuous.* 许可管线）、RIFT-21/31（离场触发与
 * 最后已知信息）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "runeblade-anvil.banish-top",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { zone: "deck", from: "top" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "runebladeAnvilBanish" }
        }
      },
      {
        id: "runeblade-anvil.grant-play",
        op: "effect.play-permission",
        linkedTo: "runeblade-anvil.banish-top",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "runeblade-anvil.banish-top",
            key: "runebladeAnvilBanish.objects"
          },
          zone: { kind: "constant", value: "banishment" },
          payCosts: { kind: "constant", value: true },
          until: { kind: "constant", value: "your-next-ending-phase" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "object-leaves-board", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "runeblade-anvil.leave-banish-top",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { zone: "deck", from: "top" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "runebladeAnvilBanish" }
        }
      },
      {
        id: "runeblade-anvil.leave-grant-play",
        op: "effect.play-permission",
        linkedTo: "runeblade-anvil.leave-banish-top",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "runeblade-anvil.leave-banish-top",
            key: "runebladeAnvilBanish.objects"
          },
          zone: { kind: "constant", value: "banishment" },
          payCosts: { kind: "constant", value: true },
          until: { kind: "constant", value: "your-next-ending-phase" }
        }
      }
    ]
  },
  {
    kind: "activated",
    cost: {
      energy: { kind: "constant", value: 2 },
      power: { kind: "constant", value: ["Chaos"] },
      payments: [{ kind: "exhaust" }]
    },
    timing: "action",
    body: [
      {
        id: "runeblade-anvil.kill-self",
        op: "effect.kill",
        args: { self: { kind: "constant", value: true }, reason: { kind: "constant", value: "runeblade-anvil" } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-3602253c44e8a91cf5da9a5cba735f571ffaf1b9e057b42a094f99611b53f5e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“带期限的打出许可”原语： “Until your next Ending Phase, you may play that card. " +
    "(You still pay its costs.)” 需要把刚被放逐的牌标成可在指定期限内从 Banishment 打出" +
    "（费用照付），当前契约 3.6/3.1 没有该原语——effect.play 只接受已 Finalize 的费用计划，" +
    "continuous.timing 不表达“从 Banishment 打出”，Duration 也没有 \"your next Ending Phase\" " +
    "的具名期限（依赖 RIFT-89~91 的 cost/continuous 许可管线）。牌库顶放逐" +
    "（zoneSlice top，417/428）与启动能力 Kill this（429.1.a.1）已按已合入原语声明；" +
    "离场触发（object-leaves-board，383.2.c.3）依赖 RIFT-21/31 的最后已知信息与离场收集。" +
    "不近似实现。",
  abilities,
  sourceText:
    "When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)\n" +
    ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this."
} satisfies CardProgram;

export default program;
