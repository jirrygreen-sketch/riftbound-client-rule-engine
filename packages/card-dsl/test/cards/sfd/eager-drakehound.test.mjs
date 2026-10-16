import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/eager-drakehound.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-1497e682bf282da7f38e77af1bfab763e1be0d7a44c62995f1af09d4ba6b6281";
const replacement = program.abilities[0];
const enterReady = replacement.with[0];

test("sfd-006-221 Eager Drakehound: validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.equal(program.sourceText, "I enter ready.");
});

test("sfd-006-221 Eager Drakehound: declares an exhausted-entry replacement", () => {
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "object-enters-board", filter: { source: "self", exhausted: true } });
  assert.deepEqual(enterReady, {
    id: "eager-drakehound.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

test("sfd-006-221 Eager Drakehound: replacement body readies an exhausted unit", () => {
  const base = world().unit("drake", { exhausted: true }).build();
  const bound = base.clone({ source: base.ref("drake"), sourceSnapshot: base.getObject("drake") });
  const outcome = resolveChainBody([enterReady], bound);
  assert.equal(outcome.status, "executed");
  assert.equal(bound.getObject("drake").exhausted, false);
  assert.equal(outcome.results[0].result.status, "executed");
});

test.todo("Eager Drakehound: register the CardProgram replacement before Board entry (CR 359.2.c/369.3, RIFT-120)");
