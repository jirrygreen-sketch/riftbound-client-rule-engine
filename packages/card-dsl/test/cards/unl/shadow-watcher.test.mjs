import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadow-watcher.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-914ae0a53b785c0cddd76d977413c9c36d1bc8a2bd78e0f3a1d68a71ae5f718e";
const SOURCE_TEXT =
  "If a friendly unit died during your Beginning Phase this turn, I enter ready.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("unl-037-219 Shadow Watcher: validates identity and preserves the unresolved status", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /315\.2/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /bindReplacement/);
  assert.match(program.judgeReason, /matchesEnterAction/);
});

test("unl-037-219 Shadow Watcher: records the Beginning-Phase death condition", () => {
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
      subject: "friendly-units-died-during-your-beginning-phase-this-turn",
      filter: { type: "unit", controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "shadow-watcher.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

// This is the supported ready body only; it does not establish the printed history condition.
test("unl-037-219 Shadow Watcher golden: the replacement body readies the entering exhausted source", () => {
  const base = world().unit("shadow-watcher", { zone: "board", exhausted: true, might: 5 }).build();
  const ctx = base.clone({
    source: base.ref("shadow-watcher"),
    sourceSnapshot: base.getObject("shadow-watcher")
  });
  assert.equal(ctx.getObject("shadow-watcher").exhausted, true);

  const outcome = resolveChainBody([enterReady], ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["shadow-watcher.enter-ready", "executed"]
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(ctx.getObject("shadow-watcher").exhausted, false);

  const alreadyReady = world().unit("shadow-watcher", { zone: "board", exhausted: false }).build();
  const readyCtx = alreadyReady.clone({
    source: alreadyReady.ref("shadow-watcher"),
    sourceSnapshot: alreadyReady.getObject("shadow-watcher")
  });
  const noop = resolveChainBody([enterReady], readyCtx);
  assert.equal(noop.results[0].result.status, "executed");
  assert.deepEqual(noop.results[0].result.linkedValues.readied, { count: 0, objects: [] });
  assert.deepEqual(readyCtx.events, []);
});

test("unl-037-219 Shadow Watcher golden: a prevented ready body leaves the source exhausted", () => {
  const base = world().unit("shadow-watcher", { exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("shadow-watcher") });
  kernel.addReplacement(action => action.type === "ready" ? "prevented" : null);
  const outcome = resolveChainBody(replacement.with, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(kernel.getObject("shadow-watcher").exhausted, true);
  assert.deepEqual(outcome.events.map(event => ({ action: event.action, outcome: event.outcome })), [
    { action: "ready", outcome: "prevented" }
  ]);
});
