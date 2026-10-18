// Scenario chain-reflexive-trigger-added-during-resolution (CR v1.5 336.1, 388.1, 389.1).
//
// BLOCKED - not converted to an execution test.
//
// 388.1/389.1: a Reflexive Trigger ("Do this:") creates a new Pending Chain Item
// that the same FEPR process handles (336.1). No merged instruction creates one:
// the interpreter's registry has 42 opcodes and none of them is `trigger.reflexive`,
// so the shape used by the official programs (for example
// packages/card-dsl/src/cards/ven/forgotten-relic.ts) throws
// "Unregistered instruction opcode: trigger.reflexive" during Resolve.
// The engine does support the surrounding property: a Chain Item added while
// another item resolves is processed by the same FEPR pass (see the passing tests
// for chain-trigger-added-during-closed-state and chain-reaction-added-restarts-finalize),
// but that is a Triggered Ability added by a real event, not a Reflexive Trigger
// created by the resolving instruction. Asserting the latter by hand would fake it.
import test from 'node:test';

test.todo('chain-reflexive-trigger-added-during-resolution: blocked on the `trigger.reflexive` instruction that creates an independent Pending item from a resolving effect (388.1/389.1); no merged opcode produces one, so the item cannot be built without faking the chain');
