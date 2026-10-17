import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * - [Weaponmaster] 是 keyword 能力（821）；展开（打出触发 + Equip 费减免 [A] +
 *   effect.attach）由 effects/keywords/Weaponmaster.ts 提供，cost.modify / cost.pay
 *   原语已合入（RIFT-261），但 821.1.c.2 的 Equip 费仍缺“原始 [A]/[C] 符号”绑定：
 *   cost.modify 的 reduce-equip-cost 分支以 judge-required 失败关闭，尚未执行减费。
 * - “The first time I conquer each turn, ready me.” 是触发能力：时点 conquer
 *   （383.4.c，自身参与征服），once per-turn 即 “the first time … each turn”；
 *   指令体只含已合入的 effect.ready 原语（objects 缺省即 source）。
 *   整条能力可表达。
 *
 * 程序整体保持 judge-required：Weaponmaster 的 Equip 费绑定未完成，且征服时点
 * 产生方只发出 player/details、不携带战场对象（turn/flow.ts），program 触发的
 * self 过滤因此无法命中；征服触发能力本身结构完整，golden 测试用解释器 + 参考内核
 * 执行 effect.ready 部分。
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster KeywordDef and the RIFT-261 cost.modify/cost.pay primitives are merged, " +
    "but the 821.1.c.2 Equip-cost binding is still missing: cost.modify throws " +
    "judge-required for reduce-equip-cost because the cost plan cannot distinguish the " +
    "original [A] symbol from [C], so the reduction cannot execute. The conquer trigger " +
    "also cannot fire: the scoring conquer emission carries only player/details and no " +
    "object, so a self filter has nothing to match (turn/flow.ts); the RIFT-257 trigger " +
    "adapter itself registers the event as 'conquered'. The effect.ready body is " +
    "executable in isolation.",
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
