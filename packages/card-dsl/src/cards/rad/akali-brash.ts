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
 * status: judge-required（复核 2026-10-17；不近似实现）：
 * - 两段触发都无法订阅：object-moved 时点虽在 timing-points.ts（421.1、449.1/449.2），
 *   但不在 EVENT_PATTERN_TYPES（events/trigger-spec.ts），pipeline.registerTrigger 的
 *   assertTriggerSpec 会判 invalid-event-type，RIFT-257 的 programs/triggers.ts 与
 *   filters.ts 也无法把该事件名交出去。
 * - Universal Power（[A]）没有可执行表达：契约 3.6 的 Domain 是六域封闭枚举，
 *   effect.resources 明确记载 “Universal Power (163.2.b) is not representable … never
 *   approximated by a chosen domain”（实测 ['rainbow'] 得 negated/impossible），
 *   因此第一段只能声明能量部分，[A] 不许称可用；
 * - “The second time I move each turn” 的序数条件缺谓词：TriggerSpec.once 只有 once 语义，
 *   interpreter 的 condition.history（history.ts 的 historyCount）只按 scope/action/
 *   timingPoint/player/object/exclude/objectFilter 给出动作计数，「本回合第 N 次」的序数比较
 *   仍需历史谓词；本卡用 count 占位写法不产生该语义；
 * - “Until your next Ending Phase, you may play that card” 的期限化打出许可原语缺失：
 *   effect.play-permission 未注册（effects/instructions/ 无该文件，实测落入解释器 default
 *   分支抛错）；RIFT-261 的 cost.pay/cost.modify 已合入，但仍不提供打出许可。
 * RIFT-257 的 CardProgram → TriggerRegistration 绑定已合入，不再是缺口。已合入部分
 * （object-moved 时点、effect.banish 牌库顶、effect.resources 能量）在 golden 测试真实执行。
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
    "(1) 两段触发都无法订阅：object-moved 不在 EVENT_PATTERN_TYPES（events/trigger-spec.ts），" +
    "pipeline.registerTrigger 的 assertTriggerSpec 判 invalid-event-type，RIFT-257 的" +
    "programs/triggers.ts 与 filters.ts 也无法把该事件名交出去。" +
    "(2) Universal Power（[A]，135.2.e.5 / 163.2.b）无可执行表达——契约 3.6 的 Domain 是六域" +
    "封闭枚举，effect.resources 明确记载 Universal Power 不可表示、不得用任一域近似（实测得到 " +
    "negated/impossible）。" +
    "(3)「The second time I move each turn」需要按对象范围的本回合移动序数：condition.history " +
    "（interpreter/history.ts）只提供动作计数（含契约 3.8 的 exclude/objectFilter 消费），没有序数谓词。" +
    "(4)「Until your next Ending Phase, you may play that card. (You still pay its costs.)」需要" +
    "期限化的打出许可原语：effect.play-permission 未注册（effects/instructions/ 无该文件）。" +
    "RIFT-261 的 cost.pay/cost.modify 与 RIFT-257 的绑定均已合入，不再是缺口。已合入部分" +
    "（object-moved 时点、effect.banish 牌库顶、effect.resources 能量）在 golden 测试真实执行。不近似实现。",
  abilities,
  sourceText:
    "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\n" +
    "The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)"
} satisfies CardProgram;

export default program;
