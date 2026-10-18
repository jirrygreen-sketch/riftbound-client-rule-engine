// Golden test for Dune Drake (ogn-131-298).
//
// Execution evidence for the supported half of this card's printed ability (the
// authored +2 Might body through the production chain adapter plus the layer
// engine, its end-of-turn expiry and its no-eligible-host boundary) lives in the
// RIFT-705 parameterized template golden:
// test/cards/templates/triggered-attack-declared-continuous-mig-705.test.mjs.
// The card stays judge-required: the 383.2.a.1 trigger condition
// ("if there is a ready enemy unit here") cannot be satisfied on the merged
// evaluation paths, and attack-declared still has no producer (CR 466.2).
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/dune-drake.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";

const CANONICAL = "card.hash-129e18f9d31400f8fce66c0a8cb60d4ca43ce586a107ec18cb24bee9d79e81d9";
const BATTLEFIELD = id => ({ type: "battlefield", id });
const [attackTrigger] = program.abilities;
const grantInstruction = attackTrigger.body[0];
const c = value => ({ kind: "constant", value });

test("Dune Drake program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /466\.2\.c/);
  assert.equal(
    program.sourceText,
    "When I attack, give me +2 :rb_might: this turn if there is a ready enemy unit here."
  );
});

test("structure: attack trigger filtered to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.trigger.once, undefined);
});

test("structure: the 'if there is a ready enemy unit here' clause is the Trigger Condition", () => {
  // CR 383.2.a.1: a conditional statement immediately after the Condition is
  // part of the Trigger Condition, not the effect — so it lives on the trigger,
  // as a count of ready enemy units at the source's location.
  assert.deepEqual(attackTrigger.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "ready-enemy-units-here",
      filter: {
        type: "unit",
        controller: "opponent",
        states: "ready",
        sameLocationAs: "source"
      }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("structure: body grants +2 Might for this turn through the layers contract shape", () => {
  assert.equal(attackTrigger.body.length, 1);
  assert.equal(grantInstruction.id, "dune-drake.grant-might");
  assert.equal(grantInstruction.op, "continuous.might");
  assert.deepEqual(grantInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the host, not a chosen target (CR 355.10.d): the symbolic
  // selector "self" is used, never a fabricated TargetSpec or ObjectRef.
  assert.deepEqual(grantInstruction.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantInstruction.targets, undefined);
  assert.equal(grantInstruction.picks, undefined);
  assert.equal(grantInstruction.linkedTo, undefined);
});

test("golden: the +2 Might grant registers and expires at turn-end", () => {
  const base = world().unit("drake", { might: 5 }).build();
  const kernel = base.clone({ source: base.ref("drake"), sourceSnapshot: base.getObject("drake") });
  const outcome = runAbilityBody([grantInstruction], kernel, undefined, { host: kernel.ref("drake") });

  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine([kernel.getObject("drake")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("drake")).might, 7);
  assert.equal(layers.advance({ id: "turn-end" }).length, 1);
  assert.equal(layers.evaluate(kernel.ref("drake")).might, 5);
});

test("current gap 1: the merged query paths disagree on the relative player anchor, so the condition never holds", () => {
  // The card's filter says controller:"opponent". interpreter/selectors.ts
  // compares controller/owner as plain scalars, so "opponent" never equals a
  // real id; layers/filter.ts instead treats it as "not the owner". The
  // production ChainEngine goes through the layer matcher and additionally
  // widens "opponent" to "any" before excluding the controller.
  const filter = attackTrigger.trigger.condition.left.filter;
  assert.equal(filter.controller, "opponent");
  // The production translator rejects the location anchor outright, so the card
  // program cannot even be bound as written.
  assert.throws(
    () => translateObjectFilter(filter),
    error => error instanceof Error && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  // Stripping the anchor to get past the translator changes the meaning: the
  // relative player then still never matches, so the condition stays false.
  assert.deepEqual(translateObjectFilter({ type: "unit", controller: "opponent", states: "ready" }), {
    type: "unit",
    controller: "opponent",
    states: "ready"
  });

  const kernel = world()
    .unit("drake", { might: 5, owner: "A", controller: "A", location: BATTLEFIELD("bf1") })
    .unit("enemy-ready", { owner: "B", controller: "B", might: 2, location: BATTLEFIELD("bf1"), exhausted: false })
    .unit("enemy-far", { owner: "B", controller: "B", might: 2, location: { type: "base", player: "B" }, exhausted: false })
    .build();
  assert.equal(kernel.query({ type: "unit", controller: "opponent", states: "ready" }).length, 0);
  // The layer matcher resolves "opponent" against the candidate object itself
  // (selectorMatches compares the value to object.controller and passes
  // object.controller as the owner), so an opponent filter can never match any
  // object - it also drops the sameLocationAs anchor entirely.
  const enemyReady = kernel.getObject("enemy-ready");
  const enemyFar = kernel.getObject("enemy-far");
  assert.equal(matchesObjectFilter({ type: "unit", controller: "opponent", states: "ready" }, enemyReady), false);
  assert.equal(matchesObjectFilter({ type: "unit", controller: "opponent", states: "ready" }, enemyFar), false);
  // An absolute id works, and both enemies match it because the location anchor
  // is not part of the matcher's field list at all.
  assert.equal(matchesObjectFilter({ type: "unit", controller: "B", states: "ready" }, enemyReady), true);
  assert.equal(matchesObjectFilter({ type: "unit", controller: "B", states: "ready" }, enemyFar), true, "the location anchor is dropped by the layer matcher");

  // Evaluating the whole condition through the interpreter is therefore false
  // in every arrangement: the relative-player spelling can never match.
  const source = kernel.getObject("drake");
  const bound = kernel.clone({ source: source.ref, sourceSnapshot: source, controller: "A" });
  const evaluate = (condition) => {
    const outcome = runAbilityBody(
      [{ id: "probe-condition", op: "condition.predicate", args: { condition: c(condition) } }],
      bound
    );
    assert.equal(outcome.results[0].result.status, "executed");
    return outcome.linkedValues["probe-condition.value"];
  };
  assert.equal(
    evaluate(attackTrigger.trigger.condition),
    false,
    "1 ready enemy at the source location must satisfy the condition but does not"
  );

  // Control: switching the anchor to an absolute player id makes the same
  // arrangement satisfy the condition, which isolates the gap to the relative
  // player spelling rather than to states/sameLocationAs handling.
  const absolute = {
    kind: "compare",
    left: { kind: "count", subject: "ready-enemy-units-here", filter: { type: "unit", controller: "B", states: "ready", sameLocationAs: "source" } },
    operator: "gte",
    right: c(1)
  };
  assert.equal(evaluate(absolute), true);
});

test("current gap 2: combat cannot designate an Attacker, so attack-declared is never produced", () => {
  // 466.2.c: the Attacker/Defender designation is part of the combat start
  // transaction. That transaction still throws, so 383.4.e's Attack Trigger has
  // no real inciting event.
  const f = fixture({});
  const flow = new CombatFlow(f.engine, f.engine.pipeline.host, [{ id: "bf", controller: null }], () => {});
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("source"), to: "board", location: BATTLEFIELD("bf") }).status, "done");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("enemy"), to: "board", location: BATTLEFIELD("bf") }).status, "done");
  assert.equal(flow.entered(f.host.objects().find(object => object.ref.id === "source")).length, 1);
  assert.equal(flow.cleanup(), true);
  assert.throws(() => flow.advance(), error => error.code === "combat-start-transaction" && /466\.2/.test(error.message));
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "attack-declared").length, 0);
});

test("current gap evidence: the trigger does register, but with no producer it can never fire", () => {
  // The registration itself is fine (the filter uses the object-objectId
  // spelling), so the open work is the combat transaction and the condition,
  // not trigger plumbing.
  const forged = { ...program, status: "executable", judgeReason: undefined };
  const state = fixture({ cards: [{ id: "drake", cardId: CANONICAL, types: ["unit"], might: 5 }] });
  const errors = [];
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, error => errors.push(String(error && error.message)));
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("drake"), to: "board", location: { type: "base", player: "A" } });
  assert.deepEqual(errors, []);
  let registered = 0;
  for (const key of ["triggers", "registrations"]) if (state.engine.pipeline[key] instanceof Map) registered += state.engine.pipeline[key].size;
  assert.equal(registered, 1);
});

test("RIFT-705: the template layer runs the card's own mutation-model path", () => {
  // The authored body is a temporary Might modification, so it belongs to the
  // arithmetic layer, registers exactly one continuous effect for the host and
  // expires at the end of the turn. Nothing here mints a Buff counter.
  const base = world().unit("drake", { might: 5, owner: "A", controller: "A", location: BATTLEFIELD("bf1") }).build();
  const kernel = base.clone({ source: base.ref("drake"), sourceSnapshot: base.getObject("drake") });
  const outcome = runAbilityBody([grantInstruction], kernel, undefined, { host: kernel.ref("drake") });
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const registered = kernel.continuousEffects[0].effect.effect;
  assert.equal(registered.kind, "continuous.might");
  assert.equal(registered.amount, 2);
  assert.equal(kernel.continuousEffects[0].effect.layer, "arithmetic");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1,
  })));
  assert.equal(layers.evaluate(kernel.ref("drake")).might, 7);
  assert.equal(layers.evaluate(kernel.ref("drake")).buffs, 0, "a Might modification is not a Buff counter (702-704)");
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("drake")).might, 5, "the +2 expires at the end of the turn (317.1.a)");
});

test.todo(
  "Dune Drake: resolve the ready-enemy-here condition with the relative player anchor inside the real " +
    "attack-declared flow (CR 383.2.a.1 / 383.4.e / 466.2.c) once the combat role transaction emits " +
    "attack-declared and the relative player plus location anchors agree across the query paths"
);

