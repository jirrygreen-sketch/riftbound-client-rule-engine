import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/magma-wurm.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d92b1df4324a20717aaeab68c916883889ea337f917bdf10104e9df82f9a3c19";
const ENTER_READY = program.abilities[0].with[0];

test("magma-wurm: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("magma-wurm: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.equal(program.sourceText, "Other friendly units enter ready.");
});

test("magma-wurm: a single replacement ability for other friendly units entering the board (369.3)", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { type: "unit", controller: "controller", other: true, zone: "board" }
  });
  // "Other" excludes the source itself; the replaced object is not the source.
  assert.equal(ability.replaces.filter.other, true);
  assert.equal(ability.condition, undefined);
});

test("magma-wurm: the replacement declares a ready entry through effect.ready (not a post-hoc ready)", () => {
  assert.equal(program.abilities[0].with.length, 1);
  assert.equal(ENTER_READY.id, "magma-wurm.enter-ready");
  assert.equal(ENTER_READY.op, "effect.ready");
  assert.deepEqual(ENTER_READY.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(ENTER_READY.targets, undefined);
  assert.equal(ENTER_READY.picks, undefined);
  assert.equal(ENTER_READY.linkedTo, undefined);
});

test("magma-wurm: the ready primitive readies an exhausted unit through the interpreter (410/416.1)", () => {
  // The replacement pipeline itself is unmerged (see judgeReason), so this
  // executes the declared replacement instruction against a real board unit to
  // prove the instruction body is a live, valid primitive call.
  const base = world().unit("ally", { might: 3, exhausted: true }).build();
  // The interpreter binds "source" to the host/source reference the caller
  // supplies (interpreter README); a replacement handler binds it to the
  // replaced event's object, so the test supplies the ally as the source.
  const kernel = base.clone({ source: base.ref("ally"), sourceSnapshot: base.getObject("ally") });
  assert.equal(kernel.getObject("ally").exhausted, true);
  const outcome = resolveChainBody([ENTER_READY], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").exhausted, false);
  const [result] = outcome.results;
  assert.equal(result.op, "effect.ready");
  assert.equal(result.result.status, "executed");
  assert.equal(result.result.linkedValues.readied.count, 1);
});

test("magma-wurm: an already-ready unit is not readied again and the instruction stays executed (416.1.b/c)", () => {
  const base = world().unit("ally", { might: 3 }).build();
  const kernel = base.clone({ source: base.ref("ally"), sourceSnapshot: base.getObject("ally") });
  const outcome = resolveChainBody([ENTER_READY], kernel);
  const [result] = outcome.results;
  assert.equal(result.result.status, "executed");
  assert.equal(result.result.linkedValues.readied.count, 0);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "magma-wurm: the replacement.enter pipeline that intercepts object-enters-board before the unit commits " +
    "(CR 369.3, board entry defaults to exhausted per 359.2.c) is RIFT-9 work"
);
test.todo(
  "magma-wurm: the entering unit must be the replaced event's object, not the replacement source " +
    "(Magma Wurm stays on the board); needs the 'source inside a replacement' binding that contract 3.6 does not yet define"
);
