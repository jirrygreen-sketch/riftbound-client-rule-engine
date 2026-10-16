import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/master-yi-honed.js";

const CANONICAL =
  "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761";
const SOURCE_TEXT = "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready.";

test("ogs-009-024 Master Yi, Honed: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-009-024 Master Yi, Honed: judgeReason names continuous.movement and replacement.enter", () => {
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ogs-009-024 Master Yi, Honed: [Ganking] keyword plus an enter-ready replacement", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, replacement] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });

  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-enters-board");
  assert.deepEqual(replacement.replaces.object, {
    objectId: "self",
    states: "exhausted"
  });
  assert.equal(replacement.condition, undefined);
  assert.equal(replacement.with.length, 1);
  const [withInstruction] = replacement.with;
  assert.equal(withInstruction.id, "master-yi-honed.enter-ready");
  assert.equal(withInstruction.op, "effect.ready");
  assert.deepEqual(withInstruction.args, {});
});

test("ogs-009-024 Master Yi, Honed: the Ganking keyword is the registered engine keyword id", () => {
  // The printed bracket name is "Ganking"; the merged engine definition lives at
  // effects/keywords/Ganking.ts with keyword: "Ganking" (CR 810). CardProgram
  // keyword abilities use the lowercase slug consumed by the registry adapter.
  assert.equal(program.abilities[0].keyword, "ganking");
});

test("ogs-009-024 Master Yi, Honed: the replacement body would ready the source unit (effect.ready primitive)", () => {
  // The replacement itself cannot run (judgeReason); this executes only the
  // merged effect.ready primitive that the replacement would produce.
  const kernel = world().unit("master-yi", { exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("master-yi") });
  const outcome = runAbilityBody(program.abilities[1].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("master-yi").exhausted, false);
  assert.deepEqual(outcome.results.map(result => result.op), ["effect.ready"]);
});

test.todo(
  "ogs-009-024 Master Yi, Honed: Ganking's continuous.movement permission lets the unit make a " +
    "battlefield-to-battlefield Standard Move (CR 810.1.b/810.1.c, 144.4.c) — the merged movement " +
    "system does not read continuous.movement (RIFT-89~91)"
);

test.todo(
  "ogs-009-024 Master Yi, Honed: 'I enter ready' replaces exhausted entry through the " +
    "replacement.enter pipeline (CR 143.4, 359.2.c, 369.3, 805.6.a) — card replacement abilities " +
    "are not wired into the event pipeline (RIFT-89~91); effect.ready must not simulate it"
);
