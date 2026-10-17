import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/undertitan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-722d071685a6b301064e318e0f8ac8683e616a934d89658bf00fb0fedca48f5a";
const [playTrigger, revealReplacement] = program.abilities;
const [mightInstruction] = playTrigger.body;
const [addInstruction] = revealReplacement.with;

// Card filters spell the ability controller "self"; the reference kernel matches
// filter values literally, so the production matcher is driven with the resolved
// controller, exactly as chain/engine.ts resolves it (normalized controller).
const controllerQuery = (kernel, controller) => (filter) => kernel.objects.filter((object) => matchesObjectFilter(
  Object.fromEntries(Object.entries(filter).map(([key, value]) => [
    key,
    key === "controller" || key === "owner" ? (value === "self" ? controller : value) : value
  ])),
  object
));

test("sfd-175-221 Undertitan: program validates, is registered and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /135\.2\.b\.6/);
  assert.match(program.judgeReason, /deck/);
  assert.equal(
    program.sourceText,
    "When you play me, give your other units +2 :rb_might: this turn.\n" +
      "As I'm revealed from your deck, [Add] :rb_energy_2:."
  );
});

test("sfd-175-221 Undertitan: play trigger declares a temporary Might grant on other friendly units", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(mightInstruction.id, "undertitan.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.10.d: "your other units" is a characteristic-based set, not a target
  // choice; 355.9.c: "other" excludes the source through the contract 3.6 anchor.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { zone: "board", type: "unit", controller: "self", exclude: "self" }
    }
  });
  assert.equal(mightInstruction.targets, undefined);
});

test("sfd-175-221 Undertitan: the reveal clause is a replacement adding 2 Energy", () => {
  // 135.2.b.6 uses this exact clause as its example of text that is not an
  // instruction; 369.1 names Undertitan as the reveal replacement example.
  assert.equal(revealReplacement.kind, "replacement");
  assert.deepEqual(revealReplacement.replaces, {
    event: "card-revealed",
    filter: { source: "self", zone: "deck" }
  });
  assert.equal(addInstruction.id, "undertitan.add-energy-2");
  assert.equal(addInstruction.op, "effect.resources");
  assert.deepEqual(addInstruction.args.energy, { kind: "constant", value: 2 });
  assert.deepEqual(addInstruction.args.linkKey, { kind: "constant", value: "resources" });
  assert.equal(addInstruction.linkedTo, undefined);
});

test("sfd-175-221 Undertitan golden: the card's own Might instruction gives +2 only to other friendly units", () => {
  const kernel = world()
    .player("A")
    .unit("undertitan", { might: 5, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 3, controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy", { might: 3, controller: "B", owner: "B", location: { type: "base", player: "B" } })
    .build();
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("undertitan"),
    sourceSnapshot: kernel.getObject("undertitan"),
    query: controllerQuery(kernel, "A")
  });

  const outcome = resolveChainBody([mightInstruction], bound);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["undertitan.grant-might.affected.count"], 1);
  assert.deepEqual(outcome.linkedValues["undertitan.grant-might.affected.objects"], [kernel.ref("ally")]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 143.2.a / 475-478: the +2 lives in the arithmetic layer, never as a Buff.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.effect.filter.objectId, "ally");
  // 317.1.a / 468.7.c: "this turn" expires at end of turn.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("undertitan")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 3);
  // No Buff counter is placed anywhere (702).
  assert.equal(kernel.getObject("ally").buffs, 0);
  // The lifetime is real: expiring at turn end removes the +2.
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 3);
});

test("sfd-175-221 Undertitan golden: with no other friendly unit the Might grant is a skipped negation", () => {
  const kernel = world()
    .player("A")
    .unit("undertitan", { might: 5, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { might: 3, controller: "B", owner: "B", location: { type: "base", player: "B" } })
    .build();
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("undertitan"),
    sourceSnapshot: kernel.getObject("undertitan"),
    query: controllerQuery(kernel, "A")
  });
  const outcome = resolveChainBody([mightInstruction], bound);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.continuousEffects.length, 0);
});

test("sfd-175-221 Undertitan golden: the merged replacement binding adds the 2 Energy for the card's own clause", () => {
  // The card's replaces/with data drives the merged replacement binding.
  const kernel = world()
    .player("A")
    .object("undertitan", { cardId: CANONICAL, types: ["unit"], zone: "deck", owner: "A", controller: "A" })
    .object("other", { types: ["unit"], zone: "deck", owner: "A", controller: "A" })
    .build();
  const decide = () => { throw new Error("unexpected choice"); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: () => true
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const ref = kernel.ref("undertitan");
  bindReplacement(
    { replaces: revealReplacement.replaces, with: [addInstruction] },
    ref,
    {
      host: {
        object: (value) => kernel.object(value),
        objects: () => kernel.objects,
        context: (source, controller) => bindResolveContext(kernel, { source, controller })
      },
      pipeline
    }
  );

  // 369.1 / 370.1.b.1: the reveal event is replaced by reveal + adding 2 Energy.
  const outcome = pipeline.commit({ type: "reveal", object: ref });
  // The reveal action itself is impossible for this reference kernel (nothing
  // views it), so only the replacement's energy gain is observable here.
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(["replaced", "done"].includes(outcome.status), true);
});

test("sfd-175-221 Undertitan: the merged Add primitive puts the 2 Energy in the Rune Pool", () => {
  // 430.1 / 166.1: adding Energy puts it into the controller's Rune Pool.
  const kernel = world().player("A").build();
  const run = runInstruction(
    resources,
    { energy: { kind: "constant", value: 2 }, linkKey: { kind: "constant", value: "resources" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 2, power: [] });
  assert.equal(kernel.player("A").energy, 2);
});

test("sfd-175-221 Undertitan: the Add body executes through the interpreter with explicit source context", () => {
  const kernel = world()
    .player("A")
    .unit("undertitan", { zone: "board", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("undertitan") });
  const outcome = resolveChainBody([addInstruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.player("A").energy, 2);
});

test.todo(
  "sfd-175-221 Undertitan: discover a deck-hosted CardProgram replacement before its reveal action; " +
    "the replacement matcher, body and default binder already execute once bound."
);
