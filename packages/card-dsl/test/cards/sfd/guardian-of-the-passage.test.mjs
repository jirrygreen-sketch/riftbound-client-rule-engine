import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/guardian-of-the-passage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps the card's Expr arguments inside
// one literal envelope so each merged primitive validates and evaluates them
// itself. The golden runs use that same path instead of hand-decoding args.
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-291f978c4d26e5c73a603a5f856768f2a0714f4bbe78fc0e3dbe4ac83dfb8767";
const TARGET_ID = "guardian-of-the-passage.card-in-trash";

const [ability] = program.abilities;
const [choice] = ability.body;
const [returnInstruction] = choice.args.body.value;

// The reference kernel's matchesFilter does not evaluate an array-valued
// `type` filter ("unit or gear"), while the production chain's layers filter
// does; so the may-node wrapper cannot complete target preparation on the
// reference kernel. The golden below executes the merged sub-effect (the
// return-to-hand instruction) with a Finalize-locked target, exactly as the
// production path would hand it to the primitive, and the wrapper execution is
// recorded as a test.todo.
function runReturn(kernel, cardRef) {
  return runInstruction(
    zone,
    { target: returnInstruction.args.target.value, to: returnInstruction.args.to },
    { world: kernel, targets: { [TARGET_ID]: cardRef === undefined ? [] : [cardRef] } }
  );
}

test("sfd-035-221 Guardian of the Passage: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-035-221 Guardian of the Passage: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When I hold, you may return a unit or gear from your trash to your hand."
  );
});

test("sfd-035-221 Guardian of the Passage: judgeReason names the trigger-anchor and owner-normalization gaps", () => {
  assert.match(program.judgeReason, /owner/);
  assert.match(program.judgeReason, /source/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /归一化/);
});

test("sfd-035-221 Guardian of the Passage: hold trigger whose body is the may-return shape", () => {
  // 383.4.d / 383.4.d.2.a: a Hold Effect, put on the chain when the controller
  // of the triggering source has held (timing point "hold").
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["guardian-of-the-passage.may-return"]);
});

test("sfd-035-221 Guardian of the Passage: contract 3.9 may-shape with the trash target on the may node", () => {
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, {
    kind: "constant",
    value: "Return a unit or gear from your trash to your hand?"
  });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "guardian-of-the-passage.return-to-hand"
  ]);

  // 355.10.a / 108.2.d: the Trash is a Public Zone, so "a unit or gear from
  // your trash" is chosen and therefore a target (355.7); 355.12: every choice
  // for a may-action is made with the ability, so the TargetSpec sits on the
  // may node. 141.2.b / 148.2.b keep card type valid in every zone.
  assert.equal(choice.targets.length, 1);
  const [target] = choice.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, {
    type: ["unit", "gear"],
    zone: "trash",
    owner: "controller"
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(choice.picks, undefined);

  // The body moves the chosen card to its owner's hand through the closed
  // return-to-hand action (448.2: a zone change, not a Move).
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.targets, undefined);
});

test("sfd-035-221 Guardian of the Passage golden: the locked trash unit returns to its owner's hand", () => {
  const kernel = world()
    .card("dead-ally", { types: ["unit"], owner: "A", zone: "trash" })
    .build();
  const run = runReturn(kernel, kernel.ref("dead-ally"));

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("dead-ally").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["dead-ally"]);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
  assert.equal(run.linked.moved, 1);
});

test("sfd-035-221 Guardian of the Passage golden: a locked gear in the trash returns the same way", () => {
  const kernel = world()
    .card("dead-gear", { types: ["gear"], owner: "A", zone: "trash" })
    .build();
  const run = runReturn(kernel, kernel.ref("dead-gear"));

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("dead-gear").zone, "hand");
});

test("sfd-035-221 Guardian of the Passage golden: a card that left the trash makes the return ignored (CR 359.3.e)", () => {
  const kernel = world()
    .card("fleeing-card", { types: ["unit"], owner: "A", zone: "trash" })
    .build();
  const stale = kernel.ref("fleeing-card");
  kernel.perform({ type: "banish", object: stale });

  const run = runReturn(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("fleeing-card").zone, "banishment");
  assert.deepEqual(run.events, []);
});

test("sfd-035-221 Guardian of the Passage golden: no legal trash card leaves the instruction with nothing to move", () => {
  const kernel = world().build();
  const run = runReturn(kernel, undefined);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo(
  "sfd-035-221 Guardian of the Passage: the hold timing point reaches this ability through the " +
    "trigger -> chain pipeline with the held object's identity exposed to the card registration " +
    "(CR 383.4.d, 383.4.d.2.a) — RIFT-33 / RIFT-120"
);

test.todo(
  "sfd-035-221 Guardian of the Passage: Finalize resolves the TargetSpec's owner: \"controller\" against " +
    "the ability controller and rejects opponent-trash cards (CR 108.2.b, 355.10.a); the reference path " +
    "used above pre-locks the target, so this wiring is unverified (RIFT-90 / RIFT-120)"
);

test.todo(
  "sfd-035-221 Guardian of the Passage: the may wrapper completes target preparation and then skips the " +
    "return when declined (403.1, contract 3.9) — the reference kernel's matchesFilter ignores an " +
    "array-valued type filter (\"unit or gear\"), while the production chain's layer filter evaluates it; " +
    "the wrapper cannot be exercised on the reference kernel yet (RIFT-90 / RIFT-120)"
);
