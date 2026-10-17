import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/direwing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID = "card.hash-733ee080aef6259973bf03c5ede49e36dd44b081fa4f1040aa0ec8525bcf71b9";
const SOURCE_TEXT = "I enter ready if you control another Dragon.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("sfd-094-221 Direwing: validates and is registered by canonical identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("sfd-094-221 Direwing: records the another-Dragon conditional ready-entry replacement", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "dragons",
      filter: {
        type: "unit",
        tags: ["Dragon"],
        controller: "self",
        zone: "board",
        exclude: "self"
      }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "direwing.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

/** The kernel binds "self" to the context source, so Direwing is the source. */
function direwingWorld({ exhausted = true } = {}) {
  const kernel = world().unit("direwing", { might: 7, exhausted }).build();
  return kernel.clone({ source: kernel.ref("direwing"), sourceSnapshot: kernel.getObject("direwing") });
}

test("sfd-094-221 Direwing golden: the supported replacement body readies the entering exhausted unit", () => {
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

test("sfd-094-221 Direwing golden: an already-ready unit is not readied again", () => {
  const kernel = direwingWorld({ exhausted: false });
  const outcome = resolveChainBody([enterReady], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 0, objects: [] }
  });
  assert.deepEqual(outcome.events, []);
});
