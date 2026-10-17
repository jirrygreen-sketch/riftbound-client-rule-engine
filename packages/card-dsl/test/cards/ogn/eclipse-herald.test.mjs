import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/eclipse-herald.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-67719b3d2e3e5ab46c7824a9f7d294656d3d356fc92ad47c06b92e52e7f62fc1";
const SOURCE_TEXT =
  "When you stun an enemy unit, ready me and give me +1 :rb_might: this turn.";

const triggered = program.abilities[0];
const [readyInstruction, mightInstruction] = triggered.body;

test("ogn-059-298 Eclipse Herald: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-059-298 Eclipse Herald: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /行动责任玩家/);
  assert.match(program.judgeReason, /unit-stunned/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-059-298 Eclipse Herald: unit-stunned trigger for an enemy unit", () => {
  // 424.1/424.1.a.1: the trigger fires on the Stun event of an enemy unit; the
  // stunned unit is the event object, and "enemy" is relative to the ability
  // controller (412.4/412.5, events/pipeline-match.ts playerMatches).
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "unit-stunned");
  assert.deepEqual(triggered.trigger.filter, {
    event: "unit-stunned",
    player: "controller",
    object: { type: "unit", controller: "opponent" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.trigger.condition, undefined);
});

test("ogn-059-298 Eclipse Herald: body readies the source and describes the +1 Might", () => {
  assert.equal(triggered.body.length, 2);
  // "ready me": the default selection of effect.ready is the ability source
  // (355.10.g, 412.4) and a spec list would wrongly make it a target choice.
  assert.equal(readyInstruction.id, "eclipse-herald.ready-me");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {});
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.linkedTo, undefined);

  // "give me +1 [M] this turn": a temporary Might modification consumed by
  // the merged continuous.might instruction and layers engine.
  assert.equal(mightInstruction.id, "eclipse-herald.give-plus-1-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args, {
    amount: { kind: "constant", value: 1 },
    duration: { kind: "constant", value: "end-of-turn" },
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("ogn-059-298 Eclipse Herald golden: ready me readies this exhausted unit", () => {
  const base = world().unit("herald", { owner: "A", might: 7, exhausted: true }).build();
  const kernel = base.clone({
    source: base.ref("herald"),
    sourceSnapshot: base.getObject("herald")
  });
  const run = runInstruction(ready, readyInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("herald").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
  assert.deepEqual(run.linked.readied.objects, [{ id: "herald", zoneEntryId: 1 }]);
  assert.deepEqual(run.events.map((event) => event.action), ["ready"]);
});

test("ogn-059-298 Eclipse Herald golden: an already-ready unit is left untouched (CR 416.1.b/.c)", () => {
  const base = world().unit("herald", { owner: "A", might: 7, exhausted: false }).build();
  const kernel = base.clone({
    source: base.ref("herald"),
    sourceSnapshot: base.getObject("herald")
  });
  const run = runInstruction(ready, readyInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("herald").exhausted, false);
  // No additional "becomes ready" action is submitted for a ready object.
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test("ogn-059-298 Eclipse Herald golden: a replaced ready is negated (contract 3.6 primitive rule 2)", () => {
  const base = world().unit("herald", { owner: "A", might: 7, exhausted: true }).build();
  const kernel = base.clone({
    source: base.ref("herald"),
    sourceSnapshot: base.getObject("herald")
  });
  kernel.addReplacement(() => "replaced");
  const run = runInstruction(ready, readyInstruction.args, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.getObject("herald").exhausted, true);
  assert.equal(run.linked.readied.count, 0);
});

test("ogn-059-298 Eclipse Herald golden: a stale source reference makes ready ignored (CR 359.3.e.7)", () => {
  const base = world().unit("herald", { owner: "A", might: 7, exhausted: true }).build();
  const kernel = base.clone({
    source: base.ref("herald"),
    sourceSnapshot: base.getObject("herald")
  });
  const stale = kernel.ref("herald");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(ready, readyInstruction.args, { world: kernel });

  // The source reference is invalidated by the move; the primitive reads the
  // current source and finds no usable object.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test("ogn-059-298 Eclipse Herald golden: +1 Might applies through turn-end", () => {
  const base = world().unit("herald", { might: 7 }).build();
  const kernel = base.clone({ source: base.ref("herald"), sourceSnapshot: base.getObject("herald") });
  const outcome = runAbilityBody([mightInstruction], kernel, undefined, { host: kernel.ref("herald") });

  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine([kernel.getObject("herald")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("herald")).might, 8);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("herald")).might, 7);
});

test.todo("Eclipse Herald: propagate the Stun responsible player into unit-stunned, then exercise player-scoped triggers (CR 412.1/412.4)");

test("Eclipse Herald complete effect body gives Might even when ready is replaced", () => {
  const base = world().unit("herald", { might: 7, exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("herald") });
  kernel.addReplacement(action => action.type === "ready" ? "replaced" : null);
  const outcome = runAbilityBody(triggered.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [readyInstruction.id, "negated"], [mightInstruction.id, "executed"]
  ]);
  assert.equal(kernel.getObject("herald").exhausted, true);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.snapshot(kernel.ref("herald")).might, 8);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.snapshot(kernel.ref("herald")).might, 7);
});
