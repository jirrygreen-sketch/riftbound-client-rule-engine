import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status: judge-required after re-checking the merged production path on
 * 2026-10-22. The leading may, its one-Energy payment, the Gold play-mode
 * handoff, and exhausted entry are authored in the normal production shape:
 * programs/trigger-adapters/leading-choice.ts lifts the leading optional
 * payment into the Finalize cost plan, effect.token implements the chain-to-
 * board Play handoff, and it carries `entersExhausted` (CR v1.5 184.1 /
 * 185.2.a / 185.2.d / 350.2 / 354 / 440.2.c).
 *
 * The remaining blockers are concrete:
 * 1. Gold remains blocked at its token definition: definitions.ts:83-102
 *    sets abilityBinding "blocked", and effect.token.ts:340-342 returns
 *    "token-definition-or-abilities-judge-required" before creating it. Its
 *    canonical program is also judge-required because [A] cannot be Added:
 *    effect.resources.ts:35-37,54,126-128 accepts only the six named Domains,
 *    effects/contract.ts:260-261 keeps gain-power as Domain[], and
 *    programs/index.ts:40-58 rejects `["rainbow"]` as an unverified Add
 *    shape. CR v1.5 135.2.e.5.b / 187.5 therefore has no production Add path;
 *    materializing Gold now would silently lose its intrinsic ability.
 * 2. Normal Match setup still creates every selected Battlefield in the Chain
 *    zone (game/lifecycle.ts:250-258,382-385), while CR 133.6.a.1 says
 *    Battlefields start on the Board. RIFT-959 now makes the lifecycle attach a
 *    selected setup battlefield when a production action explicitly moves it
 *    to Board, but the default MatchCommandAdapter path reaches the same setup
 *    without establishing it there.
 * 3. The matcher accepts `here`, but CR 199.1 describes a Battlefield as the
 *    Game Object at its own Location. events/pipeline-match.ts:17-23,34-37,
 *    89-94 only derives the anchor from source.location and does not fall back
 *    to source.ref.id. The default setup carrier's otherwise self-located
 *    battlefield (location null) therefore cannot satisfy this anchor.
 *
 * The authored optional Choice, its Finalize-linked one-Energy cost, `mode:
 * "play"`, controller Base destination and exhausted entry retain production
 * goldens. The whole card stays judge-required until Gold's Add, the default
 * setup Board transition, and the `here` self anchor are sound.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（2026-10-22 生产路径复核）：(1) Gold 在 effects/tokens/definitions.ts:83-102 仍为 abilityBinding=\"blocked\"；" +
    "effect.token.ts:340-342 在创建前返回 token-definition-or-abilities-judge-required。CR 187.5 的 Gold 自带 [Reaction][>] Kill this, [E]: [Add] [A]；" +
    "RIFT-929 已支持 [A] 支付（135.2.e.5.a），但 effect.resources.ts:35-37,54,126-128 仍只接受六域 Power，effects/contract.ts:260-261 的 gain-power 仍为 Domain[]，" +
    "programs/index.ts:40-58 也把 [\"rainbow\"] 视为 unverified Add shape，故 [A] 仍无生产 Add 路径（135.2.e.5.b），不能创建后遗失内建能力。" +
    "(2) 默认 Match 初始化仍在 game/lifecycle.ts:250-258,382-385 把选中 Battlefield 以 Chain 区 token 创建并留在该区，" +
    "违反 CR 133.6.a.1 的开局 Board 表示；RIFT-959 已让显式生产 move-zone 到 Board 后的 attachLifecycle 绑定 setup Battlefield，" +
    "但默认 MatchCommandAdapter 路径仍到达同一未迁移的 createMatch setup，所以 Treasure Hoard 在生产默认对局中不会注册。" +
    "(3) here 词表与翻译已合入，但 events/pipeline-match.ts:17-23,34-37,89-94 只由 source.location 推导战场锚点；" +
    "CR 199.1 的 Battlefield 自身即为战场对象，其 location 为 null 时应由 ObjectRef id 自锚，而 matcher 尚未采用该身份。" +
    "已解除：choice.optional + cost.pay 经 leading-choice 在 Finalize 支付；mode \"play\" 与 entersExhausted 的生产链路已可验证；" +
    "生产 golden 在可注册夹具上验证 1 能量于 Finalize 扣除，随后 Gold 在 Resolve 前 fail-closed。",
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
