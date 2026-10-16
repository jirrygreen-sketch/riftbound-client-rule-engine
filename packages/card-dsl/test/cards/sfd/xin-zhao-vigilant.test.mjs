import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/xin-zhao-vigilant.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8";
const ENTER_READY = program.abilities[1].with[0];

const kernelWithSource = (source, values) => {
  const base = world().unit(source, values).build();
  return base.clone({ source: base.ref(source), sourceSnapshot: base.getObject(source) });
};

test("sfd-176-221 Xin Zhao, Vigilant: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-176-221 Xin Zhao, Vigilant: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the real gaps, not a generic "not implemented".
  assert.match(program.judgeReason, /\[Tank\]/);
  assert.match(program.judgeReason, /815\.1\.c/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "I enter ready if you have two or more other units in your base."
  );
});

test("sfd-176-221 Xin Zhao, Vigilant: Tank keyword plus a conditional enter-ready replacement", () => {
  assert.equal(program.abilities.length, 2);
  const [tank, replacement] = program.abilities;

  // [Tank] (815) is declared as a keyword ability only; its expansion into an
  // assignment requirement belongs to effects/keywords/<keyword>.ts (3.7).
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  // "I enter ready" is a replacement effect on entering the Board (359.2.c /
  // 369.3), not a post-entry ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(replacement.with.map((instruction) => [instruction.id, instruction.op]), [
    ["xin-zhao-vigilant.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(ENTER_READY.args, {});
  assert.equal(ENTER_READY.targets, undefined);
  assert.equal(ENTER_READY.picks, undefined);
  assert.equal(ENTER_READY.linkedTo, undefined);
});

test("sfd-176-221 Xin Zhao, Vigilant: the condition counts two or more other friendly units in your base", () => {
  const condition = program.abilities[1].condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 2 });

  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "units");
  // "units in your base": friendly, on the Board, at a Base location; "other"
  // excludes the source itself (the "another" convention, 740.1.a).
  // `location` uses the string form the production matcher evaluates
  // (layers/filter.ts); permanents in your base are yours (107.1.c), so the
  // friendly + base pair identifies "your base".
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    location: "base",
    exclude: "self"
  });
});

// The replacement consumer is unmerged (see judgeReason), so the golden test
// executes the declared with-body against a real board unit: the entering unit
// itself is the replaced event's object, i.e. the bound "source"/host.
test("sfd-176-221 Xin Zhao, Vigilant: the replacement body readies the entering exhausted unit", () => {
  const kernel = kernelWithSource("xin-zhao", { exhausted: true, might: 4 });
  assert.equal(kernel.getObject("xin-zhao").exhausted, true);

  const outcome = resolveChainBody([ENTER_READY], kernel);
  assert.equal(outcome.status, "executed");
  const [result] = outcome.results;
  assert.equal(result.op, "effect.ready");
  assert.equal(result.result.status, "executed");
  assert.deepEqual(result.result.linkedValues, { readied: { count: 1, objects: [kernel.ref("xin-zhao")] } });
  assert.equal(kernel.getObject("xin-zhao").exhausted, false);
  assert.deepEqual(kernel.events.map((event) => event.action), ["ready"]);
});

test("sfd-176-221 Xin Zhao, Vigilant: an already-ready unit is not readied again (416.1.b/c)", () => {
  const kernel = kernelWithSource("xin-zhao", { exhausted: false, might: 4 });
  const outcome = resolveChainBody([ENTER_READY], kernel);
  const [result] = outcome.results;
  assert.equal(result.result.status, "executed");
  assert.deepEqual(result.result.linkedValues, { readied: { count: 0, objects: [] } });
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-176-221 Xin Zhao, Vigilant: [Tank] (CR 815) needs a keyword expansion plus combat damage " +
    "assignment that honours 815.1.b/815.1.c.1/.c.2; combat/base-combat-allocation.ts still records " +
    "'No Tank/Backline/other assignment-priority requirement is bound here' (RIFT-9 continuous.combat / combat workstream)."
);
test.todo(
  "sfd-176-221 Xin Zhao, Vigilant: the replacement.enter pipeline must register this CardProgram replacement, " +
    "evaluate the two-or-more-other-units-in-your-base condition (107.1.b/.c, 198.1) and replace exhausted entry " +
    "before the zone change (359.2.c / 369.3); effect.ready must not be used as a post-entry approximation (RIFT-9/RIFT-120)."
);
