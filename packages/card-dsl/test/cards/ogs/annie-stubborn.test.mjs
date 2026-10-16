import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/annie-stubborn.js";

const CANONICAL =
  "card.hash-957d137989f6eb7bb87001a5bdd8aa194b1e53e56b635b1b841362d901c3b39d";
const TARGET_ID = "annie-stubborn.spell-in-trash";

const ability = program.abilities[0];
const [instruction] = ability.body;

test("ogs-010-024 Annie, Stubborn: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, return a spell from your trash to your hand."
  );
});

test("ogs-010-024 Annie, Stubborn: card-played self trigger returns one spell from the controller's trash", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "annie-stubborn.return-spell");
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(instruction.linkedTo, undefined);

  // "a spell from your trash": one TargetSpec over the controller's spells in
  // the trash. The trash is public, so this is targeting (CR 355.10.a), and
  // card type applies in every zone (CR 141.2.b, 148.2.b).
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, {
    type: "spell",
    zone: "trash",
    owner: "controller"
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(instruction.picks, undefined);
});

test("ogs-010-024 Annie, Stubborn: the locked spell moves from trash to hand through effect.zone", () => {
  const kernel = world()
    .card("lightning-rush", { name: "Lightning Rush", types: ["spell"], zone: "trash" })
    .build();
  const locked = kernel.ref("lightning-rush");
  const run = runInstruction(
    zone,
    // effect.zone takes the TargetSpec id as a plain string and `to` as an Expr
    // (the merged primitive's own schema); the card's Exprs are passed through.
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { [TARGET_ID]: [locked] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("lightning-rush").zone, "hand");
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
  assert.equal(run.linked.moved, 1);
});

test("ogs-010-024 Annie, Stubborn: a spell that left the trash before resolution makes the instruction ignored", () => {
  const kernel = world()
    .card("lightning-rush", { types: ["spell"], zone: "trash" })
    .build();
  const stale = kernel.ref("lightning-rush");
  assert.equal(kernel.perform({ type: "banish", object: stale }).status, "done");
  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  // CR 359.3.e.5-e.7: all targets illegal/unavailable -> the instruction is ignored.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("lightning-rush").zone, "banishment");
});

test.todo(
  "ogs-010-024 Annie, Stubborn: the card-played trigger enters the chain as a Pending item after the " +
    "unit is played (CR 383.4.a.2, 420.4.a) and Finalize locks the spell target with revalidation " +
    "(CR 355.8, 355.9) — depends on the production trigger/chain wiring (RIFT-120)"
);
