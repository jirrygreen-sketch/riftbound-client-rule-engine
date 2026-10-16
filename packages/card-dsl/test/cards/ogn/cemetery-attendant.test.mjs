import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cemetery-attendant.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-9737147ed5d1bc44fe4888e08c2da381c529e02f1cb71540821c07384949de3c";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play me, return a unit from your trash to your hand.");
});

test("play-effect trigger is mandatory and scoped to this card (383.4.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
});

test("body targets one unit card in your trash and returns it to hand (355.10.a, 417.x)", () => {
  assert.equal(instruction.id, "cemetery-attendant.return-unit");
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "cemetery-attendant.unit-in-trash" });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(instruction.targets, [
    {
      id: "cemetery-attendant.unit-in-trash",
      filter: { zone: "trash", type: "unit", owner: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("golden: the targeted trash unit moves to its owner's hand through effect.zone", () => {
  const kernel = world().card("fallen", { zone: "trash", types: ["unit"], owner: "A" }).build();
  const run = runInstruction(
    zone,
    // The card's static selector fields are Exprs; the primitive's v1 schema
    // takes the TargetSpec id and the destination Expr separately.
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { "cemetery-attendant.unit-in-trash": [kernel.ref("fallen")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.equal(run.linked.destination, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["fallen"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("golden: a stale trash reference is ignored (359.3.e.7)", () => {
  const kernel = world().card("fallen", { zone: "trash", types: ["unit"], owner: "A" }).build();
  const stale = kernel.ref("fallen");
  kernel.perform({ type: "banish", object: stale });
  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { "cemetery-attendant.unit-in-trash": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "play-effect end-to-end: subscribe at card-played with the self filter, lock the trash target in Finalize, " +
    "and re-verify it at resolution through the trigger/chain pipeline (RIFT-90 chain/event batch)"
);
