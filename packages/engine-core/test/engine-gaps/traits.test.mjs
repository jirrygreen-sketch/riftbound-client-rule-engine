import assert from "node:assert/strict";
import test from "node:test";

import ivernFriendToAll from "../../../card-dsl/dist/cards/unl/ivern-friend-to-all.js";
import { createLayerEngine } from "../../dist/layers/index.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import addTag from "../../src/effects/instructions/continuous.add-tag.ts";
import { runInstruction, world } from "../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });

function engineFor(kernel) {
  return createLayerEngine(kernel.objects, kernel.continuousEffects);
}

test("continuous.add-tag is registered through the default production assembly for Ivern's raw IR", () => {
  const kernel = withSource(world().unit("ivern", {
    cardId: ivernFriendToAll.canonicalCardId,
    tags: ["Ivern", "Ionia", "Champion"],
    energy: null,
    power: null,
  }).build(), "ivern");
  const branch = ivernFriendToAll.abilities[0].body[0].args.modes.value[0].body;

  const output = resolveChainBody(branch, kernel);
  assert.equal(output.status, "executed");
  assert.equal(output.results[0].op, "continuous.add-tag");
  assert.equal(output.results[0].result.status, "executed");
  assert.equal(ivernFriendToAll.status, "judge-required");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "trait");
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "add-tag");

  const effective = engineFor(kernel).evaluate(kernel.ref("ivern"));
  assert.ok(effective.tags.includes("Bird"));
  assert.equal(effective.energy, null);
  assert.equal(effective.power, null);
});

test("trait registrations expire at the declared boundary and do not follow a new zone entry", () => {
  const kernel = withSource(world().unit("ivern").build(), "ivern");
  const run = runInstruction(addTag, {
    tag: literal("Bird"),
    layer: literal("trait"),
    object: literal("self"),
    duration: literal("this-turn"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");

  const engine = engineFor(kernel);
  assert.ok(engine.evaluate(kernel.ref("ivern")).tags.includes("Bird"));
  assert.deepEqual(engine.advance({ id: "turn-end" }), [kernel.continuousEffects[0].effect.id]);
  assert.equal(engine.evaluate(kernel.ref("ivern")).tags.includes("Bird"), false);

  const permanent = withSource(world().unit("ivern").build(), "ivern");
  runInstruction(addTag, { tag: literal("Cat"), layer: literal("trait"), object: literal("self") }, { world: permanent });
  const old = permanent.ref("ivern");
  const oldEngine = engineFor(permanent);
  assert.ok(oldEngine.evaluate(old).tags.includes("Cat"));
  assert.equal(permanent.perform({ type: "return-to-hand", object: old }).status, "done");
  assert.equal(permanent.perform({
    type: "move-zone",
    object: permanent.ref("ivern"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" },
  }).status, "done");
  oldEngine.setObjects(permanent.objects);
  assert.equal(oldEngine.evaluate(permanent.ref("ivern")).tags.includes("Cat"), false);
});

test("invalid trait layer and malformed duration are rejected before registration", () => {
  const kernel = withSource(world().unit("ivern").build(), "ivern");
  assert.throws(() => runInstruction(addTag, {
    tag: literal("Bird"), layer: literal("ability"), object: literal("self"),
  }, { world: kernel }), /layer.*trait/);
  assert.equal(kernel.continuousEffects.length, 0);

  assert.throws(() => runInstruction(addTag, {
    tag: literal("Bird"), layer: literal("trait"), object: literal("self"), duration: literal("not-a-duration"),
  }, { world: kernel }), /duration/);
  assert.equal(kernel.continuousEffects.length, 0);
});

test("stale objects are ignored and a required choice rolls back until answered", () => {
  const staleWorld = withSource(world().unit("ivern").build(), "ivern");
  const stale = staleWorld.ref("ivern");
  assert.equal(staleWorld.perform({ type: "return-to-hand", object: stale }).status, "done");
  const ignored = runInstruction(addTag, {
    tag: literal("Poro"), layer: literal("trait"), object: literal("self"),
  }, { world: staleWorld });
  assert.deepEqual(ignored.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(staleWorld.continuousEffects.length, 0);

  const choiceWorld = withSource(world().unit("ivern").unit("ally").build(), "ivern");
  const descriptor = { kind: "choose", id: "ivern-tag-target", filter: { type: "unit" }, min: 1, max: 1 };
  const asked = runInstruction(addTag, {
    tag: literal("Dog"), layer: literal("trait"), object: literal(descriptor),
  }, { world: choiceWorld });
  assert.ok(asked.asked);
  assert.equal(choiceWorld.continuousEffects.length, 0);

  const answered = runInstruction(addTag, {
    tag: literal("Dog"), layer: literal("trait"), object: literal(descriptor),
  }, { world: choiceWorld, answers: { "ivern-tag-target": [choiceWorld.ref("ivern")] } });
  assert.equal(answered.result.status, "executed");
  assert.equal(choiceWorld.continuousEffects.length, 1);

  const badAnswerWorld = withSource(world().unit("ivern").unit("ally").build(), "ivern");
  const badRef = { id: "missing", zoneEntryId: 1 };
  assert.throws(() => runInstruction(addTag, {
    tag: literal("Poro"), layer: literal("trait"), object: literal(descriptor),
  }, { world: badAnswerWorld, answers: { "ivern-tag-target": [badRef] } }), /choice answer/);
  assert.equal(badAnswerWorld.continuousEffects.length, 0);
});

