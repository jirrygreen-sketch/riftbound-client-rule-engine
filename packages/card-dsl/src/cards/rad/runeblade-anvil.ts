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
 * - "you may play that card" 是游戏效果给出的打出许可（355.4/420.3 的 Play 流程由
 *   效果指令发起），需要一条「指定区域的对象在指定期限内可被打出」的许可通道；
 *   已合入的 continuous.* 原语只覆盖速度、落点、移动与限制/要求，effect.play 只结算
 *   已 Finalize 的费用计划，二者都不建立该许可。

 * status: judge-required（不近似实现），按合入后的 continuous.* / cost.* 与
 * src/programs/*（触发注册）复核：
 * - “Until your next Ending Phase, you may play that card. (You still pay its costs.)”
 *   仍缺一个带具名期限的“从 Banishment 可打出该牌”许可。已合入的 continuous.timing
 *   只登记速度许可，continuous.location 只登记落点许可，continuous.restrict 只登记
 *   限制/要求——都不改写可打出区域；effect.play 只消费已 Finalize 的费用计划
 *   （effects/instructions/effect.play.ts），并不建立许可。
 *   layers/duration.ts 的 Duration 也只有 permanent / end-of-turn / end-of-combat /
 *   while-source-in-zone / until(at, player)，没有“your next Ending Phase”具名期限。
 *   程序保留 effect.play-permission 形状；该 opcode 未注册，解释器会 fail-closed。
 * - 牌库顶放逐（zoneSlice top，417/428）与启动能力的 Kill this（429.1.a.1）已合入，
 *   卡牌侧只声明形状，golden 真实执行这两段。
 * - 离场触发（object-leaves-board，383.2.c.3）时点已由 events/action-adapter.ts 的
 *   zoneTimings 产生；CardProgram 触发的注册路径也已合入（src/programs/triggers.ts，
 *   绑定测试验证两个触发都能注册），整卡仍因打出的具名期限许可缺口保持 judge-required。
 *
 * 依赖：from-Banishment 打出许可原语与 "your next Ending Phase" 具名期限。
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
    "缺「带具名期限的打出许可」：\"Until your next Ending Phase, you may play that card. " +
    "(You still pay its costs.)\" 需要把刚被放逐的牌标成可在指定期限内从 Banishment 打出（费用照付）。" +
    "已合入的 continuous.timing 只登记速度许可、continuous.location 只登记落点许可、continuous.restrict 只登记限制/要求，" +
    "都不改写可打出区域；effect.play 只消费已 Finalize 的费用计划，不建立许可。" +
    "layers/duration.ts 的 Duration 也没有 \"your next Ending Phase\" 具名期限" +
    "（只有 permanent / end-of-turn / end-of-combat / while-source-in-zone / until(at, player)）。" +
    "程序保留 effect.play-permission 形状（该 opcode 未注册，解释器 fail-closed），不近似实现。" +
    "牌库顶放逐（zoneSlice top，417/428）与启动能力 Kill this（429.1.a.1）已按已合入原语声明；" +
    "离场触发（object-leaves-board，383.2.c.3）的时点已由事件管线产生，" +
    "CardProgram 触发的注册路径也已合入（src/programs/triggers.ts），绑定测试验证两个触发都能注册。" +
    "不近似实现。",
  abilities,
  sourceText:
    "When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)\n" +
    ":rb_energy_2::rb_rune_chaos:, :rb_exhaust:: Kill this."
} satisfies CardProgram;

export default program;
