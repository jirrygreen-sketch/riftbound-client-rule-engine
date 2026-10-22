import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * Official evidence checked 2026-10-22 against Core Rules v1.5 (dated
 * 2026-10-09, effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
 * The applicable Spiritforged errata contains the same [Weaponmaster] reminder
 * text at [A], with no card-specific replacement:
 * https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
 *
 * Production evidence: the real card-played trigger locks one controlled
 * Equipment; cost.modify reads that object's authoritative Equip.params.cost
 * and discounts one original [A] (CR 821.1.c.2-.3). A named-domain Equip cost
 * pays in full, and a reduced [A] cost can be paid with ordinary Power. The
 * Conquer trigger receives the exact Unit incarnation and readies it once.
 *
 * The whole card remains judge-required because a remaining [A] may consume a
 * Universal Power lot, but the current authoritative host cannot carry and
 * commit that lot: PlayerSnapshot.power excludes UniversalPowerSource
 * (contract.ts:91), the reference pay handler leaves the `any` lot unconsumed
 * (test-kernel.ts:572-592), and the server pay handler rejects that source
 * (engine-runtime/host.ts:760-771). Declining the trigger is correct. Selecting
 * an Equipment with no Equip cost also remains a generic fail-closed boundary:
 * cost.modify.ts:435-443 raises judge-required instead of treating the
 * unpayable cost as a harmless non-event (CR 821.1.c.1/.c.4).
 * Neither boundary is approximated with a named Domain or fake resolution.
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Weaponmaster 的生产触发、真实 card-played 生命周期、所选装备锁定、权威 Equip.params.cost、具名域支付与 [A] 减一均已验证；" +
    "Conquer 的 self 事件、effect.ready 与 once:per-turn 注册也已由生产路径验证。" +
    "整卡仍阻塞于剩余 [A] 的实际 Universal Power 资源提交：CR 135.2.e.5.a / 163.2.b 允许任意 Universal Power 支付剩余 [A]，" +
    "但 engine-core/src/effects/contract.ts:91 的 PlayerSnapshot.power 仍只有六域；engine-core/src/effects/testing/test-kernel.ts:572-592 " +
    "收到含 universalPower 的付款计划后报告 done 却不扣减 `any` lot，付款所有权检查因此回滚；" +
    "apps/game-server/src/engine-runtime/host.ts:760-771 也拒绝 `any` / universalPower。" +
    "另一个次级 fail-closed 边界是 CR 821.1.c.1/.c.4：选到没有 Equip 费的 Equipment 时，" +
    "engine-core/src/effects/instructions/cost.modify.ts:435-443 仍抛 judge-required，而不是让该不可支付费用成为不产生附着的非事件。" +
    "因此不以具名域替代 Universal Power，也不把缺 Equip 费近似成 0。",
  abilities: [
    { kind: "keyword", keyword: "weaponmaster" },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquered", role: "self" }, once: "per-turn" },
      optional: false,
      body: [{ id: "ready-self", op: "effect.ready", args: {} }]
    }
  ],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "The first time I conquer each turn, ready me."
} satisfies CardProgram;

export default lucianMerciless;
