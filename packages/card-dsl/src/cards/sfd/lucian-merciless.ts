import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * Weaponmaster remains judge-required. Its merged expansion reaches the real
 * card-played trigger and locks the chosen Equipment, but cost.modify.ts then
 * stops at 821.1.c.2 because an ObjectSnapshot has no authoritative Equip
 * ability/cost binding and no original [A]/[C] symbol provenance. The first
 * printed sentence therefore cannot execute and is not approximated here.
 *
 * The Conquer clause is production-ready: turn/flow.ts now emits one conquer
 * event per participating Unit with the Unit incarnation, battlefield id and
 * player id, so 383.4.c.2.a's self anchor matches and its `once: per-turn`
 * registration is consumed by the EventPipeline frequency scope. The whole card
 * still stays judge-required because the first printed sentence cannot execute.
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前整卡阻塞是 Weaponmaster（Conquer 句已由生产路径验证）：" +
    "engine-core/src/effects/instructions/cost.modify.ts:280-283 在锁定所选 Equipment 后仍以 " +
    "judge-required 拒绝 821.1.c.2，因为 ObjectSnapshot 没有权威的 Equip ability/cost 绑定，也没有 " +
    "821.1.c.3 所需原始 [A]/[C] 符号来源；不能把印刷 play cost 或普通 Power 减费当作 Equip cost。" +
    "真实 card-played 触发能注册并锁定 Equipment，但当前 Core 只提供该费用的失败边界，不给可执行计划。" +
    "Conquer 不再是缺口：engine-core/src/turn/flow.ts:153-164 现在按每个参战 Unit 发出带 object/source/it、" +
    "objectId、battlefieldId 的真实 conquer 事件；events/pipeline-match.ts:72-98 匹配 Lucian 的 self 锚点，" +
    "本卡 effect.ready 和 self 绑定已由生产 golden 验证；once:per-turn 由 EventPipeline 的既有频率回归覆盖。",
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
