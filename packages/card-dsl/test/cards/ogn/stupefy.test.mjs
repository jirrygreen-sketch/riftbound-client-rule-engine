import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

import stupefy from "../../../dist/cards/ogn/stupefy.js";

const [speed, play] = stupefy.abilities;
const [debuff, drawInstruction] = play.body;

const registrations = (kernel) => kernel.continuousEffects.map((entry, index) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: index + 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

function debuffWorld(might) {
  const kernel = world()
    .unit("target-unit", { owner: "B", controller: "B", might, zone: "board" })
    .deck(["top-card", "bottom-card"], { owner: "A" })
    .build();
  kernel.setTargets("unit", [kernel.ref("target-unit")]);
  return kernel;
}

test("Stupefy program is structurally valid and executable", () => {
  const result = validateCardProgram(stupefy);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(stupefy.status, "executable");
  assert.equal(stupefy.judgeReason, undefined);
  assert.equal(
    stupefy.canonicalCardId,
    "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf"
  );
  assert.equal(stupefy.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.match(stupefy.sourceText, /minimum of 1/);
  assert.equal(cardRegistryById.get(stupefy.canonicalCardId), stupefy);
});

test("Stupefy ability structure: [Reaction] keyword + debuff target + unlinked draw", () => {
  assert.equal(stupefy.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["debuff", "draw"]
  );

  // "Give a unit -1 Might this turn": exactly one target (any one unit).
  assert.equal(debuff.targets.length, 1);
  assert.equal(debuff.targets[0].id, "unit");
  assert.equal(debuff.targets[0].selection, "one");
  assert.equal(debuff.targets[0].filter.type, "unit");
  // The printed -1 with the "minimum of 1" clamp is carried into the merged
  // continuous.might primitive, which snapshots it per 479.4.b.
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "literal", value: -1 });
  assert.deepEqual(debuff.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(debuff.args.minimum, { kind: "literal", value: 1 });
  assert.deepEqual(debuff.args.objects, {
    kind: "literal",
    value: { kind: "target", id: "unit" }
  });

  // "Draw 1." is NOT linked to the debuff: under 359.2.c ("as much as
  // possible") the draw still happens when the debuff cannot (e.g. the only
  // unit already has 1 Might).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "literal", value: 1 });
});

test("Stupefy golden: the debuff registers -1 Might this turn on the locked unit and Draw 1 resolves", () => {
  const kernel = debuffWorld(4);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["debuff", "executed"], ["draw", "executed"]]
  );
  // 478 / 478.1.a: Might modifications live in the arithmetic layer, applied by
  // ctx.addContinuous with the printed minimum snapshotted (479.4.b).
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -1);
  assert.equal(registration.effect.effect.minimum, 1);
  assert.deepEqual(registration.effect.filter.objectId, "target-unit");
  // 317.1.a / 468.7.c: "this turn" is an end-of-turn duration.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  assert.equal(effectiveMight(kernel, "target-unit"), 3);
  // The independent "Draw 1." really drew from the top of the deck (414.1.a).
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
});

test("Stupefy golden: the printed minimum of 1 is snapshotted, not the layer engine's 0 floor", () => {
  // 479.4.b: a 1-Might unit given "-1 to a minimum of 1" receives a 0-Might
  // modification and stays at 1; the generic arithmetic pass would floor at 0.
  const kernel = debuffWorld(1);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 0);
  assert.equal(kernel.continuousEffects[0].effect.effect.minimum, 1);
  assert.equal(effectiveMight(kernel, "target-unit"), 1);
  // The debuff did not negate the independent draw (359.2.c).
  assert.equal(kernel.player("A").handSize, 1);
});

test("Stupefy golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = debuffWorld(4);
  resolveChainBody(play.body, kernel);
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 3);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 4);
});

test("Stupefy golden: a target that left the Board is ignored and Draw 1 still resolves (359.3.e.6)", () => {
  const kernel = debuffWorld(4);
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("unit", [stale]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status, result.result.reason ?? null]),
    [["debuff", "ignored", "mistargeted"], ["draw", "executed", null]]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.player("A").handSize, 1);
});
