import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/carnivorous-snapvine.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-0198949b45425f8cf47078623d6647cf083dc1971553ed77552f307b6ca7031a";

const ability = program.abilities[0];
const instruction = ability.body[0];
const targetSpec = instruction.targets[0];

test("ogn-149-298 Carnivorous Snapvine: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other."
  );
});

test("ogn-149-298 Carnivorous Snapvine: judgeReason cites 418.6.b.3 and the missing selector-to-ref read", () => {
  assert.match(program.judgeReason, /418\.6\.b\.3/);
  assert.match(program.judgeReason, /ObjectRef/);
  assert.match(program.judgeReason, /effect\.damage/);
});

test("ogn-149-298 Carnivorous Snapvine: play trigger with one enemy-unit-at-a-battlefield target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);

  assert.equal(instruction.id, "snapvine.reciprocal-damage");
  assert.equal(instruction.op, "effect.damage");
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);

  // "choose an enemy unit at a battlefield" is a target (355.10/355.9.a.1).
  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "snapvine.enemy-unit",
    filter: { type: "unit", controller: "opponent", location: { type: "battlefield" } },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "We deal damage equal to our Mights to each other" — the source and the
  // amount are the chosen unit's, read through the target selector. The
  // selector-to-reference read is the missing piece (judgeReason); the object
  // selector shape itself is the contract 3.6 symbolic form.
  assert.deepEqual(instruction.args.amount, {
    kind: "object-property",
    object: { target: "snapvine.enemy-unit" },
    property: "might"
  });
  assert.deepEqual(instruction.args.source, {
    kind: "object-property",
    object: { target: "snapvine.enemy-unit" },
    property: "ref"
  });
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "snapvine.self" });
});

test("ogn-149-298 Carnivorous Snapvine: the enemy unit's Might is the damage read at resolution (418.6.b.3)", () => {
  // With the chosen unit as the source (418.6.b.3), the amount read from its
  // Might is applied to the other unit. The reference kernel supplies the
  // chosen unit as an exact reference, which is exactly the read the program
  // cannot express statically.
  const kernel = world()
    .unit("snapvine", { might: 6 })
    .unit("enemy", { owner: "B", might: 2 })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: instruction.args.amount,
      source: instruction.args.source,
      target: "snapvine.self"
    },
    {
      world: kernel,
      targets: {
        "snapvine.enemy-unit": [kernel.ref("enemy")],
        "snapvine.self": [kernel.ref("snapvine")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(run.result.linkedValues.dealtCount, 1);
  assert.equal(kernel.getObject("snapvine").damage, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("ogn-149-298 Carnivorous Snapvine: a stale chosen unit fails the source read and negates the deal", () => {
  const kernel = world().unit("snapvine", { might: 6 }).unit("enemy", { owner: "B", might: 2 }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    damage,
    {
      amount: instruction.args.amount,
      source: instruction.args.source,
      target: "snapvine.self"
    },
    {
      world: kernel,
      targets: {
        "snapvine.enemy-unit": [stale],
        "snapvine.self": [kernel.ref("snapvine")]
      }
    }
  );

  // The chosen unit's reference is evaluated as the Deal source before the
  // target set is revalidated: an unresolvable read cannot be treated as a
  // source, so the action cannot happen at all (contract 3.6 rule 2:
  // impossible -> negated) rather than being silently retargeted.
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("snapvine").damage, 0);
});

test.todo(
  "ogn-149-298 Carnivorous Snapvine: reading the chosen unit's live reference (source) and Might " +
    "through a target selector needs an expression form that resolves a selector to an object " +
    "reference (contract 3.6 ObjectSelector); today object-property only reads a characteristic. " +
    "Same gap as sfd-107-221 Strike Down (picked-unit read)."
);
test.todo(
  "ogn-149-298 Carnivorous Snapvine: 'We deal ... to each other' is one reciprocal Deal action; its " +
    "simultaneity and last-known-information reads (CR v1.5 418.6.b.3 example Challenge, 359.3.e.13) " +
    "cannot be split into two instructions without changing the result."
);
