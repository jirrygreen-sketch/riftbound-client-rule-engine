import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/noxian-drummer.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// resolveChainBody is the production card-body entry point
// (chain/engine.ts resolveChainBody(item.body, context)).
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { createProgramBinding, translateTriggerFilter } = await import(new URL("programs/index.js", engineCore));
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));

const READ_ID = "noxian-drummer.read-here";
const PLAY_ID = "noxian-drummer.play-recruit";

/** A real ChainEngine so registration goes through the real pipeline validation. */
function realEngine(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error("Unexpected choice: " + request.id); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

test("ogn-222-298 Noxian Drummer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-5518503e78770284d5f2f55292d0d27dd571a336dd4bcae40fdc3ee530d2b12d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /object-moved/);
  // 2026-10-17 re-sweep: the reason now records the closed event-name
  // vocabulary as the first blocker and the missing toZone payload second.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /toZone/);
  assert.match(program.judgeReason, /requiresMoveTriggers/);
  assert.equal(
    program.sourceText,
    "When I move to a battlefield, play a 1 :rb_might: Recruit unit token here. " +
      "(It is also at the battlefield.)"
  );
});

test("ogn-222-298 Noxian Drummer: object-moved trigger with read-here then a linked Recruit play", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 449.2: a Move is defined by origin and destination;
  // 458.1 excludes Recalls from move triggers.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", objectId: "self", toZone: "battlefield" });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 2);
  const [read, play] = ability.body;
  assert.equal(read.id, READ_ID);
  assert.equal(read.op, "condition.value");
  assert.deepEqual(read.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(play.id, PLAY_ID);
  assert.equal(play.op, "effect.token");
  assert.deepEqual(play.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(play.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: a NEW token is created on the Chain and then played.
  assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(play.args.location, {
    kind: "linked-value",
    instructionId: READ_ID,
    key: "here"
  });
  assert.equal(play.linkedTo, READ_ID);
  assert.equal(play.targets, undefined);
});

test("ogn-222-298 Noxian Drummer golden: the effect body plays a 1-Might Recruit at the source battlefield", () => {
  // The trigger plumbing for "When I move to a battlefield" is judged (see the
  // todos); the body itself is executed for real with the source already at the
  // battlefield the Move delivered it to (CR 359.3.f.2 "here").
  const kernel = world()
    .unit("noxian-drummer", {
      might: 3,
      location: { type: "battlefield", id: "battlefield-4" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("noxian-drummer") });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      [READ_ID, "executed"],
      [PLAY_ID, "executed"]
    ]
  );
  assert.deepEqual(outcome.linkedValues[READ_ID + ".here"], {
    type: "battlefield",
    id: "battlefield-4"
  });

  const tokens = kernel
    .query({ zone: "board", type: "unit" })
    .filter((object) => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Recruit");
  assert.equal(tokens[0].might, 1);
  assert.deepEqual(tokens[0].location, { type: "battlefield", id: "battlefield-4" });
  assert.equal(tokens[0].controller, "A");
});

test("ogn-222-298 Noxian Drummer: the object-moved subscription is refused by the closed event-name vocabulary", () => {
  // 2026-10-17 re-sweep measurement: events/trigger-spec.ts accepts only its
  // closed EVENT_PATTERN_TYPES list, which has no object-moved entry, while
  // translateTriggerFilter keeps the declared event name as-is. The alias
  // mapping in pipeline-match.ts runs after this validation.
  const kernel = world().unit("drummer", { cardId: program.canonicalCardId, owner: "A", controller: "A", types: ["unit"], might: 3 }).build();
  const source = kernel.getObject("drummer");
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, source.ref.id, program.abilities[0].trigger.at);
  assert.deepEqual(filter, { event: "object-moved", object: { objectId: source.ref.id }, toZone: "battlefield" });
  const validation = validateTriggerSpec({ at: program.abilities[0].trigger.at, filter });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.map(issue => [issue.path, issue.code]), [
    ["trigger.filter.event", "invalid-event-type"]
  ]);
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  assert.throws(
    () => binding.registerProgramTriggers(realEngine(kernel), source),
    { name: "TriggerSpecValidationError", message: /^trigger\.filter\.event:/ }
  );
});

test("ogn-222-298 Noxian Drummer: the object-moved emission carries no toZone for the battlefield filter", () => {
  // RIFT-270 emits the timing point from events/action-adapter.ts, but that
  // emission only fills object/player/amount: toZone/toKind stay undefined, so
  // the card's toZone: "battlefield" filter can never match. turn/flow.ts also
  // re-emits object-enters-battlefield for a move-location, and that name is
  // outside the same closed vocabulary.
  const kernel = world().unit("drummer", { cardId: program.canonicalCardId, owner: "A", controller: "A", types: ["unit"], might: 3, location: { type: "base", player: "A" } }).build();
  const emissions = [];
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error("Unexpected choice: " + request.id); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const execution = host.execute({ type: "move-location", object: kernel.ref("drummer"), to: { type: "battlefield", id: "battlefield-1" } });
  assert.equal(execution.outcome.status, "done");
  assert.deepEqual(kernel.getObject("drummer").location, { type: "battlefield", id: "battlefield-1" });
  const moved = execution.emissions.find(emission => emission.timingPoint === "object-moved");
  assert.ok(moved);
  assert.equal(moved.object.ref.id, "drummer");
  assert.equal(moved.toZone, undefined);
  assert.equal(moved.details?.toLocationId, undefined);
  assert.equal(validateTriggerSpec({ at: "object-moved", filter: { event: "object-moved", objectId: "self", toZone: "battlefield" } }).ok, false);
  assert.equal(validateTriggerSpec({ at: "object-enters-battlefield", filter: { event: "object-enters-battlefield", objectId: "self" } }).ok, false);
});
