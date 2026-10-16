import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vayne-hunter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6";
const MAY_ID = "vayne-hunter.may-return";

test("ogn-035-298 Vayne, Hunter: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ogn-035-298 Vayne, Hunter: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
      "If an opponent controls a battlefield, I enter ready.\n" +
      "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
  );
});

test("ogn-035-298 Vayne, Hunter: Assault 3 keyword, conditional enter-ready replacement, optional conquer return", () => {
  assert.equal(program.abilities.length, 3);
  const [assault, replacement, triggered] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 3 });

  // "If an opponent controls a battlefield, I enter ready." — a conditional
  // replacement (364.3 / 369.3), not a post-entry effect.ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(replacement.condition.kind, "compare");
  assert.equal(replacement.condition.left.kind, "count");
  assert.equal(replacement.condition.left.subject, "battlefields");
  assert.deepEqual(replacement.condition.left.filter, { controller: "opponent" });
  assert.equal(replacement.condition.operator, "gte");
  assert.deepEqual(replacement.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(replacement.with.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.enter-ready", "effect.ready"]
  ]);

  // "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  const body = choice.args.body.value;
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(body.map((instruction) => [instruction.id, instruction.op]), [
    ["vayne-hunter.pay-1", "cost.pay"],
    ["vayne-hunter.return-to-hand", "effect.zone"]
  ]);
  assert.deepEqual(body[0].args, { energy: { kind: "constant", value: 1 } });
  assert.equal(body[1].linkedTo, "vayne-hunter.pay-1");
  assert.deepEqual(body[1].args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(body[1].targets, [
    {
      id: "vayne-hunter.self",
      filter: { source: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-035-298 Vayne, Hunter: declining the optional pay leaves the board unchanged", () => {
  const kernel = world().build();
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = runAbilityBody([program.abilities[2].body[0]], kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.events.length, 0);
});

test("ogn-035-298 Vayne, Hunter: the return-to-hand instruction returns the chosen self object to its owner's hand", () => {
  const kernel = world()
    .unit("vayne", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 2
    })
    .build();
  const instruction = program.abilities[2].body[0].args.body.value[1];
  const run = runInstruction(
    zone,
    { target: "vayne-hunter.self", to: instruction.args.to },
    { world: kernel, targets: { "vayne-hunter.self": [kernel.ref("vayne")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("vayne").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["vayne"]);
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
});

test.todo(
  "ogn-035-298 Vayne, Hunter: 'I enter ready' as an entry replacement when an opponent controls a " +
    "battlefield needs the replacement.enter consumer and a battlefield-control predicate (RIFT-91 owns " +
    "the layers/replacement pipeline); effect.ready must not be used to approximate it."
);
test.todo(
  "ogn-035-298 Vayne, Hunter: accepting the optional pay must charge 1 energy before the return-to-hand " +
    "instruction runs (cost-within-instructions, 383.3.b) through the cost/Finalize pipeline (RIFT-89); " +
    "the reference kernel does not register cost.pay."
);
