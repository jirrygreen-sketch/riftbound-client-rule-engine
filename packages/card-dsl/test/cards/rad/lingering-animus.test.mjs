import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lingering-animus.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ENTER_READY = "lingering-animus.enter-ready";

test("rad-005-167 Lingering Animus: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "I enter ready if a friendly unit or gear died this turn.");
  // README §2: the reason names the still-missing bindings and their owners.
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /HistoryQuery/);
});

test("rad-005-167 Lingering Animus boundary: a never-condition still readies the entry, so the condition is not consumed", () => {
  // Re-probed 2026-10-17: replacement/bind.ts matchesEnterAction() returns true
  // before testCondition() runs, so the entry-orientation replacement fires even
  // for a condition that evaluates to false. This is the production evidence
  // that the card's historical if-clause cannot be consumed as a Condition yet.
  const f = fixture({ cards: [{ id: "animus", types: ["unit"], might: 2, exhausted: true }] });
  const handle = createEngineStaticBinder(f.engine).bindReplacement(
    { ...program.abilities[0], condition: { kind: "never" } },
    f.kernel.getObject("animus")
  );
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("animus"), to: "chain" });
  const outcome = f.engine.commit({ type: "move-zone", object: f.kernel.ref("animus"), to: "base", location: { type: "base", player: "A" } });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("animus").exhausted, false);
  handle.unbind();
});

test("rad-005-167: board-entry replacement readies the entering unit (CR 369.3)", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  // The replacement Condition still cannot read the supported filtered history; it is
  // deliberately absent instead of a placeholder that would silently be false.
  assert.equal(ability.condition, undefined);
  assert.equal(ability.with.length, 1);
  assert.equal(ability.with[0].id, ENTER_READY);
  assert.equal(ability.with[0].op, "effect.ready");
  assert.deepEqual(ability.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("rad-005-167: the replacement body readies the exhausted source through real effect.ready", () => {
  // 用参考内核真实执行 replacement 的 with 体（effect.ready 已合入），验证“就绪”这一半的语义。
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: true }).build();
  assert.equal(kernel.getObject("lingering-animus").exhausted, true);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.id), [ENTER_READY]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("lingering-animus").exhausted, false);
});

test("rad-005-167: a ready source makes the body a no-op executed result (416.1.b)", () => {
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(scoped.events, []);
});

test("rad-005-167: the supported entry replacement binds through programs and readies before Board entry", () => {
  const f = fixture({ cards: [{ id: "animus", types: ["unit"], might: 2, exhausted: true }] });
  // Only the supported entry half is bound: the historical Condition remains
  // blocked on the card and this does not make the whole program executable.
  const handle = createEngineStaticBinder(f.engine).bindReplacement(program.abilities[0], f.kernel.getObject("animus"));
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("animus"), to: "chain" });
  const outcome = f.engine.commit({ type: "move-zone", object: f.kernel.ref("animus"), to: "base", location: { type: "base", player: "A" } });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("animus").zone, "board");
  assert.equal(f.kernel.getObject("animus").exhausted, false);
  const entry = f.engine.pipeline.events.find(event => event.timingPoint === "object-enters-board" && event.object.ref.id === "animus");
  assert.equal(entry.object.exhausted, false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
  handle.unbind();
});

test.todo('Lingering Animus: gate the entry replacement by a friendly unit/gear death this turn, through a replacement Condition that can evaluate HistoryQuery (CR 364.3.a/369.3).');

test("Lingering Animus: real kill history already supports historical type and controller", () => {
  const kernel = world().unit("animus").unit("ally").unit("gear", { types: ["gear"] })
    .unit("enemy", { owner: "B" }).unit("spell", { types: ["spell"] }).build();
  for (const id of ["ally", "gear", "enemy", "spell"]) kernel.perform({ type: "kill", object: kernel.ref(id) });
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "unit", controller: "A" } }), 1);
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "gear", controller: "A" } }), 1);
  assert.equal(kernel.history({ scope: "turn", action: "kill", objectFilter: { type: "unit", controller: "B" } }), 1);
});
