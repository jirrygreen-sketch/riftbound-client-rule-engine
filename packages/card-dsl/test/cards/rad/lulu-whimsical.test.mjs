// Golden test for Lulu, Whimsical (rad-110-167).
// The optional trigger and target are declared; the base-Might trait
// instruction, the production exclude-anchor translation and the object-moved
// trigger pattern agreement remain judged gaps (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lulu-whimsical.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-4417983f70fa69947305b0884a1562186a0299bf7532c22d71f44111a3d79438";
const SOURCE_TEXT = "When I move, you may have another unit's base Might become 4 this turn.";

const [moveTrigger] = program.abilities;
const [setBaseMight] = moveTrigger.body;
const [anotherUnit] = setBaseMight.targets;

test("rad-110-167 Lulu, Whimsical: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-110-167 Lulu, Whimsical: judgeReason identifies the temporary trait instruction and target anchor", () => {
  assert.match(program.judgeReason, /continuous\.base-might/);
  assert.match(program.judgeReason, /143\.2\.a\.1\/479\.2/);
  assert.match(program.judgeReason, /applyTrait/);
  assert.match(program.judgeReason, /exclude: source/);
  // Re-probed 2026-10-17: no registered base-Might instruction, no production
  // accept for exclude: source and no object-moved EventPattern membership.
  assert.equal(instructionDefinitionsById.has("continuous.base-might"), false);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
});

test("rad-110-167 Lulu, Whimsical: 'When I move' subscribes to object-moved for this card (421.1/449.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.once, undefined);
  assert.equal(moveTrigger.optional, true);
});

test("rad-110-167 Lulu, Whimsical: leading 'you may' is one Finalize choice (CR 383.3.a)", () => {
  assert.equal(moveTrigger.optional, true);
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(setBaseMight.id, "lulu.set-base-might");
  assert.equal(setBaseMight.linkedTo, undefined);
  assert.equal(setBaseMight.op, "continuous.base-might");
});

test("rad-110-167 Lulu, Whimsical: the instruction declares base Might 4 for this turn (143.2.a.1)", () => {
  assert.equal(setBaseMight.op, "continuous.base-might");
  assert.deepEqual(setBaseMight.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setBaseMight.args.target, {
    kind: "constant",
    value: "lulu.another-unit"
  });
  assert.equal(setBaseMight.targets.length, 1);
  assert.equal(setBaseMight.picks, undefined);
  assert.deepEqual(anotherUnit, {
    id: "lulu.another-unit",
    filter: { type: "unit", zone: "board", exclude: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-110-167 Lulu, Whimsical: a real Move already produces the source snapshot", () => {
  const f = fixture();
  const source = f.kernel.getObject("source");
  f.engine.commit({ type: "move-location", object: source.ref, to: { type: "battlefield", id: "bf-1" } });
  const events = f.engine.pipeline.events.filter(event => event.timingPoint === moveTrigger.trigger.at);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].object.ref, source.ref);
  assert.deepEqual(events[0].object.location, { type: "battlefield", id: "bf-1" });
  assert.equal(f.kernel.getObject("enemy").might, 5);
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("rad-110-167 Lulu, Whimsical boundary: production binding rejects exclude: source before registration", () => {
  // programs/filters.ts translateObjectFilter has no exclude anchor adapter,
  // so the whole trigger cannot be bound (the interpreter's queryObjects does
  // support the anchor; the production translation is the gap).
  const executable = { ...program, status: "executable", judgeReason: undefined };
  const f = fixture({ cards: [{ id: "lulu", cardId: CANONICAL, types: ["unit"], might: 2 }] });
  assert.throws(
    () => triggerRegistrations(new ProgramRegistry([executable]), f.kernel.getObject("lulu")),
    /Unsupported filter field exclude/
  );
});

test("rad-110-167 Lulu, Whimsical boundary: object-moved is not an EventPattern type", () => {
  // Even with the exclude anchor removed, the translated trigger filter would
  // name object-moved, which the closed EventPattern enum rejects.
  const modified = JSON.parse(JSON.stringify(program));
  modified.abilities[0].body[0].targets[0].filter = { type: "unit", zone: "board" };
  const f = fixture({ cards: [{ id: "lulu", cardId: CANONICAL, types: ["unit"], might: 2 }] });
  const registration = triggerRegistrations(
    new ProgramRegistry([{ ...modified, status: "executable", judgeReason: undefined }]),
    f.kernel.getObject("lulu")
  )[0];
  assert.equal(registration.spec.at, "object-moved");
  assert.deepEqual(registration.spec.filter, { event: "object-moved", object: { objectId: "lulu" } });
  assert.throws(
    () => f.engine.pipeline.registerTrigger(registration),
    error => error.name === "TriggerSpecValidationError" && /trigger\.filter\.event/.test(error.message)
  );
});

test.todo('Lulu, Whimsical: register a base-Might 4 trait-layer effect through the resolving body, expire it this turn, and preserve later arithmetic modifiers (CR 143.2.a.1/479.2).');
test.todo('Lulu, Whimsical: production binding must preserve the another-unit exclude anchor and accept the object-moved EventPattern before the optional trigger can Finalize.');
