import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status: judge-required after re-checking the merged production path on
 * 2026-10-22. The authored trigger, leading may, its one-Energy Finalize cost,
 * and the primitive's Gold play-mode/exhausted-entry shape are executable.
 * Default Match setup now creates the selected Battlefield on the Board at its
 * own Location (CR v1.5 133.6.a.1 / 199.1), and the lifecycle and
 * MatchCommandAdapter bind that exact Board incarnation once.
 *
 * One production blocker remains: creating Gold would silently lose the Gold's
 * mandatory intrinsic ability. definitions.ts:83-102 marks Gold
 * abilityBinding "blocked", so effect.token.ts:340-342 returns
 * "token-definition-or-abilities-judge-required" before creation. The reason
 * is the Add side of CR v1.5 135.2.e.5.b / 187.5: RIFT-929 made [A] payable as
 * a cost (135.2.e.5.a), but effect.resources.ts:35-37,54,126-128 accepts only
 * the six named Domains; effects/contract.ts:260-261 keeps gain-power as
 * Domain[]; and programs/index.ts:40-58 rejects ["rainbow"] as an unverified Add
 * shape. The whole card therefore remains judge-required until Gold can Add
 * Universal Power and execute its intrinsic ability.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一缺口（2026-10-22 生产路径复核）：本卡的 Conquer 触发、前导可选、在 Finalize 支付 1 能量，以及 play Gold 的 mode/entersExhausted 形状均可执行；" +
    "默认 Match 已把所选 Battlefield 放到 Board 并以自身为位置，RIFT-973 的 MatchCommandAdapter 生命周期会绑定该 Board 对象，here 也以其自身 ObjectRef 自锚。" +
    "但金句的宾语 Gold 无法完整生产创建：effects/tokens/definitions.ts:83-102 仍为 abilityBinding=\"blocked\"；" +
    "effect.token.ts:340-342 在创建前返回 token-definition-or-abilities-judge-required。CR 187.5 的 Gold 自带 [Reaction][>] Kill this, [E]: [Add] [A]；" +
    "RIFT-929 已支持 [A] 支付（135.2.e.5.a），但 effect.resources.ts:35-37,54,126-128 仍只接受六域 Power，effects/contract.ts:260-261 的 gain-power 仍为 Domain[]，" +
    "programs/index.ts:40-58 也把 [\"rainbow\"] 视为 unverified Add shape，故 [A] 仍无生产 Add 路径（135.2.e.5.b）。" +
    "在 TokenSpec 创建后补写能力会伪造新客体语义，而当前 fail-closed 生产 golden 会先在 Finalize 扣除已选择的 1 能量，再在 Gold 创建前 fail-closed。" +
    "整卡保持 judge-required，待 Universal Power Add 与 Gold 内建能力由引擎契约/生产路径闭合。",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: true,
      body: [
        {
          id: "treasure-hoard.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to play a Gold gear token exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "treasure-hoard.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "treasure-hoard.create",
                  op: "effect.token",
                  linkedTo: "treasure-hoard.pay",
                  args: {
                    token: { kind: "constant", value: "gold" },
                    // 印刷的 "play a … token"：effect.token mode "play" 在链上创建
                    // 新 token（440.2.c / 185.2.a / 350.2 / 354），再交给打出流程。
                    mode: { kind: "constant", value: "play" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "goldToken" },
                    // CR 184.1 / 185.2.d：印刷的 exhausted 是 token 入场状态，
                    // 由 effect.token 写入 runtime TokenSpec，不能追加事后 Exhaust。
                    entersExhausted: { kind: "constant", value: true },
                    // Non-Unit Gear normally enters at its controller's Base
                    // (359.2.d). The controller-relative selector resolves
                    // through the production location adapter.
                    location: {
                      kind: "location",
                      value: "ability-controller-base"
                    }
                  }
                },
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
