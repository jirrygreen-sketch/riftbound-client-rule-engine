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
 * Status rationale: cost.pay and the zone/token sub-effects are merged. The
 * authored body demonstrates those primitives, not the full printed timing:
 * programs/triggers.ts does not lift the leading optional decision into the
 * existing TriggerRegistration.mayAtFinalize field (383.3.a). CR 205 explicitly
 * keeps the payment before "If you do" as a game action at resolution, not a
 * base cost; the unit's return is likewise a targeted effect, not a cost pick.
 * The program filter translator rejects here/sameLocationAs. The scoring
 * event's battlefieldId also needs a source-relative here binding.
 */
export default {
  canonicalCardId: "card.hash-0049ad19b30eb5fd30b02674e302272e9df4b060fbe5a8e672fb9f5bb9c5e417",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "剩余缺口：(1) CR 383.3.a 要求开头的可选决定在 Finalize 处理；TriggerRegistration 已有 mayAtFinalize，但 programs/triggers.ts 未把 choice.optional 提取到该字段。依 CR 205，If you do 前的支付是结算期游戏动作，不是触发能力基础费用；返回手牌也不是费用，不能误报 return-to-hand 支付种类缺失。(2) translateObjectFilter 拒绝目标的 sameLocationAs 与触发的 here；conquer 生产者仅携带 details.battlefieldId，缺与来源战场的相对匹配绑定。事件模式使用已支持的 conquered（管线映射到 conquer），不再将事件名称列为缺口。cost.pay、返回拥有者手牌与 Soldier 创建/play 已有子效果执行证据，整卡仍为 judge-required。",
  sourceText:
    "When you conquer here, you may pay :rb_energy_1: and return a unit you control here to its owner's hand. If you do, play a 2 :rb_might: Sand Soldier unit token here.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" }
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
                  // CR 205: a resource-paying game action at resolution, not a base cost.
                  args: {
                    payments: {
                      kind: "constant",
                      value: { energy: 1 }
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
                  linkedTo: "emperors-dais.return-unit",
                  condition: {
                    kind: "compare",
                    left: { kind: "linked-value", instructionId: "emperors-dais.return-unit", key: "moved" },
                    operator: "eq",
                    right: { kind: "constant", value: 1 }
                  },
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
