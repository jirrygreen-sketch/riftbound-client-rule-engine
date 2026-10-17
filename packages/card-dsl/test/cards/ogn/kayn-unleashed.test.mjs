import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kayn-unleashed.js";

const CANONICAL = "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7";
const [ganking, replacement] = program.abilities;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /moved twice/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "If I have moved twice this turn, I don't take damage."
  );
});

test("[Ganking] is declared as a keyword ability only (810; expansion belongs to the keyword registry)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(ganking.value, undefined);
});

test("damage immunity records the intended twice-moved condition and a prevention replacement", () => {
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "damage", filter: { target: "self" } });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "moves-this-turn",
      filter: { object: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 2 }
  });
  // "I don't take damage" prevents the damage event (438.1/438.7); an empty
  // replacement body is the prevention shape consumed by the merged RIFT-260
  // pipeline; the card stays judge-required because the "moved twice"
  // condition cannot be evaluated from event history (see judgeReason).
  assert.deepEqual(replacement.with, []);
});

test.todo(
  "expand [Ganking] into an executable battlefield-to-battlefield movement permission once the movement " +
    "system consumes continuous.movement and a card/keyword-expansion binding registers it (RIFT-83 " +
    "KeywordDef and RIFT-258/259 continuous.movement are merged; RIFT-257 binding and the zones/movement " +
    "consumer are still missing)"
);
test.todo(
  "count this unit's own Move events in the current turn inside a replacement condition; the closed Condition " +
    "IR has no history form and ResolveContext.history is not reachable from a replacement condition, so the " +
    "declared compare/count predicate (CR 438.7) cannot gate the prevention yet"
);
