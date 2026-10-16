import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/aspiring-engineer.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-42c6dcbbb2a43d71583d7fd72c03eb1e7cc0b4d8cb1b53e989180e14f02d2ce1";
const TARGET_ID = "aspiring-engineer.gear-in-trash";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-061-221 Aspiring Engineer: program validates, is registered and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, return a gear from your trash to your hand."
  );
});

test("sfd-061-221 Aspiring Engineer: card-played self trigger returning one gear from the controller's trash", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a: "When you play me" fires once the play action completes.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "aspiring-engineer.return-gear");
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);

  // 355.10.a / 108.2.d: a card in the controller's Trash is a public object, so
  // it is chosen as a target; card type applies in every zone (141.2.b/148.2.b).
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, { type: "gear", zone: "trash", owner: "self" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-061-221 Aspiring Engineer golden: the locked gear moves from trash to hand", () => {
  const kernel = world()
    .card("long-sword", { name: "Long Sword", types: ["gear"], zone: "trash", owner: "A" })
    .card("enemy-gear", { name: "Enemy Gear", types: ["gear"], zone: "trash", owner: "B" })
    .build();
  const locked = kernel.ref("long-sword");
  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { [TARGET_ID]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.getObject("long-sword").zone, "hand");
  // Only the chosen card moves; the opponent's Trash is untouched (056/108.2.a).
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(run.linked.moved, 1);
});

test("sfd-061-221 Aspiring Engineer golden: a gear that left the trash makes the instruction ignored", () => {
  const kernel = world()
    .card("long-sword", { types: ["gear"], zone: "trash", owner: "A" })
    .build();
  const stale = kernel.ref("long-sword");
  // The card changed zones between Finalize and resolution.
  assert.equal(kernel.perform({ type: "banish", object: stale }).status, "done");

  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );

  // 359.3.e.5-e.7: every target is unavailable -> the instruction is ignored.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("long-sword").zone, "banishment");
});

test.todo(
  "sfd-061-221 Aspiring Engineer: the card-played trigger enters the chain as a Pending item after " +
    "the unit is played (CR 383.4.a.2, 420.4.a) and Finalize locks the trash target with revalidation " +
    "(CR 355.8, 355.9) — depends on the production trigger/chain wiring (RIFT-120)"
);
