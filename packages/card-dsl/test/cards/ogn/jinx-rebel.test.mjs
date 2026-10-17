import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jinx-rebel.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// card-dsl has no dependency edge on engine-core, so golden execution loads the
// built engine through its workspace layout instead of the package name.
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { createProgramBinding } = await import(new URL("programs/index.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));

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
  assert.match(program.judgeReason, /per-batch/);
  assert.match(program.judgeReason, /批次/);
  assert.match(program.judgeReason, /card-discarded/);
  assert.match(program.judgeReason, /batchId/);
  assert.match(program.judgeReason, /独立注册 id/);
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
  // 423.1.a: the discarding player is the Hand owner, so the ObjectFilter spelling
  // is the equivalent of "when *you* discard". EVENT_PATTERN_TYPES has no
  // card-discarded member, so the EventPattern spelling is rejected outright.
  assert.deepEqual(ability.trigger.filter, { controller: "self" });
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
  "Jinx, Rebel: a single 'discard 2' instruction must collect ONE trigger for the whole batch (CR 423.1.b); " +
    "the merged pipeline emits one card-discarded per discarded card with no batchId producer and no per-batch " +
    "TriggerSpec.once scope (events/action-adapter.ts, TRIGGER_ONCE_SCOPES)"
);

/** The real ChainEngine over the reference kernel plus the merged program binding. */
function fixture({ hand = ["h1"], amounts = [1], deck = ["d1", "d2", "d3"] } = {}) {
  const builder = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .unit("jinx", { cardId: program.canonicalCardId, types: ["unit"], might: 5, exhausted: true });
  for (const id of hand) builder.hand(id, { owner: "A" });
  for (const id of deck) builder.card(id, { owner: "A", zone: "deck" });
  const kernel = builder.build();
  const decide = (request) => {
    // Ordinary Hand choices are non-targeting (355.10.a): take the lowest legal count.
    if (request.type === "select-objects") return request.options.slice(0, request.min ?? 0);
    if (request.type === "optional") return false;
    throw new Error(`Unexpected choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  // The program registry refuses judge-required programs, so the binding is exercised
  // with the same IR under an executable status (sfd/honest-broker precedent). The
  // status itself is asserted above and is never claimed executable by this test.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = kernel.getObject("jinx");
  const ids = binding.registerProgramTriggers(engine, source);
  for (const [index, amount] of amounts.entries()) {
    engine.enqueue({
      id: `discard-${index}-${amount}`,
      kind: "triggered",
      controller: "A",
      source,
      body: [{
        id: `discard-${index}-${amount}`,
        op: "effect.discard",
        args: { amount: { kind: "constant", value: amount }, choiceId: { kind: "constant", value: `pick-${amount}` } }
      }]
    });
    engine.advance();
  }
  return { kernel, engine, ids };
}

const drain = (engine) => {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
};

test("ogn-202-298 Jinx, Rebel: the discard trigger registers through the merged program binding", () => {
  // RIFT-257's binding consumes the card's `at: "card-discarded"` subscription and the
  // equivalent ObjectFilter spelling; the raw EventPattern spelling is rejected by
  // assertTriggerSpec (card-discarded is not an EVENT_PATTERN_TYPES member).
  const { ids, kernel, engine } = fixture();
  assert.deepEqual(ids, ["program:jinx:1:0"]);
  const [registration] = [...engine.pipeline.checkpoint().triggers.values()];
  assert.equal(registration.spec.at, "card-discarded");
  assert.deepEqual(registration.spec.filter, { controller: "self" });
  assert.deepEqual(registration.activeZones, ["board"]);
  assert.equal(kernel.getObject("jinx").exhausted, true);
});

test("ogn-202-298 Jinx, Rebel golden: a real discard fires the trigger, readies me and grants +1 Might this turn", () => {
  const { kernel, engine } = fixture({ hand: ["h1", "h2"] });
  drain(engine);

  // 423.1.b: the discard really happened, and the discard timing point really fired.
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["h1"]);
  assert.equal(engine.pipeline.events.filter((event) => event.timingPoint === "card-discarded").length, 1);
  // The trigger entered the chain as its own item.
  assert.equal(engine.trace.some((entry) => entry.step === "pending" && entry.item.startsWith("trigger:")), true);
  // "ready me" (416.1.b) readied the exhausted source for real.
  assert.equal(kernel.getObject("jinx").exhausted, false);
  // "give me +1 Might this turn" (317.2.c) registered on the source for the arithmetic layer.
  const [registration] = engine.layers.registry.list();
  assert.deepEqual(registration.effect.filter.objectId, "jinx");
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});

test("ogn-202-298 Jinx, Rebel TODO: one trigger per discard batch keeps the sum of separate discards correct", {
  todo: "CR 423.1.b: group the discard GameActions into one trigger per batch; no batchId producer or per-batch once scope is merged"
}, () => {
  // Two separate one-card discards in the same turn must each trigger (two readyings / two
  // +1 Might registrations), while one two-card batch must trigger only once. The merged
  // pipeline cannot distinguish those cases; the correct expectation is asserted here and the
  // current per-card behaviour is never written as the expected result.
  // A single two-card discard must collect exactly ONE trigger. The merged pipeline queues one
  // per discarded card: the batch is really discarded, but the trigger count is wrong before any
  // resolution runs (the second body crashes on the duplicate continuous.might registration id).
  const batch = fixture({ hand: ["h1", "h2"], amounts: [2] });
  assert.deepEqual(batch.kernel.zone("A", "trash").map((ref) => ref.id), ["h1", "h2"]);
  assert.equal(batch.engine.pipeline.events.filter((event) => event.timingPoint === "card-discarded").length, 2);
  const queued = batch.engine.items.filter((item) => String(item.id).startsWith("trigger"));
  assert.equal(queued.length, 1);

  // Two separate single-card discards in the same turn must collect one trigger each.
  const separate = fixture({ hand: ["h1", "h2"], amounts: [1, 1] });
  assert.deepEqual(separate.kernel.zone("A", "trash").map((ref) => ref.id), ["h1", "h2"]);
  assert.equal(
    separate.engine.items.filter((item) => String(item.id).startsWith("trigger")).length,
    2
  );
});

test("Jinx TODO: two separate one-card discards resolve two independent Might bonuses in one turn", {
  todo: "317.2.c: repeated resolutions of the same continuous.might instruction need distinct registration ids"
}, () => {
  const { kernel, engine } = fixture({ hand: ["h1", "h2"], amounts: [1, 1] });
  drain(engine);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["h1", "h2"]);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-discarded").length, 2);
  assert.equal(engine.trace.filter(entry => entry.step === "resolved" && entry.item.startsWith("trigger:")).length, 2);
  assert.equal(engine.layers.registry.list().length, 2);
  assert.equal(engine.layers.snapshot(kernel.ref("jinx")).might, 7);
});
