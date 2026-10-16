import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab";
const program = cardProgramsById.get(cardId);

test("breakneck-mech program is registered and validates", () => {
  assert.ok(program, "breakneck-mech must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("breakneck-mech structure: static grant + enter-ready replacement", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("Deflect"), "judgeReason must cite Deflect");
  assert.ok(program.judgeReason.includes("Ganking"), "judgeReason must cite Ganking");
  assert.equal(program.abilities.length, 2);

  const [grant, enterReady] = program.abilities;
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "grant-keyword");
  assert.deepEqual(grant.effect.keywords, ["Deflect", "Ganking"]);
  assert.equal(grant.effect.filter.tag, "Mech");
  assert.equal(grant.effect.filter.controller, "controller");

  assert.equal(enterReady.kind, "replacement");
  assert.equal(enterReady.replaces.event, "object-enters-board");
  assert.equal(enterReady.replaces.filter.source, "self");
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.equal(enterReady.condition.kind, "compare");
  assert.equal(enterReady.condition.left.kind, "count");
  assert.equal(enterReady.condition.left.filter.tag, "Mech");
  assert.equal(enterReady.condition.left.filter.other, true);
  assert.equal(enterReady.condition.operator, "gte");
  assert.equal(enterReady.condition.right.value, 1);
});

test.todo(
  "keyword expansion for Deflect/Ganking and board-entry replacement execution (blocked on keywords/layers/replacement.enter, RIFT-83..85)"
);
