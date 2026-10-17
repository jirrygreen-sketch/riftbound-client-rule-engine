import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jinx-rebel.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// card-dsl has no dependency edge on engine-core, so golden execution loads the
// built engine through its workspace layout instead of the package name.
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const READY_ID = "jinx-rebel.ready-me";
const MIGHT_ID = "jinx-rebel.might-this-turn";

test("ogn-202-298 Jinx, Rebel: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /per-batch|批次/);
  assert.match(program.judgeReason, /card-discarded/);
  assert.equal(
    program.sourceText,
    "When you discard one or more cards, ready me and give me +1 :rb_might: this turn."
  );
});

test("ogn-202-298 Jinx, Rebel: discard trigger with ready-me then an end-of-turn Might instruction", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-discarded");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-discarded",
    player: "controller"
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  const [ready, might] = ability.body;
  assert.equal(ready.id, READY_ID);
  assert.equal(ready.op, "effect.ready");
  // "ready me" — effect.ready defaults to the ability source when objects is omitted.
  assert.deepEqual(ready.args, {});
  assert.equal(ready.targets, undefined);
  assert.equal(ready.linkedTo, undefined);

  assert.equal(might.id, MIGHT_ID);
  assert.equal(might.op, "continuous.might");
  assert.deepEqual(might.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(might.args.duration, { kind: "constant", value: "end-of-turn" });
  // "give me +1 Might this turn" refers to the ability source, so it is not a
  // target (355.10.d); the primitive registers the arithmetic-layer change on
  // itself through appliesTo (RIFT-258).
  assert.deepEqual(might.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(might.targets, undefined);
});

test("ogn-202-298 Jinx, Rebel golden: 'ready me' readies the exhausted source through the interpreter", () => {
  const initial = world()
    .unit("jinx", { might: 5, exhausted: true, location: { type: "base", player: "A" } })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("jinx") });

  const [ready] = program.abilities[0].body;
  const outcome = runAbilityBody([ready], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 1, objects: [{ id: "jinx", zoneEntryId: 1 }] }
  });
  assert.equal(kernel.getObject("jinx").exhausted, false);
});

test("ogn-202-298 Jinx, Rebel: readying an already-ready source is a no-op, not a failure (CR 416.1.b)", () => {
  const initial = world()
    .unit("jinx", { might: 5, exhausted: false, location: { type: "base", player: "A" } })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("jinx") });

  const [ready] = program.abilities[0].body;
  const outcome = runAbilityBody([ready], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    readied: { count: 0, objects: [] }
  });
  assert.equal(kernel.getObject("jinx").exhausted, false);
});

test("ogn-202-298 Jinx, Rebel golden: both halves execute through the interpreter", () => {
  const initial = world()
    .unit("jinx", { might: 5, exhausted: true, location: { type: "base", player: "A" } })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("jinx") });

  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [READY_ID, "executed"],
    [MIGHT_ID, "executed"]
  ]);
  // ready me (416): the exhausted source is readied.
  assert.equal(kernel.getObject("jinx").exhausted, false);
  // +1 [M] this turn (432/433): one arithmetic-layer registration on the
  // source with the end-of-turn lifetime (317.2.c / 468.7.c).
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.effect.filter.objectId, "jinx");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});

test.todo(
  "Jinx, Rebel: one trigger for a multi-card discard batch, and another trigger for a separate batch in the same turn " +
    "(CR 423.1.b); bind a supported card-discarded player filter and batch grouping"
);
