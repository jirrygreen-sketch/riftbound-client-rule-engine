import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/leona-zealot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-da797609bf7c16ecdf7c10aed579c7d786c25395e580819421a8f380186df025";

/** A real chain engine so the production replacement/static binder runs. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("leona", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], energy: 3, power: [] })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

test("ogn-079-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-da797609bf7c16ecdf7c10aed579c7d786c25395e580819421a8f380186df025");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement.enter|Victory Score/);
  // Restored pre-resweep assertion /players\/scoreAtLeast|dynamic static/.
  assert.match(program.judgeReason, /players\/scoreAtLeast|dynamic static|scoreAtLeast/);
  assert.match(program.judgeReason, /applyMightMinimums|minimum/);
  assert.equal(program.sourceText, "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 :rb_might:, to a minimum of 1 :rb_might:.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Leona: ready ENTRY is a replacement with a dynamic opponent/Victory Score condition", () => {
  assert.equal(program.abilities.length, 2);
  const replacement = program.abilities[0];
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "object-enters-board", filter: { object: "self", exhausted: true } });
  assert.deepEqual(replacement.condition, { kind: "compare", left: { kind: "count", subject: "players", filter: { relation: "opponent", scoreAtLeast: { relativeTo: "victory-score", offset: -3 } } }, operator: "gte", right: { kind: "constant", value: 1 } });
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].op, "replacement.enter");
  // CR 369.3/359.2.c: the merged replacement.enter declaration shape.
  assert.deepEqual(replacement.with[0].args, { state: { kind: "constant", value: "ready" } });
  assert.equal(replacement.with[0].targets, undefined);
});

test("Leona: the state:ready replacement really rewrites the chain→board entry", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("leona");
  kernel.perform({ type: "move-zone", object: source.ref, to: "chain" });
  const chained = kernel.objects.find(object => object.ref.id === "leona");
  const ability = { ...program.abilities[0], condition: { kind: "always" } };
  const handle = createEngineStaticBinder(engine).bindReplacement(ability, chained);
  const outcome = engine.commit({ type: "move-zone", object: chained.ref, to: "base", location: { type: "base", player: "A" } });
  handle.unbind();
  assert.equal(outcome.status, "done");
  assert.equal(kernel.objects.find(object => object.ref.id === "leona").exhausted, false);
  // 359.2.c/805.6.a: entry orientation is a replacement, not a later Ready action.
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
});

test("Leona: the opponent/Victory Score condition is not a real player predicate", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("leona");
  const context = engine["context"]?.({ id: "leona.probe", controller: "A", source, kind: "triggered", speed: "normal", body: [], object: source.ref, status: "pending", targetPlans: [] });
  const condition = program.abilities[0].condition;
  assert.equal(condition.left.subject, "players");
  assert.deepEqual(condition.left.filter, {
    relation: "opponent",
    scoreAtLeast: { relativeTo: "victory-score", offset: -3 }
  });
  // The merged evaluator only counts a set; the players/score predicates are
  // not interpreted, so the condition is vacuously true even with no opponent
  // anywhere near the Victory Score.
  const environment = context === undefined
    ? { context: null, host: source.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false }
    : { context, host: source.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false };
  assert.notEqual(environment.context, null, "the production chain context must be constructible for this probe");
  assert.equal(kernel.player("B").score, 0);
  assert.equal(evaluateCondition(condition, environment), true);
});

test("Leona: the relative-opponent aura filter is still refused by the static binder", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("leona");
  const error = (() => {
    try {
      createEngineStaticBinder(engine).bindStatic(program.abilities[1], source);
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error, "the merged static binder must still refuse the aura filter while the gap is open");
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /controller:opponent filter needs a relative-player query/);
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("Leona: the merged engine still lacks per-effect minimum:1 clamping", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .unit("victim", { owner: "A", controller: "A", might: 4, stunned: true })
    .build();
  // CR 478.1.c needs the per-modification floor; the generic layer engine only
  // clamps the final total at 0, so 4 - 8 currently reads 0 rather than 1.
  const layers = createLayerEngine(kernel.objects, [{
    effect: {
      id: "leona.probe.minimum",
      layer: "arithmetic",
      source: kernel.ref("victim"),
      filter: { type: "unit", controller: "A" },
      effect: { kind: "continuous.might", mode: "add", amount: -8, minimum: 1 }
    },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  assert.equal(layers.evaluate(kernel.ref("victim")).might, 0);
});

test("Leona: permanent -8 Might applies only to stunned enemies here with printed minimum one", () => {
  const aura = program.abilities[1];
  assert.equal(aura.kind, "static");
  assert.deepEqual(aura.effect, { kind: "continuous.might", layer: "arithmetic", mode: "add", amount: { kind: "constant", value: -8 }, minimum: 1, filter: { type: "unit", zone: "board", controller: "opponent", stunned: true, sameLocationAs: "self" } });
  assert.equal(aura.condition, undefined);
  assert.equal(aura.effect.duration, undefined);
});

test.todo("Leona: entry replacement evaluates any opponent against current Victory Score at distances 3/4, including non-eight modes; never emit ready-after-entry");
test.todo("Leona: real continuous aura at Might 1/8/9/10; preserve friendly/unstunned/other-location units and expire applicability as state changes");
