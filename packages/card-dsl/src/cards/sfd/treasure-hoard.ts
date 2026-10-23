import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status: judge-required after re-checking the merged production path on
 * 2026-10-23. The authored trigger, leading may, its one-Energy Finalize cost,
 * Gold creation, and Gold's intrinsic ability are production-bound. The
 * remaining gap is the entry state of the token actually being played.
 * Default Match setup now creates the selected Battlefield on the Board at its
 * own Location (CR v1.5 133.6.a.1 / 199.1), and the lifecycle and
 * MatchCommandAdapter bind that exact Board incarnation once.
 *
 * One production blocker remains: TurnFlow.resolve hard-codes every played
 * Gear to ready (`chain/engine.ts:1593-1595`) before the Chain Play action.
 * RIFT-987 now supplies the executable Gold definition/program, so effect.token
 * attaches exhausted=true to the created Token and Gold's
 * Reaction Kill/Exhaust Add [A] ability is available. The nested Play,
 * however, changes that same object to ready, overriding the creating effect's
 * CR v1.5 184.1 / 185.2.d entry stipulation. A Gold which is ready does not
 * carry the printed exhausted entry, so the sentence is not fully implemented.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一缺口（2026-10-23 生产路径复核）：Conquer/here、前导可选、Finalize 支付 1 能量、默认 Match 的 Battlefield 自位自锚及生命周期绑定均已生产通过；" +
    "RIFT-987 后 Gold 定义已是 canonical-card-program，Gold 的 Reaction「Kill this, [E]: [Add] [A]」可经 ProgramBinding/ChainEngine 支付并产生 Universal Power。" +
    "但以 mode=play 创建的 Gold 最终进入 Board 时为 ready，而印文要求 exhausted：effect.token 已将 entersExhausted=true 写入 TokenSpec（CR 184.1/185.2.d），" +
    "TurnFlow 的 gear 子链 Resolve 却在 chain/engine.ts:1593-1595 无条件先执行 ready，再 Play 到 Base，覆盖创建效果规定。" +
    "该 ready Gold 无法满足 CR 187.5 的 [E] 费用，故称为「play a Gold gear token exhausted」仍未完整实现；" +
    "已排除的旧缺口包括 Gold abilityBinding blocked、[A]/rainbow Add 与 Universal Power 支付。整卡保持 judge-required，待 gear Play 的入场状态传递闭合。",
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
