// Golden test for Herald of the Emperor (rad-118-167).
// The play trigger and the target selection are fixed; the printed Base Might
// set has no Trait-Altering primitive (see judgeReason). The arithmetic set is
// executed separately as a contrast, never as this card's semantics.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/herald-of-the-emperor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-f31c457784f7a2bda7271b96edb7702e948e7047187f0226e77144f06ba40ce1";
const SOURCE_TEXT = "When you play me, choose a friendly unit. Its base Might becomes 5 this turn.";

const [playTrigger] = program.abilities;
const [setBaseMight] = playTrigger.body;
const [friendlyUnit] = setBaseMight.targets;

test("rad-118-167 Herald of the Emperor: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-118-167 Herald of the Emperor: judgeReason names the Trait-Altering gap", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /479\.2/);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /set-property\(might\)/);
  // Second-sweep refresh: name the concrete absent op and the rejected argument.
  assert.match(program.judgeReason, /continuous\.base-might/);
  assert.match(program.judgeReason, /instructionDefinitionsById/);
  assert.match(program.judgeReason, /argsSchema/);
});

test("rad-118-167 Herald of the Emperor: the base-Might instruction is registered and uses the trait layer", () => {
  // The registered base-Might instruction writes the Trait-Altering layer;
  // the arithmetic op still correctly rejects an explicit layer argument.
  assert.equal(instructionDefinitionsById.has("continuous.base-might"), true);
  assert.equal(instructionDefinitionsById.has("continuous.trait"), false);
  assert.throws(
    () => might.argsSchema.parse({
      objects: { kind: "constant", value: { kind: "target", id: "herald.friendly-unit" } },
      amount: { kind: "constant", value: 5 },
      layer: { kind: "constant", value: "trait" },
      duration: { kind: "constant", value: "this-turn" }
    }),
    /Invalid continuous\.might argument: layer/
  );
});

test("rad-118-167 Herald of the Emperor gap: the Trait-Altering consumer exists but no card instruction binds to it", () => {
  // The layer machinery itself is merged: a trait-layer set-property(might)
  // really sets Base Might and honors an end-of-turn duration. The production
  // static binder also registers trait-layer specs — what is missing is the
  // card-facing instruction, which this program cannot reach without a
  // registered op (see the previous test).
  const f = fixture({ cards: [{ id: "src", cardId: CANONICAL, types: ["unit"], might: 3, zone: "board" }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("src"), to: "board" });
  const binder = createEngineStaticBinder(f.engine);
  const base = f.kernel.getObject("src");
  binder.bindStatic({
    kind: "static",
    effect: {
      kind: "set-property",
      layer: "trait",
      property: "might",
      value: { kind: "constant", value: 5 },
      appliesTo: "self"
    }
  }, base);
  const [registered] = f.engine.layers.registry.list();
  assert.equal(registered.effect.layer, "trait");
  assert.equal(registered.effect.effect.kind, "set-property");

  // The trait layer honors a "this turn" duration (479.2 / 317.2.c): the value
  // applies while active and reverts at turn end, exactly what the card needs.
  const layers = createLayerEngine(f.kernel.objects, [{ effect: registered.effect, duration: { type: "end-of-turn" }, timestamp: 1 }]);
  assert.equal(layers.evaluate(f.kernel.ref("src")).might, 5);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(f.kernel.ref("src")).might, 3);
});

test("rad-118-167 Herald of the Emperor: 'When you play me' is the self-scoped card-played trigger (383.4.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { self: true });
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.optional, false);
});

test("rad-118-167 Herald of the Emperor: the body sets the chosen friendly unit's base Might to 5 this turn (143.2.a.1)", () => {
  assert.equal(playTrigger.body.length, 1);
  assert.equal(setBaseMight.id, "herald.set-base-might");
  assert.equal(setBaseMight.op, "continuous.base-might");
  assert.deepEqual(setBaseMight.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setBaseMight.args.target, {
    kind: "constant",
    value: "herald.friendly-unit"
  });
  assert.equal(setBaseMight.picks, undefined);
  assert.equal(setBaseMight.linkedTo, undefined);
});

test("rad-118-167 Herald of the Emperor: 'choose a friendly unit' is a single friendly-unit target (355.5/355.9.b)", () => {
  assert.equal(setBaseMight.targets.length, 1);
  assert.deepEqual(friendlyUnit, {
    id: "herald.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-118-167 Herald of the Emperor contrast: the merged arithmetic set-Might op is a different layer (479.2 vs 479.4)", () => {
  // The card needs the Trait-Altering layer; the merged continuous.might op
  // registers layer "arithmetic" for both add and set. Running the arithmetic
  // set makes the difference explicit instead of pretending the card is done:
  // the printed "base Might becomes 5" is NOT this effect.
  const base = world()
    .unit("herald", { owner: "A", controller: "A", might: 3 })
    .unit("ally", { owner: "A", controller: "A", might: 2 })
    .build();
  const kernel = base.clone({
    sourceSnapshot: base.getObject("herald"),
    targets: new Map([["herald.friendly-unit", [base.ref("ally")]]])
  });
  const body = [
    {
      id: "herald.arithmetic-contrast",
      op: "continuous.might",
      args: {
        mode: { kind: "constant", value: "set" },
        objects: { kind: "constant", value: { kind: "target", id: "herald.friendly-unit" } },
        amount: { kind: "constant", value: 5 },
        duration: { kind: "constant", value: "this-turn" }
      }
    }
  ];

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 479.4 arithmetic layer, not the 479.2 Trait-Altering Base Might the card
  // actually changes — which is exactly why the card stays judge-required.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "set-might");
  assert.equal(registration.effect.effect.value, 5);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, [{ ...registration, timestamp: 1 }]);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 5);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 2);
});

test.todo(
  "rad-118-167 Herald of the Emperor: 'its base Might becomes 5 this turn' needs a Trait-Altering " +
    "layer instruction primitive (CR 479.2 Base Might / 143.2.a.1) registered in " +
    "effects/instructions plus a static-program layer mapping — the trait layer itself is merged, " +
    "but continuous.might only registers the arithmetic layer (479.4) and rejects a layer argument"
);
test.todo(
  "rad-118-167 Herald of the Emperor: once Base Might has a Trait-Altering primitive, execute the card-played " +
    "TriggerRegistration through the chain and assert the chosen friendly unit's base Might is 5 until turn end (383.4.a.2)"
);
