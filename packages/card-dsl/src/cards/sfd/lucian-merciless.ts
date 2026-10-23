import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * Official evidence checked 2026-10-23 against Core Rules v1.5 (dated
 * 2026-10-09, effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
 * The applicable Spiritforged errata contains no Lucian-specific replacement;
 * its Yone entry repeats the ordinary [Weaponmaster] reminder text at [A]:
 * https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
 *
 * Production evidence: the real card-played trigger locks one controlled
 * Equipment; cost.modify reads that object's authoritative Equip.params.cost
 * and discounts one original [A] (CR 821.1.c.2-.3). A named-domain Equip cost
 * pays in full. Remaining [A] can now be committed from an actual Universal
 * Power lot, and an already attached Equipment is reattached. The Conquer
 * trigger receives the exact Unit incarnation; a second real Conquer in the
 * same turn produces another event but cannot consume the per-turn trigger
 * again (CR 383.3.e.1).
 *
 * The remaining production boundary is the failed-payment branch. The
 * Weaponmaster body locks its Equipment in Finalize, then pays the determined
 * Equip cost during Resolve (CR 204.3.a / 821.1.c.2) and attaches only after a
 * successful payment. That success path is proven for named and Universal
 * Power. If the chosen Equipment has no Equip cost, or its cost cannot be
 * paid, CR 821.1.c.4-.5 requires it to remain in place and unattached. Today
 * cost.modify.ts:435-443 raises judge-required for the no-cost selection, while
 * cost.pay.ts:192-230 lets a genuine payment failure escape the Resolve body;
 * chain/engine.ts:1612 does not turn either into Weaponmaster's no-attachment
 * result. Malformed authoritative Equip data must still fail closed, but a
 * known absent/insufficient cost cannot abort the whole resolution. Neither
 * case is approximated with a named Domain or zero cost.
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡保持 judge-required（2026-10-23 生产复核）。" +
    "已闭合：真实 card-played trigger 锁定受控 Equipment，权威 Equip.params.cost 与 [A] 减一生效；" +
    "具名域与 Universal Power 均能实际支付并扣池，已附着 Equipment 能重附着；" +
    "Conquer 绑定精确 Unit incarnation，effect.ready 只执行一次，同回合第二次真实 Conquer 仍产生事件但 once:per-turn 不再触发。" +
    "剩余缺口是不可支付选择：CR 821.1.c.2 / 204.3.a 允许 Weaponmaster 在 Resolve 确定并支付所选 Equipment 的 Equip 费，" +
    "但 CR 821.1.c.4/.c.5 要求没有 Equip 费或费用不可付时让该 Equipment 原地不附着，而不是终止整次解析。" +
    "当前 engine-core/src/effects/instructions/cost.modify.ts:435-443 对没有 Equip 费的选择抛 judge-required；" +
    "engine-core/src/effects/instructions/cost.pay.ts:192-230 又让真实资源不足的 cannot-pay-cost 逃逸，" +
    "chain/engine.ts:1612 的 Resolve 没有 Weaponmaster 专用的“不附着”回执路径。" +
    "建议最小改法：区分合法缺 Equip 能力/确定不可付与畸形缺失数据；前者将 cost.modify/cost.pay/effect.attach 作为一个可回滚的不执行分支，" +
    "只在支付成功时执行附着，畸形或歧义权威数据继续 fail closed；无需把付款错误提前到 Finalize。" +
    "不以具名域替代 Universal Power，不把缺 Equip 费或资源不足近似成 0/可附着。",
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
