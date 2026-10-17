import type { CardProgram } from "../../ir/index.js";

/**
 * Emperor's Dais (sfd-207-221) — Battlefield, SFD.
 *
 * "When you conquer here, you may pay :rb_energy_1: and return a unit you
 *  control here to its owner's hand. If you do, play a 2 :rb_might: Sand
 *  Soldier unit token here."
 *
 * Rules anchors (Core Rules v1.5):
 * - "When you conquer here" is a Conquer Effect controlled by the
 *   battlefield's controller (190.6.a/190.6.d), triggered at the `conquer`
 *   timing point (383.4.c, 470.3, 471.1, 473.2.a; contract 3.5). "you" in a
 *   battlefield ability is its controller (190.6.d), which the engine's
 *   PlayerSelector spells `self` (events/trigger-spec.ts).
 * - "you may pay [1 energy] and return a unit you control here" — "unit you
 *   control here" is chosen, so it is a target (355.7, 355.9.a.1: "unit"
 *   means a Board object; 355.10). The return-to-hand is the frozen
 *   `return-to-hand` action (effect.zone to "hand" routes to the owner).
 * - "If you do, play a … token" depends on the payment/return actually having
 *   been performed (204.3.a, 205: later instructions check whether the game
 *   action happened, not whether a cost was paid), hence the linkedTo chain.
 * - Sand Soldier is the CR 187.3 token (2 Might, Shurima); playing a new token
 *   creates it on the Chain and hands it to the play flow (440.2.c, 185.2.a,
 *   350.2, 354), which is exactly effect.token's "play" mode.
 * - "here" is the source's own location at resolution: condition.value binds
 *   it, and effect.token's `location` reads the linked value (the merged
 *   sfd/royal-guard / sfd/azir-ascendant convention). No controller-relative
 *   LocationRef spelling is needed for the destination any more.
 *
 * Status rationale (contract 3.1): the payment instruction, the trigger, the
 * optional wrapper, the unit target, the return-to-hand zone move, the "here"
 * destination and the Sand Soldier token are each expressible with merged
 * primitives, but the ability as a whole stays judge-required for two wiring
 * gaps that the card program cannot close by itself:
 * - CR 383.3.b/383.3.b.1 pays the 1-energy cost as the triggered ability's base
 *   cost during Finalize. The merged trigger registration keeps its own
 *   TriggerRegistration without a cost slot and ChainEngine.finalize only
 *   prices spell/unit/gear chains, so nothing charges this base cost yet.
 * - "When you conquer here" needs the conquer timing point with the here
 *   restriction; the card-facing trigger-filter translator rejects the
 *   sameLocationAs/here anchors it would have to read.
 */
export default {
  canonicalCardId: "card.hash-0049ad19b30eb5fd30b02674e302272e9df4b060fbe5a8e672fb9f5bb9c5e417",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "1 能量支付原语已合入（cost.pay，payments: { energy: 1 } 的 finalized record 形状，204.3.a/205/356），" +
    "payment → return-to-hand → Sand Soldier 的 'If you do' 回执链路有真实执行测试；但整卡仍 judge-required，" +
    "缺口是接线而非原语：(1) CR 383.3.b/383.3.b.1 要求紧跟 'you may' 的该费用作为触发式能力的基础费用在 " +
    "Finalize 支付，而卡牌程序 → TriggerRegistration 的注册路径不填 cost 槽位，ChainEngine.finalize 也只对 " +
    "spell/unit/gear 收取印刷费用，触发链无处收取这笔基础费用（契约 3.1/3.5）。" +
    "(2) 'When you conquer here' 的触发过滤（conquer 时点 + here 锚点）在卡牌注册层的 translateObjectFilter " +
    "里被拒（sameLocationAs/here 锚点不在其封闭词表），卡侧无法订阅该时点。" +
    "不近似实现：不省略能量支付，也不把它写成普通触发体内动作。",
  sourceText:
    "When you conquer here, you may pay :rb_energy_1: and return a unit you control here to its owner's hand. If you do, play a 2 :rb_might: Sand Soldier unit token here.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "self" }
      },
      optional: true,
      body: [
        {
          id: "emperors-dais.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy and return a unit you control here?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "emperors-dais.pay",
                  op: "cost.pay",
                  // 204.3.a/205 + 356：1 能量结算支付；能量从控制者的资源池扣除。
                  args: {
                    payments: {
                      kind: "constant",
                      value: [{ kind: "energy", amount: { kind: "constant", value: 1 } }]
                    }
                  }
                },
                {
                  id: "emperors-dais.return-unit",
                  op: "effect.zone",
                  linkedTo: "emperors-dais.pay",
                  args: {
                    target: { kind: "constant", value: "emperors-dais.unit-here" },
                    to: { kind: "constant", value: "hand" }
                  },
                  targets: [
                    {
                      id: "emperors-dais.unit-here",
                      filter: {
                        type: "unit",
                        controller: "self",
                        sameLocationAs: "source"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // "here"：359.3.f.1/359.3.f.2 的 referent——结算时读能力来源自身的
                  // 当前位置。静态 IR 不能写运行时 ObjectRef，故用 condition.value
                  // 绑定（与已合入 sfd/royal-guard、sfd/azir-ascendant 同型）。
                  id: "emperors-dais.read-here",
                  op: "condition.value",
                  args: {
                    value: {
                      kind: "object-property",
                      object: "source",
                      property: "location"
                    },
                    key: { kind: "constant", value: "here" }
                  }
                },
                {
                  id: "emperors-dais.sand-soldier",
                  op: "effect.token",
                  linkedTo: "emperors-dais.pay",
                  args: {
                    token: { kind: "constant", value: "sand-soldier" },
                    amount: { kind: "constant", value: 1 },
                    mode: { kind: "constant", value: "play" },
                    location: {
                      kind: "linked-value",
                      instructionId: "emperors-dais.read-here",
                      key: "here"
                    },
                    linkKey: { kind: "constant", value: "sandSoldier" }
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
