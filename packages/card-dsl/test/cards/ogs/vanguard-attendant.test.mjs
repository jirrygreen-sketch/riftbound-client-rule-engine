import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/vanguard-attendant.js";

const CANONICAL =
  "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a";

test("ogs-016-024 Vanguard Attendant: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "I enter ready.");
});

test("ogs-016-024 Vanguard Attendant: judgeReason names the enter-ready replacement gap", () => {
  assert.match(program.judgeReason, /replacement/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /effect\.ready/);
});

test("ogs-016-024 Vanguard Attendant: one replacement ability for entering the board exhausted", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.replaces.event, "object-enters-board");
  // "I enter ready" replaces the exhausted entry of this unit itself
  // (CR 143.4, 359.2.c, 369.3).
  assert.deepEqual(ability.replaces.object, {
    objectId: "self",
    states: "exhausted"
  });
  assert.equal(ability.with.length, 1);
  const [instruction] = ability.with;
  assert.equal(instruction.id, "vanguard-attendant.enter-ready");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogs-016-024 Vanguard Attendant: the with-body readies the source through the merged primitive", () => {
  // The replacement pipeline is missing (judgeReason); this executes only the
  // merged effect.ready primitive the replacement would produce, and asserts it
  // readies the source unit rather than approximating board-entry.
  const kernel = world()
    .unit("vanguard-attendant", { exhausted: true, might: 5 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("vanguard-attendant") });
  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("vanguard-attendant").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(outcome.results[0].result.status, "executed");
});

test("ogs-016-024 Vanguard Attendant: an already-ready unit is not readied again (CR 416.1.b/416.1.c)", () => {
  const kernel = world().unit("vanguard-attendant", { exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("vanguard-attendant") });
  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("vanguard-attendant").exhausted, false);
  assert.equal(outcome.events.length, 0);
  // The interpreter qualifies linked values by instruction path.
  assert.deepEqual(
    outcome.linkedValues["vanguard-attendant.enter-ready.readied"],
    { count: 0, objects: [] }
  );
});

test.todo(
  "ogs-016-024 Vanguard Attendant: 'I enter ready' replaces exhausted entry instead of readying afterwards " +
    "(CR 143.4, 359.2.c, 369.3; 805.6.a for the no-intervening-ready semantics) — the card replacement " +
    "ability is not wired into the event pipeline's replacement registration (RIFT-89~91)"
);
