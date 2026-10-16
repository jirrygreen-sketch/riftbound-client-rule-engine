import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/zaunite-bouncer.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-9cfa0070bcd3f9eedc4527cb2136f412f6a974322e4aadba697f3ae28538b753";
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
  assert.equal(
    program.sourceText,
    "When you play me, return another unit at a battlefield to its owner's hand."
  );
});

test("play-effect trigger is mandatory and scoped to this card (383.4.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
});

test("body targets one other unit at a battlefield and returns it to its owner's hand", () => {
  assert.equal(instruction.id, "zaunite-bouncer.return-unit");
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "zaunite-bouncer.another-unit" });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(instruction.targets, [
    {
      id: "zaunite-bouncer.another-unit",
      filter: { type: "unit", location: { type: "battlefield" }, other: true },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("golden: the targeted battlefield unit returns to its owner's hand (not the controller's)", () => {
  const kernel = world()
    .unit("zaunite", { owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    zone,
    // The card's static selector fields are Exprs; the primitive's v1 schema
    // takes the TargetSpec id and the destination Expr separately.
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { "zaunite-bouncer.another-unit": [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["enemy"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("golden: a stale battlefield reference is ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("zaunite", { owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { "zaunite-bouncer.another-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "trigger end-to-end: card-played self filter, Finalize target lock excluding the source itself ('another', " +
    "355.9.c) and resolve-time re-verification through the trigger/chain pipeline (RIFT-90)"
);
