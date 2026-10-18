// Scenarios blocked on the simultaneous combat-damage transaction
// (CR v1.5 467.2.c.1, 467.2.c.1.a, 467.2.d, 467.3, 142.4, 143.3.b,
//  468.1.a, 468.1.a.1, 468.1.a.2, 468.2, 468.3, 468.3.a, 468.3.d, 468.5,
//  468.5.b, 468.5.d, 468.7, 471.1):
//   combat-damage-dealt-simultaneously-shared-deathknell
//   combat-assign-full-lethal-before-spreading                 (damage-dealing half)
//   combat-undamageable-unit-exempt-from-mandatory-assignment
//   combat-prevent-and-doubling-apply-at-assignment-controller-orders
//   combat-assignment-accounts-for-doubling-minimum-applied
//   combat-no-result-recalls-attackers-when-defenders-remain
//   combat-attacker-wins-conquers-battlefield
//   combat-both-sides-wiped-no-result-battlefield-uncontrolled
//   combat-heal-in-combat-cleanup-before-result
//   combat-disarm-checked-once-per-combat                  (once-per-combat trigger scope half)
//
// The assignment-and-validation half of the 467.2.c family IS executed: see
// 467.2.c.3-lethal-before-spreading.test.mjs, 467.2.c.4-lethal-cap-and-existing-damage.test.mjs
// and 143.2.c-negative-might-sums-as-zero.test.mjs in this directory.
import test from 'node:test';

test.todo(
  'combat-damage-dealt-simultaneously-shared-deathknell (467.2.c.1.a / 467.2.d / 808.2): both sides\' '
  + 'assigned damage must be Dealt simultaneously and both sides\' Deathknell triggers collected from that '
  + 'one batch, the controller ordering its own instances (808.2.a). Missing: the atomic batch-commit task '
  + 'with a deferred trigger scan across both sides — CombatFlow.dealDamage() throws '
  + 'TurnCombatBlockedError("simultaneous-damage-transaction"), and the two completed allocation receipts '
  + 'have no executor that turns them into one wave of damage + kills + trigger collection',
);

test.todo(
  'combat-undamageable-unit-exempt-from-mandatory-assignment (467.2.c.10): a Unit that cannot be dealt '
  + 'damage is exempt from the lethal-assignment requirements, so the attacker may skip it entirely. '
  + 'Missing: the combat assignment kernel proves this absence only through '
  + 'DuelBaseCombatSourceEffectProof.preventionReplacement === "proven-none" and has no "cannot be dealt '
  + 'damage" basis in DuelBaseCombatUnitBasis, so an actually-undamageable Unit cannot be modelled '
  + '(the Counter Strike half of 467.2.c.10 — a prevented-but-damageable Unit — needs the same seam)',
);

test.todo(
  'combat-assign-full-lethal-before-spreading (467.2.c.1.a / 467.2.d, dealing half): once both sides have '
  + 'assigned, the damage must actually be Dealt simultaneously, the defending Units must be killed and the '
  + 'resulting state asserted (battlefields.bf1.units.B === []). Missing: the same atomic batch-commit task '
  + '— the merged kernel stops at the completed allocation receipt '
  + '(readyForSimultaneousDeal: true) and CombatFlow.dealDamage() throws '
  + 'TurnCombatBlockedError("simultaneous-damage-transaction"); the assignment half itself is executed in '
  + '467.2.c.3-lethal-before-spreading.test.mjs',
);

test.todo(
  'combat-prevent-and-doubling-apply-at-assignment-controller-orders (467.2.c.5): prevention and'
  + 'damage-doubling replacement effects apply during ASSIGNMENT, in the order the affected Unit\'s '
  + 'controller chooses, and are not applied again when damage is dealt. Missing: the assignment kernel '
  + 'requires the caller to prove that no assignment modifier and no prevention/replacement applies '
  + '(proof flags "proven-none"); there is no per-Unit replacement pipeline inside the assignment step '
  + 'and no controller-ordered application',
);

test.todo(
  'combat-assignment-accounts-for-doubling-minimum-applied (467.2.c.4.a): when assigned damage is'
  + 'modified upward, the assigning player must choose the MINIMUM applied value that is still lethal, '
  + 'so a 3-Might Unit with doubled incoming damage may only be assigned 1 or 2. Missing: the assignment '
  + 'kernel compares the raw assigned amount against lethalNeed and rejects any per-Unit modifier '
  + '(proof flag assignmentModifier === "proven-none"), so it cannot compute an applied lethal minimum',
);

test.todo(
  'combat-no-result-recalls-attackers-when-defenders-remain (468.1.a.2 / 468.3.d / 468.3.d.1): after'
  + 'combat damage the Combat Special Cleanup heals all Units and Recalls the Attackers when Defenders '
  + 'remain, producing a No Result that re-stages Combat and Showdown. Missing: no Recall game action '
  + 'exists (src/turn/flow.ts throws the recall-action block for a non-Unit that must leave a Battlefield, '
  + 'and there is no Recall for Units) plus the atomic damage transaction',
);

test.todo(
  'combat-attacker-wins-conquers-battlefield (468.3.a / 468.5 / 468.5.d / 468.7.a): only the side with'
  + 'Units remaining wins, establishes Control and Conquers, and every Attacker/Defender designation is '
  + 'removed at the Combat end. Missing: the Combat result step (combat-result / combat-end emissions, '
  + '468.3 / 468.7) and Attacker/Defender designations are not implemented — src/combat/flow.ts has no '
  + 'designation state and deals no combat damage',
);

test.todo(
  'combat-both-sides-wiped-no-result-battlefield-uncontrolled (468.3.d / 468.5.b): when both sides are'
  + 'wiped the Combat has No Result and the now-empty Battlefield becomes Uncontrolled with no points. '
  + 'Missing: the same Combat result step plus simultaneous damage dealing; CombatFlow.cleanup() only'
  + 'drops Control when the turn state is open and it never emits combat-result',
);

test.todo(
  'combat-heal-in-combat-cleanup-before-result (468.1.a.1 / 143.3.b.2 / 468.3): the Combat Special'
  + 'Cleanup heals every Unit BEFORE the Combat result is determined, so a surviving Defenders keep their'
  + 'damage healed and win. Missing: the combat special Cleanup invocation (468.1.a) — src/turn/flow.ts '
  + 'only heals during the ending-turn special Cleanup, and combat-result has no producer',
);

test.todo(
  'combat-disarm-checked-once-per-combat (383.4.e.2.a): an attack trigger is checked once per Combat, so'
  + 'a Unit that regains its Attacker designation after a No Result does not trigger Disarm again. '
  + 'Missing: the per-Combat attack-trigger check counter plus designation assignment; the merged Disarm '
  + 'keyword expands to a plain attack-declared trigger (see 831-disarm-attack-trigger.test.mjs) and '
  + 'src/combat/flow.ts never assigns a designation',
);
