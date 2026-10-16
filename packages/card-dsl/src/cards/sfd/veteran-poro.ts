import type { CardProgram } from "../../ir/index.js";

/**
 * Veteran Poro (sfd-099-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-099-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *
 * 唯一能力是 [Weaponmaster] 关键词（821）。其展开依赖尚未实现的
 * keywords/weaponmaster.ts（cost.modify + effect.attach），故保持
 * judge-required，不近似实现。
 */
const veteranPoro = {
  canonicalCardId: "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster keyword expansion (keywords/weaponmaster.ts) is not implemented yet: " +
    "821.1.c requires paying the chosen Equipment's Equip cost reduced by [A] (cost.modify) " +
    "before attaching it.",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default veteranPoro;
