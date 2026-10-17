import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/irresistible-faefolk.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { EVENT_PATTERN_TYPES, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-bd638db89dd40b1e7a4af53d4b6502145b269d568f69478b4f5e9f979e6a89c3";
const SOURCE_TEXT =
  "When I move to a battlefield, you may move an enemy unit to that battlefield.";

const HERE = { type: "battlefield", id: "battlefield-1" };
const THERE = { type: "battlefield", id: "battlefield-2" };

const [ability] = program.abilities;
const [moveOption] = ability.body;
const [moveEnemy] = moveOption.args.body.value;

/** Execute the unchanged optional body through real target Finalize and Resolve. */
function resolveOriginalBody({ accept = true, relocateSource = false, leaveSource = false } = {}) {
  const f = fixture({ cards: [{ id: "irresistible-faefolk", cardId: CANONICAL_ID, types: ["unit"], might: 1 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("irresistible-faefolk"), to: "battlefield", location: HERE });
  f.engine.commit({ type: "move-location", object: f.kernel.ref("enemy"), to: THERE });
  const source = f.kernel.getObject("irresistible-faefolk");
  f.answers.set(`target:${moveOption.targets[0].id}`, [f.kernel.ref("enemy")]);
  f.answers.set(`${moveOption.id}/optional`, accept);
  // Only the supported body is enqueued: the full program retains its
  // judge-required guard for the unavailable Move event and Destination gate.
  f.engine.enqueue({ id: "faefolk-body", controller: "A", source, kind: "triggered", speed: "normal", body: ability.body });
  f.engine.advance();
  if (relocateSource) f.engine.commit({ type: "move-location", object: source.ref, to: THERE });
  if (leaveSource) f.engine.commit({ type: "kill", object: source.ref });
  f.engine.advance();
  const beforeResolution = f.kernel.events.length;
  resolveAll(f.engine);
  return { ...f, events: f.kernel.events.slice(beforeResolution) };
}

test("unl-112-219 Irresistible Faefolk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-112-219 Irresistible Faefolk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /449\.2/);
  assert.match(program.judgeReason, /action-adapter/);
  // The program binding is merged, so the reason must name the closed event
  // vocabulary/payload and the retained destination anchor.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /fromKind|toLocationId/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90|RIFT-91|RIFT-120|RIFT-257|RIFT-270/);
  // The reason must name the live translator/schema rejections, not a placeholder.
  assert.match(program.judgeReason, /translateTriggerFilter|movedToBattlefield/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-112-219 Irresistible Faefolk: 'When I move to a battlefield' keeps the Destination gate as a placeholder", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  // 449.2: the Destination kind must be a Battlefield; the event payload is not
  // populated, so `movedToBattlefield` records the gap (volibear-imposing's
  // movedToOtherThanSourceLocation is the documented precedent).
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { object: "self", movedToBattlefield: true }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("unl-112-219 Irresistible Faefolk: 'you may' wraps the move in choice.optional (contract 3.9)", () => {
  assert.equal(ability.optional, true);
  assert.equal(moveOption.id, "irresistible-faefolk.move-opt");
  assert.equal(moveOption.op, "choice.optional");
  assert.deepEqual(moveOption.args.prompt, {
    kind: "constant",
    value: "Move an enemy unit to that battlefield?"
  });
  assert.equal(moveOption.linkedTo, undefined);
  assert.equal(moveOption.args.body.value.length, 1);
  assert.equal(moveEnemy.linkedTo, undefined);
});

test("unl-112-219 Irresistible Faefolk: the destination uses the captured trigger source location", () => {
  assert.equal(moveEnemy.id, "irresistible-faefolk.move-enemy");
  assert.equal(moveEnemy.op, "effect.move");
  assert.deepEqual(moveEnemy.args.objects, {
    kind: "constant",
    value: { target: "irresistible-faefolk.enemy-unit" }
  });
  // CR 359.3.f.3: the source snapshot is captured when the trigger happens.
  assert.deepEqual(moveEnemy.args.to, { kind: "location", value: "source-location" });
  assert.deepEqual(moveEnemy.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveEnemy.args.mode, undefined);
  assert.equal(moveOption.targets.length, 1);
  const [spec] = moveOption.targets;
  assert.equal(spec.id, "irresistible-faefolk.enemy-unit");
  // 355.5 / 355.7: the enemy unit is chosen by the ability's controller, so it
  // is a target; "an enemy unit" carries no location restriction of its own.
  assert.deepEqual(spec.filter, { type: "unit", zone: "board", controller: "opponent" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("unl-112-219 Irresistible Faefolk: refusing the optional control instruction returns negated/skipped", () => {
  const kernel = world()
    .unit("irresistible-faefolk", { controller: "A", location: HERE })
    .unit("enemy-unit", { owner: "B", controller: "B", location: THERE })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("irresistible-faefolk") });
  context.setTargets("irresistible-faefolk.enemy-unit", [kernel.ref("enemy-unit")]);
  context.setAnswers({ "irresistible-faefolk.move-opt/optional": false });
  // This preserves the pre-existing primitive result check. Target lifecycle
  // is verified separately through the original body in ChainEngine below.
  const { targets, ...optionalControl } = moveOption;
  const outcome = runAbilityBody([optionalControl], context);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(context.events, []);
  assert.deepEqual(context.getObject("enemy-unit").location, THERE);
});

test("unl-112-219 Irresistible Faefolk golden: declining moves nothing", () => {
  const f = resolveOriginalBody({ accept: false });
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.kernel.getObject("enemy").location, THERE);
  assert.equal(f.engine.trace.filter(entry => entry.step === "resolved").length, 1);
});

test("unl-112-219 Irresistible Faefolk: the declared destination is a symbolic location expression", () => {
  assert.deepEqual(moveEnemy.args.to, { kind: "location", value: "source-location" });
  assert.equal(typeof move.argsSchema.parse, "function");
});

test("unl-112-219 Irresistible Faefolk golden: the original optional body locks the enemy and moves it to the captured battlefield", () => {
  const f = resolveOriginalBody();
  assert.deepEqual(f.kernel.getObject("enemy").location, HERE);
  assert.deepEqual(f.events.map(event => event.action), ["move-location"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 1);
  assert.equal(f.engine.trace.filter(entry => entry.step === "resolved").length, 1);
});

test("unl-112-219 Irresistible Faefolk golden: later source movement or departure cannot change 'that battlefield' (359.3.f.3)", () => {
  for (const options of [{ relocateSource: true }, { leaveSource: true }]) {
    const f = resolveOriginalBody(options);
    assert.deepEqual(f.kernel.getObject("enemy").location, HERE);
    assert.deepEqual(f.events.map(event => event.action), ["move-location"]);
  }
});

test("unl-112-219 Irresistible Faefolk golden: the original move subinstruction returns its actual movement receipt", () => {
  const kernel = world()
    .unit("irresistible-faefolk", { controller: "A", location: HERE })
    .unit("enemy-unit", { owner: "B", controller: "B", location: THERE })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("irresistible-faefolk") });
  context.setTargets("irresistible-faefolk.enemy-unit", [kernel.ref("enemy-unit")]);
  const outcome = resolveChainBody([moveEnemy], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["irresistible-faefolk.move-enemy", "executed"]
  ]);
  assert.deepEqual(outcome.linkedValues["irresistible-faefolk.move-enemy.moved"].movements, [
    { object: kernel.ref("enemy-unit"), from: THERE, to: HERE }
  ]);
  assert.deepEqual(context.getObject("enemy-unit").location, HERE);
});

test("unl-112-219 Irresistible Faefolk: object-moved exists as a timing point but is outside the EventPattern vocabulary", () => {
  // 421.1 / 449.2: object-moved is a closed timing point, yet the closed
  // EventPattern vocabulary has no such spelling, so the production registration
  // rejects the subscription before the Destination could ever be tested.
  assert.equal(isTimingPointId("object-moved"), true);
  assert.equal(EVENT_PATTERN_TYPES.includes("object-moved"), false);
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "faefolk", "object-moved"),
    error => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /Unsupported filter field movedToBattlefield/);
      return true;
    }
  );
  const result = validateTriggerSpec({ at: "object-moved", filter: { event: "object-moved" } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(issue => issue.code), ["invalid-event-type"]);
});

test.todo(
  "unl-112-219 Irresistible Faefolk: populate the object-moved payload (fromKind / toKind / fromLocationId / toLocationId) and match 'to a battlefield' against the Destination (449.2) — the action adapter omits those fields and the closed EVENT_PATTERN_TYPES has no object-moved spelling"
);
test.todo(
  "unl-112-219 Irresistible Faefolk: register the object-moved triggered ability in production after the event payload and EventPattern vocabulary accept the Destination gate; the body already resolves the {object: \"self\"} anchor"
);
