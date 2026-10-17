import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lecturing-yordle.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119";

test("Lecturing Yordle program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\nWhen you play me, draw 1."
  );
});

test("Lecturing Yordle: the declared [Tank] keyword matches the merged KeywordDef and its continuous.combat shape", () => {
  const registered = keywordDefinitionsById.get("Tank");
  assert.ok(registered, "effects/keywords/Tank.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.equal(registered.stacking, "single");
  const [expansion] = tank.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.mode, "damage-assignment");
  assert.equal(expansion.effect.priority, "first");
  assert.equal(expansion.effect.damage, "lethal");
});

test("Lecturing Yordle structure: Tank keyword plus a mandatory self card-played draw", () => {
  assert.equal(program.abilities.length, 2);
  const [tank, triggered] = program.abilities;
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "lecturing-yordle.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("Lecturing Yordle golden: the Draw 1 body draws exactly one card for the controller", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, { amount: instruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("Lecturing Yordle golden: an empty Main Deck draws as much as possible without inventing cards", () => {
  const kernel = world().build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, { amount: instruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "Lecturing Yordle [Tank] (815): the unit must be assigned lethal damage before any other unit with the same " +
    "controller that does not have Tank, during the Combat Damage step (815.1.b / 815.1.c.2); the Tank KeywordDef " +
    "(RIFT-264) expands to a static continuous.combat requirement, but continuous.combat has no combat consumer " +
    "(combat/base-combat-allocation.ts binds no assignment priority)"
);
test.todo(
  "Lecturing Yordle: the card-played 'When you play me, draw 1' trigger must be registered from the CardProgram " +
    "(the trigger-spec vocabulary accepts the card-played event; the program-binding adapter is RIFT-257)"
);
