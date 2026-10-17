import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/direwing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-733ee080aef6259973bf03c5ede49e36dd44b081fa4f1040aa0ec8525bcf71b9";
const [replacement] = program.abilities;
const [enterReady] = replacement.with;

/** The kernel binds "self" to the context source, so Direwing is the source. */
function direwingWorld({ exhausted = true } = {}) {
  const kernel = world().unit("direwing", { might: 7, exhausted }).build();
  return kernel.clone({ source: kernel.ref("direwing"), sourceSnapshot: kernel.getObject("direwing") });
}

test("sfd-094-221 Direwing: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-094-221 Direwing: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "I enter ready if you control another Dragon.");
});

test("sfd-094-221 Direwing: judgeReason names the replacement-enter and Dragon-filter gaps", () => {
  assert.match(program.judgeReason, /replacement\/bind\.ts/);
  assert.match(program.judgeReason, /controller/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /Dragon/);
  assert.match(program.judgeReason, /condition/);
});

test("sfd-094-221 Direwing: 'I enter ready' is an entry replacement, not a post-entry effect.ready", () => {
  // 359.2.c / 369.3 with 364.3.a's "If an opponent controls a battlefield, I
  // enter ready." example: the stipulation describes how the unit enters.
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.id, "direwing.enter-ready");
  assert.equal(enterReady.op, "effect.ready");
  assert.deepEqual(enterReady.args, {});
  assert.equal(enterReady.targets, undefined);
  assert.equal(enterReady.picks, undefined);
  assert.equal(enterReady.linkedTo, undefined);
});

test("sfd-094-221 Direwing: the condition counts another Dragon you control (133.8, 740.1.a)", () => {
  // 364.3 / 364.3.a: the "if" clause is part of the replacement's
  // applicability, not a body instruction's condition.
  const condition = replacement.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "dragons");
  // 133.8/133.8.a: "Dragon" is a tag; "another" excludes the source itself.
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    tags: ["Dragon"],
    controller: "controller",
    zone: "board",
    exclude: "self"
  });
});

test("sfd-094-221 Direwing golden: the replacement body readies the entering exhausted unit", () => {
  // This checks the authored with-body against a real board unit. Entry
  // replacement binding already exists, but its condition evaluation still
  // needs the separate entry scenarios below.
  const kernel = direwingWorld({ exhausted: true });
  assert.equal(kernel.getObject("direwing").exhausted, true);

  const outcome = resolveChainBody([enterReady], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["direwing.enter-ready", "executed"]
  ]);
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 1, objects: [kernel.ref("direwing")] }
  });
  assert.equal(kernel.getObject("direwing").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("sfd-094-221 Direwing golden: an already-ready unit is not readied again (416.1.b/c)", () => {
  const kernel = direwingWorld({ exhausted: false });
  const outcome = resolveChainBody([enterReady], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 0, objects: [] }
  });
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "sfd-094-221 Direwing: evaluate the 'another Dragon' condition (133.8/133.8.a, 740.1.a) through " +
    "the existing default lifecycle replacement binding, keeping exhausted entry without another Dragon " +
    "and ready entry with one (143.4 / 359.2.c / 369.3, 364.3.a) — matchesEnterAction must gate the " +
    "entry rewrite on the ability condition"
);

test.todo(
  "sfd-094-221 Direwing: resolve the tags + controller + exclude-source filter for 'another Dragon' — " +
    "bind controller: \"controller\" to the ability controller and exclude: \"self\" to the host; " +
    "tag containment matching is already supported"
);
