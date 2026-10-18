import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/mushroom-pouch.js";
import { createProgramBinding, translateTriggerFilter, triggerRegistrations } from "../../../../engine-core/dist/programs/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture as turnFixture } from "../../../../engine-core/test/turn/helpers.mjs";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { runInstruction } = await import(new URL("effects/testing/run-instruction.js", ENGINE));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", ENGINE));

const [ability] = program.abilities;
const [drawInstruction] = ability.body;
const CARD_ID = program.canonicalCardId;

test("mushroom-pouch: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("mushroom-pouch: identity, ruleset, status and specific judgeReason", () => {
  assert.equal(program.canonicalCardId, "card.hash-689c116add3b0f95eb8a9545f336509a3e539abe5b910af8fb28caba8512f6ad");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1."
  );
  // The producer and condition fallback are merged, but neither supplies
  // the card's own-turn filter or the missing Facedown Zone scope.
  assert.match(program.judgeReason, /Facedown/);
  assert.match(program.judgeReason, /ZoneId/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /RIFT-270/);
  // Re-sweep: producing the turn player is insufficient without this filter.
  assert.match(program.judgeReason, /player: "self"/);
  assert.match(program.judgeReason, /filter: \{\}/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  // 2026-10-17 re-sweep: the reason now names the two host query adapters that
  // both fail to express "you control a facedown card at a battlefield".
  assert.match(program.judgeReason, /evaluateTriggerCondition/);
  assert.match(program.judgeReason, /matchesQueryFilter/);
  assert.match(program.judgeReason, /matchesFilter/);
  assert.match(program.judgeReason, /states/);
});

test("mushroom-pouch: one mandatory beginning-start trigger (CR 315.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("mushroom-pouch: the merged program binding registers the beginning-start trigger", () => {
  const executable = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const kernel = world()
    .unit("pouch", {
      cardId: CARD_ID,
      types: ["unit"],
      location: { type: "battlefield", id: "battlefield-1" },
      energy: 3,
      power: [],
      might: 2
    })
    .build();
  const source = kernel.getObject("pouch");
  const registrations = triggerRegistrations(binding.registry, source);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.at, "beginning-start");
  assert.deepEqual(registrations[0].spec.filter, {});
  assert.equal(registrations[0].body[0].id, "draw-1");
  assert.equal(registrations[0].optional, false);
});

test("mushroom-pouch: own-phase matching is supported but its translated event pattern still fails production binding validation", () => {
  const f = turnFixture({
    setup: builder => builder.base("pouch", {
      cardId: CARD_ID, types: ["gear"], energy: 2, power: [], might: null
    })
  });
  // Exercise binding inspection and filter translation on the original
  // judge-required program; the unresolved Facedown condition is not bypassed.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = f.kernel.getObject("pouch");
  const [boundAbility] = binding.inspect(source).abilities;
  // Probe the required player-only filter through the real translator; even
  // omitting event here cannot avoid the unsupported event spelling it adds.
  const filter = translateTriggerFilter({ player: "self" }, source.ref.id, boundAbility.trigger.at);
  assert.deepEqual(filter, { event: "beginning-start", player: "self" });
  const validation = validateTriggerSpec({ ...boundAbility.trigger, filter });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.map(issue => [issue.path, issue.code]), [
    ["trigger.filter.event", "invalid-event-type"]
  ]);
  assert.throws(
    () => f.flow.chain.pipeline.registerTrigger({
      id: "pouch-own-phase", source, controller: source.controller,
      spec: { ...boundAbility.trigger, filter }, body: boundAbility.body,
      optional: boundAbility.optional
    }),
    { name: "TriggerSpecValidationError", message: /^trigger\.filter\.event:/ }
  );
  assert.throws(
    () => triggerRegistrations(binding.registry, source),
    { name: "ProgramBindingError", code: "judge-required", message: program.judgeReason }
  );

  // Keep the gear attached through the later control change (CR 323.6).
  assert.equal(f.flow.chain.commit({ type: "attach", object: source.ref, host: f.kernel.ref("source") }).status, "done");
  f.flow.start();
  const ownBeginning = f.flow.chain.pipeline.events.find(event => event.timingPoint === "beginning-start");
  assert.ok(ownBeginning);
  assert.equal(ownBeginning.player, "A");
  assert.equal(matchesTriggerEvent(filter, ownBeginning, source.controller), true);

  // Commit a real control change, then advance through the normal turn flow.
  assert.equal(f.flow.chain.commit({ type: "take-control", object: source.ref, player: "B" }).status, "done");
  f.flow.endTurn("A");
  const beginnings = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "beginning-start");
  assert.deepEqual(beginnings.map(event => event.player), ["A", "B"]);
  const opponentBeginning = beginnings[1];
  assert.equal(matchesTriggerEvent(filter, opponentBeginning, source.controller), false);
  const current = f.kernel.getObject("pouch");
  assert.equal(current.owner, "A");
  assert.equal(current.controller, "B");
  assert.equal(matchesTriggerEvent(filter, opponentBeginning, current.controller), true);
  assert.equal(matchesTriggerEvent(filter, ownBeginning, current.controller), false);
  const otherPhase = f.flow.chain.pipeline.events.find(event => event.timingPoint === "draw-start" && event.player === "B");
  assert.ok(otherPhase);
  assert.equal(matchesTriggerEvent(filter, otherPhase, current.controller), false);
});

test("mushroom-pouch: the intervening 'if you control a facedown card' clause is a condition, not a target", () => {
  // 355.10.c: "if …" is a condition; nothing is chosen, so the trigger carries
  // no target and the instruction has no TargetSpec.
  assert.deepEqual(ability.trigger.filter, {});
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  // The facedown-card count the condition needs (107.3.a/107.3.e, 355.9.a.3).
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    controller: "controller",
    zone: "battlefield",
    states: "face-down"
  });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("mushroom-pouch: body is an unlinked Draw 1 for the ability controller", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("mushroom-pouch golden: the Draw 1 half draws one card (CR 414.3)", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    // Array form is top-to-bottom: index 0 is the deck top (CR 414.1.a).
    .deck(["top-card", "second-card"], { owner: "A" })
    .build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
});

test("mushroom-pouch: the declared facedown condition cannot be evaluated by the trigger host query", () => {
  // 2026-10-17 re-sweep measurement. events/pipeline.ts evaluates a trigger
  // condition through host.context(...).query(filter); that query belongs to the
  // host adapter, and both merged adapters mishandle this clause:
  //  - effects/testing/test-kernel.ts matchesQueryFilter only knows
  //    type/tags/controller/owner/zone/location/combatRole and returns true for
  //    every other key, so a `states` filter silently stops filtering;
  //  - apps/game-server/src/engine-runtime/host.ts matchesFilter knows only
  //    zone/type/owner/controller and compares them literally, so neither
  //    controller: "controller" nor controller: "self" resolves.
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("pouch", { cardId: CARD_ID, owner: "A", controller: "A", types: ["gear"], might: null, location: { type: "base", player: "A" } })
    .unit("facedown-here", { owner: "A", controller: "A", zone: "board", faceDown: true, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("facedown-base", { owner: "A", controller: "A", zone: "board", faceDown: true, location: { type: "base", player: "A" } })
    .build();
  const source = kernel.getObject("pouch");
  const declared = ability.trigger.condition;
  const declaredFilter = declared.left.filter;

  // The declared spelling (zone: "battlefield") is not a ZoneId at all.
  assert.deepEqual(declaredFilter, { controller: "controller", zone: "battlefield", states: "face-down" });
  assert.deepEqual(kernel.query(declaredFilter).map(object => object.ref.id), []);

  // The same unsupported keys under the trigger-condition fallback drop out of
  // the filter: `states` stops being honoured, so the *face-up* Pouch itself is
  // counted alongside both facedown cards.
  const widened = { controller: "controller", zone: "board", location: "battlefield", states: "face-down" };
  assert.deepEqual(kernel.query(widened).map(object => object.ref.id), []);
  assert.deepEqual(kernel.query({ states: "face-down" }).map(object => object.ref.id), [
    "pouch",
    "facedown-here",
    "facedown-base"
  ]);

  // Evaluating the declared condition against the host query reports false
  // even with a genuine facedown card at a battlefield.
  assert.equal(evaluateCondition(declared, {
    context: kernel, host: source.ref, linked: () => undefined, canLookBack: () => true,
    isIgnored: () => false, query: filter => kernel.query(filter)
  }), false);
});

test.todo(
  "mushroom-pouch: evaluating 'if you control a facedown card at a battlefield' needs a Facedown Zone scope (107.3.a/107.3.e: a battlefield sub-zone, not a location; ZoneId has no facedown member) plus a controller value the host query resolves — effects/testing/test-kernel.ts matchesQueryFilter ignores unknown keys such as states and apps/game-server host.matchesFilter compares controller literally."
);

test.todo(
  "mushroom-pouch: accept the translated beginning-start player:self event pattern in production trigger validation, then filter the actual card to its controller's Beginning Phase (CR 315.2.a.1)"
);
