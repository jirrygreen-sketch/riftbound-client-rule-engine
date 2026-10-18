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
 *   "when this leaves the board" 是离开 Board 触发（383.2.c.3），对应时点
 *   object-leaves-board（events/action-adapter.ts 的 zoneTimings 已产生），
 *   需要最后已知信息（383.2.c.3.b）与离场前收集；
 * - "banish the top card of your Main Deck"：牌库顶必须按区域真实顺序取（契约 3.6
 *   zoneSlice；query 不保证顺序），effect.banish 的 zone 选择（{zone:"deck", from:"top"}）
 *   已合入；
 * - ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this." 是启动能力（400 起）：
 *   费用 2 能量 + 1 Chaos Power + 横置自身，效果 Kill this（429.1.a.1）。
 * - "Until your next Ending Phase, you may play that card" 是游戏效果给出的打出许可
 *   （355.4/420.3 的 Play 流程由效果指令发起），需要一条「指定区域的对象在指定期限内
 *   可被打出」的许可通道；已合入的 continuous.* 原语只覆盖速度、落点、移动与限制/要求，
 *   effect.play 只结算已 Finalize 的费用计划，二者都不建立该许可。
 *
 * status: judge-required（2026-10-17 复核）。缺口只剩「从 Banishment 打出该牌的许可」：
 * effect.play-permission 仍不在 effects/instructions 注册表（解释器 fail-closed）。
 * 已合入且被 golden 真实执行的半段：牌库顶放逐（zoneSlice top，417/428）、启动能力的
 * Kill this（429.1.a.1）、层 duration 的「你的下一个结束步骤」到期语义，以及两个触发
 * 经 src/programs/triggers.ts 的真实注册。
 * 依赖：from-Banishment 打出许可原语。
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
    "缺「从 Banishment 打出指定牌的许可」原语：\"Until your next Ending Phase, you may play that card. " +
    "(You still pay its costs.)\" 需要把刚被放逐的牌标成可在指定期限内从 Banishment 打出（费用照付）。" +
    "已合入的 continuous.timing 只登记速度许可、continuous.location 只登记落点许可、continuous.restrict 只登记限制/要求，" +
    "都不改写可打出区域；effect.play 只消费已 Finalize 的费用计划，不建立许可；effect.play-permission 仍未注册（解释器 fail-closed）。" +
    "期限已可用 layers/duration.ts 的 until + turn-end + player 表达（golden 真实执行：其他玩家结束时保留，指定玩家结束时失效）。" +
    "牌库顶放逐（zoneSlice top，417/428）与启动能力 Kill this（429.1.a.1）已按已合入原语真实执行；" +
    "离场触发（object-leaves-board，383.2.c.3）与打出触发均已经 src/programs/triggers.ts 注册。不近似实现。",
  abilities,
  sourceText:
    "When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)\n" +
    ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this."
} satisfies CardProgram;

export default program;
