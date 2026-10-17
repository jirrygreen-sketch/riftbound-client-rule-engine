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
 * status = judge-required（2026-10-17 源码复核）：
 * - object-moved 有 move-location 动作生产者，但不在 EVENT_PATTERN_TYPES，无法订阅。
 * - Universal Power 仍不在 Domain/gain-power 形状中；不能选一个域代替 [A]。
 * - condition.history 已能计数、比较并消费 objectFilter/exclude，但 trigger.condition
 *   的 count 只查询当前对象，不读取历史；“self-moves-this-turn”不是可执行 subject。
 *   仍需按宿主、当前回合的第 1/2 次移动条件绑定，不能声称历史计数原语不存在。
 * - effect.play-permission 尚未注册，且缺到下次 Ending Phase 的许可生命周期。
 * 能量子效果、移动事件生产及牌库顶 banish 可独立执行，不代表完整触发可用。
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
        // “The second time I move each turn”：缺触发条件到本回合宿主移动历史的绑定。
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
    "(1) object-moved 已由 events/action-adapter.ts 的 move-location 发出，但不在 EVENT_PATTERN_TYPES，订阅被 invalid-event-type 拒绝。" +
    "(2) Universal Power（CR 163.2.b）不在 Domain/gain-power 的六域形状中，effect.resources 不能表达 [A]。" +
    "(3) condition.history 已提供动作计数和数值比较；缺的是 trigger.condition 中按宿主、当前回合读取移动历史的绑定：" +
    "当前 count 只查询对象，self-moves-this-turn/history-record 占位不会产生第 2 次移动语义（383.1）。" +
    "(4) effect.play-permission 未注册，缺从 banishment 打出指定对象、仍支付费用并在你的下次 Ending Phase 到期的许可（CR 317 / 428）。",
  abilities,
  sourceText:
    "The first time I move each turn, [Add] :rb_energy_1::rb_rune_rainbow:.\n" +
    "The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card. (You still pay its costs.)"
} satisfies CardProgram;

export default program;
