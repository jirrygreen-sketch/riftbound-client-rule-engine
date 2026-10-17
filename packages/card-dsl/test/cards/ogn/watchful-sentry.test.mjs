import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/watchful-sentry.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-101c2b7846a23a872f4b23e49a531cd63f2f748e72c5e2c986d4967bcd8d19e7";

test("Watchful Sentry program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Deathknell] — Draw 1. (When I die, get the effect.)"
  );
});

test("Watchful Sentry structure: Deathknell keyword plus the printed effect as an object-killed trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });

  // 808.1.c: Deathknell is functionally "When I die, [Effect]."; 808.1.d: the
  // trigger is the permanent being killed and sent to the Trash.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "watchful-sentry.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("Watchful Sentry golden: the printed Draw 1 effect draws one card", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, { amount: instruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Watchful Sentry Deathknell end-to-end: the permanent being killed registers its Pending trigger before moving to the " +
    "Trash with last-known information recorded, and a replaced death removes it from the chain (808.1.d.1 / 808.1.d.2 / " +
    "808.1.d.3); blocked on the trigger.leave primitive (no registered InstructionDef) and the CardProgram " +
    "keyword/trigger registration (RIFT-257)"
);
