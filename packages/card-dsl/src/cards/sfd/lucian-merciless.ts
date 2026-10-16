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
 *   effect.attach）由 effects/keywords/weaponmaster.ts 负责，尚未实现。
 * - “The first time I conquer each turn, ready me.” 是触发能力：时点 conquer
 *   （383.4.c，自身参与征服），once per-turn 即 “the first time … each turn”；
 *   指令体只含已合入的 effect.ready 原语（objects 缺省即 source）。
 *   整条能力可表达。
 *
 * 程序整体保持 judge-required，因为 Weaponmaster 展开缺失；征服触发能力本身
 * 结构完整，golden 测试用解释器 + 参考内核执行 effect.ready 部分。
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster keyword expansion (keywords/weaponmaster.ts) is not implemented yet: " +
    "821.1.c requires paying the chosen Equipment's Equip cost reduced by [A] (cost.modify) " +
    "before attaching it (effect.attach exists). The conquer trigger ability itself is " +
    "expressible with the merged effect.ready primitive.",
  abilities: [
    { kind: "keyword", keyword: "weaponmaster" },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { role: "self" }, once: "per-turn" },
      optional: false,
      body: [{ id: "ready-self", op: "effect.ready", args: {} }]
    }
  ],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "The first time I conquer each turn, ready me."
} satisfies CardProgram;

export default lucianMerciless;
