import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (CR v1.5 811.1, 187.5, 184.1/185.2.d).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-22 against
 * the merged production path. The earlier "entersExhausted is not an argument"
 * and "cost.hidden has no layer mapping" diagnoses are obsolete: effect.token
 * carries both entry overrides, and the static binder registers cost.hidden.
 *
 * The remaining whole-card gaps are narrower but still material:
 * - Gold exists in effects/tokens/definitions.ts, but its abilityBinding is
 *   deliberately "blocked"; effect.token therefore returns negated before it
 *   creates anything. Gold's intrinsic 187.5 activated ability also cannot be
 *   discarded: [A] still has no production Add path. Gold's sfd/gold.ts
 *   program remains judge-required, effect.resources accepts only the six named
 *   Domains, and the gain-power action still has no Universal Power variant.
 *   The acyclic PaymentSource additions do not mint Universal Power.
 * - Hidden's permission now binds, but the canonical Hide action is still
 *   rejected by events/contract-actions/bridge.ts, and TurnFlow exposes only
 *   Hidden cleanup/getter state. There is no live Hide transition or
 *   next-turn from-facedown Play entry. programs/play.ts also has no facedown
 *   source-battlefield scope for this spell's target. Consequently
 *   811.1.b/.c/.d.2/.6 are not executable.
 *
 * effect.damage, Finalize target locking, resolve-time target revalidation and
 * the printed Energy cost do execute through ProgramBinding + ChainEngine. The
 * golden also proves that Gold fails closed with a structured receipt instead
 * of creating an ability-less substitute.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前剩余缺口（2026-10-22 生产路径复核实测；不近似实现）：(1) CR 187.5 Gold：effects/tokens/definitions.ts:83-101 已定义 Gold，但 abilityBinding=\"blocked\"，" +
    "effect.token.ts:341-342 会在创建前返回 negated，blockedReason=\"token-definition-or-abilities-judge-required\"；187.5 的内建 [Reaction][>] Kill this, [E]: [Add] [A] 仍不能丢失，" +
    "sfd/gold.ts 仍为 judge-required；RIFT-929 的 UniversalPowerSource 已进入支付/来源表示，但 effect.resources.ts:35-37 仍明确不支持 [A] 产生，" +
    "effect.resources.ts:54 的 gain-power 仍只接受六域；programs/index.ts:40-58 的已验证 Add 形状也只接受六域，" +
    "故生产 binding 在 programs/index.ts:73-77 以 unverified Add shape 拒绝该能力，没有 [A] Add 的生产路径。" +
    "(2) Hidden：statics.ts:393,772 已接受 cost.hidden，effect.token.ts:50-75,345 已支持 184.1/185.2.d 的 entersExhausted，故这两项已解除；" +
    "但 events/contract-actions/bridge.ts:228 仍无条件拒绝 HideAction；TurnFlow.hidden():194 与 :546-570 只有 sidecar/cleanup/getter，没有 Hide 行动或次回合从 facedown 打出的生产入口；" +
    "programs/play.ts:129-165 也未绑定 811.1.d.2 的 facedown 来源战场目标范围，因此 811.1.b/.c/.d.2/.6 尚未闭合。" +
    "已由 ProgramBinding + ChainEngine 生产执行：3 能量、3 点伤害、Finalize 目标锁定与 Resolve 重验；Gold 保持 fail-closed 并返回结构化 blocked receipt。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — the merged primitive accepts
          // mode, location and entersExhausted. Its real blocker is the Gold
          // definition's intrinsic [Add] [A] ability, which keeps the definition
          // fail-closed (see judgeReason).
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;
