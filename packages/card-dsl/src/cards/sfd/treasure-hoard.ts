import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status: judge-required after re-checking the merged production path on
 * 2026-10-22. The earlier claims that `here` was rejected, that exhausted entry
 * was unavailable, and that the payment waited for Resolve are obsolete:
 * - programs/filters.ts translates `here` into a closed EventPattern;
 * - effect.token carries `entersExhausted` on the runtime TokenSpec
 *   (CR v1.5 184.1 / 185.2.d); and
 * - programs/trigger-adapters/leading-choice.ts lifts this leading optional
 *   payment into the Finalize cost plan, before Resolve.
 *
 * The remaining blockers are concrete:
 * 1. Gold is present in effects/tokens/definitions.ts but deliberately marked
 *    abilityBinding "blocked". effect.token returns
 *    "token-definition-or-abilities-judge-required" before creating anything.
 *    RIFT-929 made Universal Power payable, but not Addable: effect.resources
 *    still accepts only the six named Domains and the gain-power action still
 *    carries Domain[]. CR v1.5 187.5 therefore has no production path for Gold's
 *    intrinsic [Add] [A], so creating the Token would silently lose an official
 *    ability.
 * 2. Match setup creates each selected Battlefield as a Chain-zone token and
 *    leaves it there (game/lifecycle.ts). Program lifecycle scans only secret
 *    zones when attached, and setup's direct host creation emits no entry edge
 *    that could make it ensure the selected Battlefield. In a default match,
 *    Treasure Hoard's Conquer trigger is therefore never registered.
 * 3. The matcher now accepts the `here` vocabulary, but it compares
 *    source.location.id to details.battlefieldId. CR v1.5 199.1 says a
 *    Battlefield is an object at its own location. A normal Battlefield whose
 *    object itself is the battlefield therefore needs its ObjectRef id as the
 *    self anchor; the matcher does not use that identity. A fixture which puts
 *    the Battlefield card's location at a named field can register and fire,
 *    but the normal self-located representation fails closed.
 *
 * The authored optional Choice, its Finalize-linked one-Energy cost, `mode:
 * "play"`, the controller Base destination and exhausted entry retain their
 * production goldens. The whole card stays judge-required until Gold's Add and
 * the Battlefield trigger lifecycle are sound.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（2026-10-22 生产路径复核）：(1) Gold 已在 effects/tokens/definitions.ts:83-102 定义，但 abilityBinding=\"blocked\"；" +
    "effect.token.ts:340-342 在创建前返回 token-definition-or-abilities-judge-required。CR 187.5 的 Gold 自带 [Reaction][>] Kill this, [E]: [Add] [A]；" +
    "RIFT-929 已让 [A] 可作为支付来源（135.2.e.5.a/163.2.b），但 effect.resources.ts:35-37,54,126-128 仍只允许六域 Power，" +
    "effects/contract.ts:257-259 的 gain-power 仍为 Domain[]，所以 [A] 没有生产 Add 路径（135.2.e.5.b），不能创建后遗失内建能力。" +
    "(2) 默认 Match 初始化在 game/lifecycle.ts:250-252,373-377 把选中的 Battlefield 作为 Chain-zone token 创建后留在 Chain；" +
    "programs/lifecycle.ts:155-184,278-279,439-440 挂载时只主动扫描 secret zones，而 Board 来源才绑定正向触发器，故默认生产对局没有 Treasure Hoard 注册。" +
    "后续 attach 虽将 Board 视为正向触发器来源，但 setup 的直接 host create-token 不经过 lifecycle entry；CR 133.6.a.1 的卡牌开局 Board 表示仍缺失。" +
    "(3) here 词表与翻译已合入，但 events/pipeline-match.ts:17-23,89-94 仍只比较 source.location.id 与 details.battlefieldId；" +
    "CR 199.1 的 Battlefield 对象自身即战场位置，其 location 为 null 且以 ObjectRef id 标识；matcher 未采用该自锚点。" +
    "已解除：entersExhausted 由 effect.token 承载（184.1/185.2.d）；choice.optional + cost.pay 经 leading-choice 在 Finalize 支付；" +
    "mode \"play\" 的 Chain→Play 路径可证明（440.2.c/185.2.a/350.2/354）。生产 golden 在可注册夹具上验证 1 能量确实于 Finalize 扣除，" +
    "随后 Gold 在 Resolve 前创建即 fail-closed；正常 createMatch 夹具验证 Battlefield 仍停在 Chain。",
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
