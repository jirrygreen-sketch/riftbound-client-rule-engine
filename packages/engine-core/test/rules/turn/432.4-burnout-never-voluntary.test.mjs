// Scenario `turn-negative-burnout-never-voluntary` (CR v1.5 432.4 / 411.2).
//
// Burn Out is a Limited Action and a replacement effect: it happens only when a game
// effect instructs a player to move more cards than their Main Deck holds. The new
// layer kernel has no voluntary Burn Out command at all, and it must not gain one:
// the negative here is that the action set never exposes it. Writing an "assert this
// feature does not exist" test would be a weightless assertion, so the covered
// property is recorded in the Burn Out todos above, which state that the action may
// only be produced by the instructed replacement path.
import test from 'node:test';

test.todo('turn-negative-burnout-never-voluntary: blocked — the instructed Burn Out replacement itself is missing (CR 432.4 / 432.5; module: src/turn/flow.ts draw task + structural rules task; op: none; timing: 315.4.b.1/415.4). Once the Burn Out rules task exists, the negative is that the Burn Out action is reachable only from the instructed replacement and never from a discretionary command; see test/rules/turn/315.4.b-burnout-draw.test.mjs.');
