import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Akali, Brash (rad-015-167) — Unit, Fury, 5 energy / 1 power / 5 Might.
 *
 * 原文（deck-catalog rad-015-167，逐字）：
 *   "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\nThe second time I
 *    move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you
 *    may play that card. (You still pay its costs.)"
 *
 * 规则依据（CR v1.5）：
 * - "move" 的成功移动对应封闭时点 object-moved（421.1、449.1、449.2），“I move”用 filter self；
 * - “The first time … each turn” 用 TriggerSpec.once: "per-turn"（与 sfd-113-221
 *   Lucian, Merciless 的同一写法一致）；
 * - "[Add] :rb_energy_1::rb_rune_rainbow:" = 获得 1 Energy 与 1 Universal Power
 *   （163.2.b、135.2.e.5），对应 effect.resources；
 * - "banish the top card of your Main Deck" = effect.banish 的牌库顶区域选择（zoneSlice，417/428）；
 * - "Until your next Ending Phase, you may play that card" = 带期限的打出许可（见 judgeReason）。
 *
 * status: judge-required（不近似实现）：
 * - Universal Power（[A]）没有可执行表达：契约 3.6 的 Domain 是六域封闭枚举，
 *   effect.resources 明确记载 “Universal Power (163.2.b) is not representable … never
 *   approximated by a chosen domain”，因此第一段只能声明能量部分，[A] 保持不许称可用；
 * - “The second time I move each turn” 的序数条件：TriggerSpec.once 只有 once 语义，
 *   已合入的 condition.history 只能得到动作计数（interpreter/history.ts 接受 scope/action/
 *   timingPoint/player/object，并已转为消费契约 3.8 的 exclude/objectFilter——但「本回合第
 *   N 次」的序数比较仍需历史谓词），且本卡用 count 占位写法不产生该语义；
 * - “you may play that card” 的期限化打出许可原语缺失：effect.play-permission 未注册
 *   （effects/instructions/ 无该文件），打出的费用交接归 RIFT-261；
 * - 触发订阅还需要 CardProgram → TriggerRegistration 绑定（RIFT-257）。
 *
 * 依赖：Universal Power 表示（RIFT-261 费用/RIFT-258 资源）、历史序数谓词、
 * effect.play-permission 原语与 RIFT-257。已合入部分（object-moved 时点、effect.banish
 * 牌库顶、effect.resources 能量）在 golden 测试真实执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "object-moved", filter: { self: true }, once: "per-turn" },
    optional: false,
    body: [
      {
        id: "akali-brash.add-first-move",
        op: "effect.resources",
        args: {
          energy: { kind: "constant", value: 1 },
          // :rb_rune_rainbow: = Power of any Domain（135.2.e.5 / 163.2.b）。
          // 这里保留印刷写法供审查；effect.resources 的封闭 Domain 不支持 [A]，不近似成六域之一。
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { self: true },
      condition: {
        kind: "compare",
        // “The second time I move each turn”：需要按对象范围的本回合移动序数（占位 subject）。
        // 过滤器带不存在的 zone，使条件在依赖落地前 fail-closed。
        left: {
          kind: "count",
          subject: "self-moves-this-turn",
          filter: { zone: "history-record" }
        },
        operator: "eq",
        right: { kind: "constant", value: 2 }
      }
    },
    optional: false,
    body: [
      {
        id: "akali-brash.banish-top",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { zone: "deck", from: "top" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "akaliBanish" }
        }
      },
      {
        id: "akali-brash.grant-play",
        op: "effect.play-permission",
        linkedTo: "akali-brash.banish-top",
        args: {
          objects: {
            kind: "linked-value",
            instructionId: "akali-brash.banish-top",
            key: "akaliBanish.objects"
          },
          zone: { kind: "constant", value: "banishment" },
          payCosts: { kind: "constant", value: true },
          until: { kind: "constant", value: "your-next-ending-phase" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-299400fea6fee0793728ed914b84549455937a2ee92f40540aa04c765818548e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口：(1) Universal Power（[A]，135.2.e.5 / 163.2.b）无可执行表达——契约 3.6 的" +
    "Domain 是六域封闭枚举，effect.resources 文件明确记载 Universal Power 不可表示、" +
    "不得用任一域近似；(2) “The second time I move each turn” 需要按对象范围的本回合移动序数：" +
    "condition.history 只提供动作计数（含契约 3.8 的 exclude/objectFilter 消费），没有序数谓词；" +
    "(3) “Until your next Ending Phase, you may play that card. (You still pay its costs.)” 需要" +
    "期限化的打出许可原语：effect.play-permission 未注册（effects/instructions/ 无该文件），" +
    "effect.play 只消费已 Finalize 的费用计划（RIFT-261）。此外触发订阅还需要 CardProgram → " +
    "TriggerRegistration 绑定（RIFT-257）。已合入部分（object-moved 时点、effect.banish 牌库顶、" +
    "effect.resources 能量）在 golden 测试真实执行。不近似实现。",
  abilities,
  sourceText:
    "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\n" +
    "The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)"
} satisfies CardProgram;

export default program;
