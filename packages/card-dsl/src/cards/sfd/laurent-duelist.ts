import type { CardProgram } from "../../ir/index.js";

/**
 * Laurent Duelist (sfd-156-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-156-221):
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)
 *
 * [Assault 2] is a declared keyword, not a card-local effect. The engine
 * Assault KeywordDef expands it into a continuous arithmetic +2 Might effect,
 * conditioned on the exact Unit's Attacker designation (CR 807.1.c/.d.1).
 * CombatFlow establishes and removes that designation at CR 466.2.c.3 and
 * 468.7.a; the ChainEngine's read-only combat-role projection makes the live
 * static condition and layer path observe the same designation without
 * mutating the authoritative host snapshot. ProgramBinding installs the
 * expansion automatically when Laurent enters the Board.
 *
 * The production Play path pays the printed 4 Energy with no Power, installs
 * this static when the Unit enters the Board, and the default damage planner
 * consumes the already-layered current Might exactly once. The card has no
 * trigger, alternative or additional cost, replacement effect, target, or
 * player choice. The card-dsl production golden covers the attacker, defender,
 * non-Combat, real Combat Cleanup and combat-end boundaries.
 */
const laurentDuelist = {
  canonicalCardId: "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [{ kind: "keyword", keyword: "assault", value: 2 }],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default laurentDuelist;
