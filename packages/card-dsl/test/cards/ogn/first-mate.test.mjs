import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/first-mate.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: ready } = await import(new URL("effects/instructions/effect.ready.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { queryObjects } = await import(new URL("effects/interpreter/selectors.js", engineCore));
const { translateObjectFilter } = await import(new URL("programs/filters.js", engineCore));
const { createProgramBinding } = await import(new URL("programs/index.js", engineCore));
const { fixture } = await import(new URL("../test/chain/helpers.mjs", engineCore));

const CANONICAL = "card.hash-13c281a3bc1e1968da6243959de3a79839c9799f34c472de4e7356dacdbc9078";
const [playedTrigger] = program.abilities;
const readyInstruction = playedTrigger.body[0];
const targetSpec = readyInstruction.targets[0];
const forged = { ...program, status: "executable", judgeReason: undefined };

/** Run the card's ready instruction with the given locked unit refs. */
const readyUnits = (kernel, refs) =>
  runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: targetSpec.id } } },
    { world: kernel, targets: { [targetSpec.id]: refs } }
  );

test("First Mate program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /359\.3\.e\.5/);
  assert.equal(program.sourceText, "When you play me, ready another unit.");
});

test("structure: played trigger filtered to self with one other unit target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(readyInstruction.id, "first-mate.ready");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.linkedTo, undefined);
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "target", id: "first-mate.other-unit" } }
  });

  // "another unit": every board unit, excluding the source ("another"), and
  // with no controller restriction — the printed text does not say "friendly".
  assert.equal(readyInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "first-mate.other-unit",
    filter: { type: "unit", zone: "board", exclude: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("golden: the ready half readies an exhausted unit through effect.ready (CR 416.1)", () => {
  const kernel = world().unit("ally", { exhausted: true }).unit("mine", { exhausted: true }).build();
  const run = readyUnits(kernel, [kernel.ref("ally")]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.equal(kernel.getObject("mine").exhausted, true);
  assert.equal(run.linked.readied.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
});

test("golden: an already-ready unit is a no-op and stays ready (CR 416.1.b/416.1.c)", () => {
  const kernel = world().unit("ally", { exhausted: false }).build();
  const run = readyUnits(kernel, [kernel.ref("ally")]);
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("ally").exhausted, false);
});

test("golden: a stale target ref makes the instruction ignored (CR 359.3.e.7)", () => {
  const kernel = world().unit("ally", { exhausted: true }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  const run = readyUnits(kernel, [stale]);
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

test("golden: the triggered body readies the locked other unit through the real interpreter", () => {
  const base = world()
    .unit("first-mate", { exhausted: true })
    .unit("other-unit", { exhausted: true })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("first-mate") });
  kernel.setTargets(targetSpec.id, [kernel.ref("other-unit")]);

  const outcome = runAbilityBody(playedTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("other-unit").exhausted, false);
  assert.equal(kernel.getObject("first-mate").exhausted, true);
});

test("golden: the interpreter resolves exclude:'self' against the host, so 'another unit' is expressible there", () => {
  // The interpreter's selector layer does understand the anchor: with the host
  // bound, the source is subtracted and only the other unit remains. This is
  // what makes the remaining gap a binding gap, not a rules gap.
  const kernel = world()
    .unit("first-mate", { exhausted: true })
    .unit("other-unit", { exhausted: true })
    .unit("third-unit", { exhausted: true })
    .build();
  const source = kernel.getObject("first-mate");
  const bound = kernel.clone({ source: source.ref, sourceSnapshot: source });
  const environment = { context: bound, linked: () => undefined, canLookBack: () => true, isIgnored: () => false };

  assert.deepEqual(
    queryObjects(targetSpec.filter, { ...environment, host: source.ref }).map(object => object.ref.id),
    ["other-unit", "third-unit"]
  );
  // Even without an explicit host the context source stands in, so the card's
  // own body executes correctly once the targets are locked.
  assert.deepEqual(
    queryObjects(targetSpec.filter, environment).map(object => object.ref.id),
    ["other-unit", "third-unit"]
  );
});

test("current gap: the production binder rejects the exclude anchor, so the trigger never registers", () => {
  // programs/filters.ts translateObjectFilter allows a fixed key set that does
  // not include the object anchors, and programs/triggers.ts runs it over every
  // instruction target when a card program is bound.
  assert.throws(
    () => translateObjectFilter(targetSpec.filter),
    error => error instanceof Error && /Unsupported filter field exclude/.test(error.message)
  );

  const state = fixture({ cards: [{ id: "first-mate", cardId: CANONICAL, types: ["unit"], might: 3 }] });
  const errors = [];
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, error => errors.push(String(error && error.message)));
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("first-mate"), to: "board", location: { type: "base", player: "A" } });

  assert.deepEqual(errors, ["Unsupported filter field exclude"]);
  let registered = 0;
  for (const key of ["triggers", "registrations"]) if (state.engine.pipeline[key] instanceof Map) registered += state.engine.pipeline[key].size;
  assert.equal(registered, 0);
  // The same card without the anchor does register, isolating the anchor as the
  // blocker rather than the trigger shape.
  const withoutAnchor = {
    ...forged,
    abilities: [{
      ...playedTrigger,
      body: [{
        ...readyInstruction,
        targets: [{ ...targetSpec, filter: { type: "unit", zone: "board" } }]
      }]
    }]
  };
  const control = fixture({ cards: [{ id: "first-mate", cardId: CANONICAL, types: ["unit"], might: 3 }] });
  const controlErrors = [];
  createProgramBinding({ cardPrograms: [withoutAnchor] }).attachLifecycle(control.engine, error => controlErrors.push(String(error && error.message)));
  control.engine.commit({ type: "move-zone", object: control.kernel.ref("first-mate"), to: "board", location: { type: "base", player: "A" } });
  assert.deepEqual(controlErrors, []);
});

test.todo(
  "First Mate: bind \"another unit\" through the production target pipeline (355.9.b / 359.3.e.5 / 416.1) " +
    "once programs/filters.ts accepts the exclude anchor, then execute the card-played trigger end to end"
);

