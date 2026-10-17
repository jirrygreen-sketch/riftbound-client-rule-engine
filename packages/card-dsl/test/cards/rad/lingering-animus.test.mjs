import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lingering-animus.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3";
const SOURCE_TEXT = "I enter ready if a friendly unit or gear died this turn.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("rad-005-167 Lingering Animus: validates identity and preserves the unresolved status", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /matchesEnterAction/);
});

test("rad-005-167 Lingering Animus: records the conditional ready-entry replacement", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "friendly-unit-or-gear-died-this-turn",
      filter: { zone: "history-record", type: ["unit", "gear"], controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "lingering-animus.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

test("rad-005-167 Lingering Animus golden: the supported replacement body readies an exhausted source", () => {
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(replacement.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["lingering-animus.enter-ready", "executed"]
  ]);
  assert.equal(scoped.getObject("lingering-animus").exhausted, false);
});

test("rad-005-167 Lingering Animus golden: an already-ready source is a no-op", () => {
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(replacement.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.readied, { count: 0, objects: [] });
  assert.deepEqual(scoped.events, []);
});

test("rad-005-167 Lingering Animus golden: the supported replacement path enters the unit ready", () => {
  const f = fixture({ cards: [{ id: "animus", types: ["unit"], might: 2, exhausted: true }] });
  const handle = createEngineStaticBinder(f.engine).bindReplacement(
    replacement,
    f.kernel.getObject("animus")
  );

  f.engine.commit({ type: "move-zone", object: f.kernel.ref("animus"), to: "chain" });
  const outcome = f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("animus"),
    to: "base",
    location: { type: "base", player: "A" }
  });

  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("animus").zone, "board");
  assert.equal(f.kernel.getObject("animus").exhausted, false);
  const entry = f.engine.pipeline.events.find(
    event => event.timingPoint === "object-enters-board" && event.object.ref.id === "animus"
  );
  assert.equal(entry.object.exhausted, false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
  handle.unbind();
});

test("rad-005-167 Lingering Animus golden: history keeps friendly unit and gear deaths distinct", () => {
  const kernel = world()
    .unit("animus")
    .unit("ally")
    .unit("gear", { types: ["gear"] })
    .unit("enemy", { owner: "B" })
    .unit("spell", { types: ["spell"] })
    .build();
  for (const id of ["ally", "gear", "enemy", "spell"]) kernel.perform({ type: "kill", object: kernel.ref(id) });
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "unit", controller: "A" } }), 1);
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "gear", controller: "A" } }), 1);
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "unit", controller: "B" } }), 1);
});
