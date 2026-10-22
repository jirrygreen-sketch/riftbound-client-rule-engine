import type { CardProgram } from "../../ir/index.js";

/**
 * Veteran Poro — Weaponmaster (CR v1.5 821.1).
 *
 * The registry program is executable through the production ProgramBinding and
 * ChainEngine path. Its single printed sentence is represented by the
 * Weaponmaster keyword: the production expansion locks one controlled
 * Equipment, reads that object's authoritative Equip CostSpec, reduces only
 * original [A] provenance, pays the remaining cost, and attaches it to Poro.
 * Missing or ambiguous Equip-cost provenance remains fail-closed in the
 * cost.modify source branch (CR 821.1.c.2-.5). The card-dsl golden also covers
 * declining the optional choice and re-attaching Equipment that is already
 * attached.
 */
const veteranPoro = {
  canonicalCardId: "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default veteranPoro;
