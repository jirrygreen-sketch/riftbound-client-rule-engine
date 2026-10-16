// Scenario: targeting-partial-prevent-linked-runs (CR v1.5 359.3.e.14.c)
//
// "Deal 3 ... If you do, heal ..." with part of the damage prevented: the
// linked instruction still executes because it only references the performed
// game action, not how much damage got through.
import test from 'node:test';

// effect.damage returns negated (reason "impossible") as soon as any one damage
// action is prevented, and it only writes the dealt/dealtCount link values on
// a fully executed instruction (primitive rule 2). 359.3.e.14.c requires the
// linked instruction to observe the action as performed with partial
// prevention, so the link result surface is not there yet. The heal also needs
// the "same location as that unit" anchor on linked targets, which only exists
// as a query anchor (sameLocationAs), not as a linked-instruction referent.
test.todo('targeting-partial-prevent-linked-runs: blocked on partial-prevention outcome (359.3.e.6 vs .14.c) — effect.damage has no merged prevented/partial link result and no "same location as that unit" referent');
