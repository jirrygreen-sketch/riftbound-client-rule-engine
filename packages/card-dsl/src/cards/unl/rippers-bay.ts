import type { CardProgram } from "../../ir/index.js";

/**
 * Ripper's Bay (unl-214-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-214-219, verbatim):
 *   "When a unit here is returned to a player's hand, that player may pay
 *    :rb_energy_1: to channel 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.2 / 383.2.c: "When a unit here is returned to a player's hand" is a
 *   Triggered Ability whose Condition is the unit's zone change to Hand. The
 *   closed timing point `object-enters-hand` (events/timing-points.ts, refs
 *   108.7 / 414.1) is the merged subscription point for a card entering a
 *   player's hand; 383.2.c.3.b notes the information needed to check "here"
 *   must be captured when the ability is processed (the leaving unit's former
 *   location).
 * - 053.3: "here" is this Battlefield — the unit must have been at this
 *   Battlefield, which is the departing object's location, not a property of
 *   the Hand it enters.
 * - 190.6.c: when a Battlefield's ability indicates that a specific player
 *   makes a choice, that player controls the ability and makes the choices.
 *   Here the text names "that player" — the unit's controller — so the payer,
 *   the channeller and the "may" decision all belong to that player, not to
 *   the Battlefield's controller. Both instructions below therefore rely on
 *   the ability's controller (`ctx.controller`, the implicit "you" of
 *   190.6.d) instead of naming a fabricated seat: the missing piece is that
 *   the registration must resolve 190.6.c's named player, not the Battlefield's
 *   controller (see judgeReason; the same event-player gap rad/rakelstake and
 *   ogn/obelisk-of-power record).
 * - 204.3.a / 383.3.a: "that player may pay [1 energy] to channel 1 rune" is a
 *   cost within instructions decided on resolution (204.3.a), so it is an optional
 *   wrapper (contract §3.9 `choice.optional`) holding the payment and the
 *   channel, never a `choice` plus a `linkedTo` consumer.
 * - 431.1 / 431.2 / 431.2.a: "channel 1 rune exhausted" takes one rune from
 *   the top of that player's Rune Deck onto the board, entering exhausted
 *   (by default runes enter readied, which is why the stipulation is passed).
 *
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — the
 * channel half is a merged primitive and the golden test executes the printed
 * merged cost.pay/channel shape through the real interpreter with the payer bound, but the
 * card cannot run as printed:
 * 1. "that player" is an event participant (190.6.c). No frozen
 *    ObjectSelector/Expr reads the triggering event's player, and the merged
 *    TriggerRegistration's `controller` is populated by the caller — nothing
 *    derives it from the event, so "that player" would silently become the
 *    Battlefield's controller if the trigger were registered naively (same gap
 *    rad/rakelstake records);
 * 2. "a unit here" needs the returned unit's former Battlefield. The merged
 *    `object-enters-hand` emission (events/action-adapter.ts) carries the
 *    entering object and fromZone=board, but no battlefield id, so the 053.3
 *    "here" filter cannot be evaluated (the filter key is a documented
 *    placeholder);
 * 3. no merged producer submits the printed 1-Energy payment as a
 *    resolution-time cost (the merged cost.pay primitive settles an already
 *    finalized CostPlan, but no producer builds the payer-scoped plan here)
 *    and no subscriber registers a CardProgram's triggered ability as a
 *    TriggerRegistration (190.6.c choice ownership included).
 * Dependencies: an event-player selector and a play/return-location payload
 * (contract change requests) plus a cost-plan producer / payer binding and
 * RIFT-33 / contract §7.2 batch 5 trigger registration. Nothing is approximated.
 */
export default {
  canonicalCardId:
    "card.hash-3d96eb343671872c717cc1217d0c5e82368ec20ade63cc420ecdaf7d9aee1cef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「that player」是事件的参与者（被回手单位的控制者），而冻结 IR 的选择器只有 " +
    "self/source/target/pick/linked，没有任何 Expr 能读触发事件的玩家；两条指令都只能用能力控制者（190.6.d 的隐含 you），" +
    "真正的缺口是注册方必须按 190.6.c 把控制者解析为该事件玩家，而已合入链路没有该推导" +
    "（同 rad/rakelstake、ogn/obelisk-of-power 的事件玩家缺口）。" +
    "(2)「a unit here」需要被回手单位的原战场：已合入的 object-enters-hand 发射（events/action-adapter.ts）带进入对象与 fromZone=board，" +
    "但没有 battlefield id 载荷，053.3 的 here 无法求值（触发 filter 里的 here/nonBattlefield 键是记录占位）。" +
    "(3) 没有已合入生产者把「另一名玩家的可选费用」作为结算期费用提交——cost.pay 原语已合入" +
    "（只 settle 调用方已 finalize 的 CostPlan），但没有生产方按“该玩家”构造并提交这一支付计划，" +
    "也没有订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（含 190.6.c 的选择归属）。" +
    "依赖：事件玩家选择器与回手地点载荷（契约变更请求）、结算期费用计划的生产方/付款者绑定、" +
    "RIFT-33/契约 §7.2 批 5 触发注册。" +
    "golden 只把 cost.pay 与 effect.channel 的印刷形状（先付费、后横置入场地 channel 1）在绑定付款者后用参考内核执行。",
  sourceText:
    "When a unit here is returned to a player's hand, that player may pay :rb_energy_1: to channel 1 rune exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-enters-hand",
        filter: {
          event: "object-enters-hand",
          // "a unit here": a unit entering a hand from this Battlefield
          // (053.3). The merged event carries the entering object and its
          // fromZone only — no battlefield id — so `here` stays a documented
          // placeholder (see judgeReason) instead of an equality that would
          // match every hand return.
          object: { type: "unit" },
          here: true
        }
      },
      // 383.3.a / 355.12: the "may" and its choices belong to the ability and
      // are made by "that player" (190.6.c); the body realises the decision
      // with the §3.9 optional wrapper.
      optional: true,
      body: [
        {
          id: "rippers-bay.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to channel 1 rune exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 204.3.a / 383.3.a: "that player may pay [1]" is a cost
                  // within instructions paid as this ability resolves. cost.pay
                  // is a merged primitive that settles an already finalized
                  // CostPlan, so the declaration keeps the printed amount
                  // reviewable. The payer is the ability's controller
                  // (190.6.c/190.6.d), which is why no player argument is
                  // fabricated here.
                  id: "rippers-bay.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 } }
                },
                {
                  // 431.1 / 431.2: channel one rune from the top of that
                  // player's Rune Deck, entering exhausted. The channelling
                  // player defaults to the ability's controller (190.6.c), so
                  // no other player's Rune Deck can be used by construction.
                  id: "rippers-bay.channel",
                  op: "effect.channel",
                  linkedTo: "rippers-bay.pay",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    exhausted: { kind: "constant", value: true }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
