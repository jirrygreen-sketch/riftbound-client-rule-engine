// Scenarios blocked on the attack-declared producer and the keyword target bridge
// (CR v1.5 831, 831.1.b, 831.1.c.3, 831.1.d, 831.1.d.1, 831.2, 383.4.e.2,
//  383.4.e.2.a, 383.4.e.2.b, 466.2.c.3, 476, 479):
//   combat-disarm-single-trigger-on-attack
//   combat-disarm-multiple-instances-merge-sum
//   combat-disarm-first-attack-requirement-skipped
//
// combat-disarm-checked-once-per-combat is registered in 467.2.d-simultaneous-combat-damage.test.mjs
// together with the No Result re-staging it depends on.
//
// The merged Disarm keyword already expands to one `attack-declared` triggered
// ability that gives an enemy Unit at the host's Battlefield -X Might this turn
// (src/effects/keywords/Disarm.ts, stacking "sum" for 831.1.d.1 / 831.2), and the
// frozen timing enumeration has `attack-declared`. What is missing is (a) the code
// that emits attack-declared when a Unit gains the Attacker designation, (b) the
// designation itself, and (c) the keyword's `sameLocationAs: "source"` target
// filter, which the program filter bridge rejects.
import test from 'node:test';

test.todo(
  'combat-disarm-single-trigger-on-attack (831.1.b / 831.1.d / 383.4.e.2): the Disarm Unit gains the '
  + 'Attacker designation, its attack trigger becomes a Pending chain item and resolving it gives an '
  + 'enemy Unit at that Battlefield -X Might this turn. Missing: attack-declared / defense-declared have '
  + 'no producer outside src/combat/flow.ts (which throws combat-start-transaction and never assigns a '
  + 'designation), and the Disarm keyword\'s target filter `sameLocationAs: "source"` is rejected by '
  + 'src/programs/filters.ts with "Unsupported filter field sameLocationAs"',
);

test.todo(
  'combat-disarm-multiple-instances-merge-sum (831.1.d.1 / 831.2): all Disarm values on one Unit merge '
  + 'into ONE trigger whose value is the total (summed from printed and granted sources) and only that '
  + 'single trigger is checked. Missing: the same attack-declared producer plus the keyword registrar\'s '
  + 'summed expansion path — test/effects/keywords/Disarm.test.mjs covers the declared stacking and the '
  + 'expansion shape, but no runtime merges multiple instances into one checked trigger',
);

test.todo(
  'combat-disarm-first-attack-requirement-skipped (831.1.b / 383.4.e.2.b): a Unit that cannot attack never '
  + 'gains the Attacker designation, so its Disarm never triggers. Missing: the attack restriction consumer '
  + '(continuous.restrict "prohibit" on the attack action) plus the designation/attack-declared producer; '
  + 'the YAML notes this modelling choice as UNCERTAIN (v1.5 does not spell out whether a prevented '
  + 'attacker keeps the designation)',
);
