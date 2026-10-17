// Scenario chain-chronobreak-multiplayer-turn-order (CR v1.5 303.2.a, official Radiance patch notes).
//
// BLOCKED - not converted to an execution test.
//
// The scenario plays the real card Chronobreak and expects each owner to place its
// own banished Units back on the Chain from the turn player onward. None of the
// mechanisms that requires is merged:
//   * the card program is `judge-required` (packages/card-dsl/src/cards/rad/chronobreak.ts),
//     so `ProgramRegistry.get` refuses it with ProgramBindingError;
//   * "As an additional cost to play this, pay any amount of Power" is a variable
//     additional cost (204.2.a); cost/plan-types.ts models only fixed CostAmount
//     components and has no X binding into the resolving instructions;
//   * "its owner plays that unit back to the same location or to their base" needs
//     a per-object owner chooser and per-object destination choice, plus the
//     pre-Banish location, which 124 discards on the zone change;
//   * no merged opcode consumes `effect.play-back` (42 registered ops, no play-back),
//     and "ignoring its cost" (356.1.b.1) has no rewrite path for a game-effect Play.
// Placing Units on the Chain by hand would fake the card, so this stays a todo.
import test from 'node:test';

test.todo('chain-chronobreak-multiplayer-turn-order: blocked on a variable "pay any amount of Power" additional cost (204.2.a), the pre-Banish location, and a per-owner effect.play-back with an ignored cost (356.1.b.1); the Chronobreak program is judge-required and no merged opcode consumes effect.play-back');
