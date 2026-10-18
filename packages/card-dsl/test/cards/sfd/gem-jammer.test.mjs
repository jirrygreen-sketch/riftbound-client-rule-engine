// Golden test for Gem Jammer (sfd-007-221).
//
// The card-played trigger is bound through the production CardProgram adapter
// and resolved by the real ChainEngine. The merged keyword-grant re-expander
// now consumes Ganking; production lifecycle wiring remains the card's gap.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gem-jammer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll, stages } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9";
const SOURCE_TEXT =
  "When you play me, give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [grant] = ability.body;

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveKeywords = (kernel, id) =>
  (() => {
    const layers = new KeywordGrantLayerEngine(kernel.objects, {
      context: source => bindResolveContext(kernel, { source, controller: source.controller })
    });
    for (const entry of registrations(kernel)) layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
    return layers.evaluate(kernel.ref(id));
  })()
    .keywords.map((keyword) => keyword.id);

test("sfd-007-221 Gem Jammer: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-007-221 Gem Jammer: judgeReason names the current lifecycle wiring gap", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /810/);
  assert.match(program.judgeReason, /运行时获得的 Ganking/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /production lifecycle/);
  assert.doesNotMatch(program.judgeReason, /RIFT-83|RIFT-91|RIFT-257|RIFT-258/);
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
  assert.equal(keywordDefinitionsById.get("Ganking").stacking, "single");
});

test("sfd-007-221 Gem Jammer: trigger fires when the card itself is played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(ability.trigger.condition, undefined);
});

test("sfd-007-221 Gem Jammer: body grants Ganking to exactly one unit until end of turn", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grant.id, "gem-jammer.grant-ganking");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // Contract 3.6: the affected unit is the Finalize-locked TargetSpec, not the
  // source (the primitive's default selection).
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "gem-jammer.unit" }
  });
  assert.equal(grant.targets.length, 1);
  // "a unit" (CR 355.9.a.1): any Board unit, friend or foe — no controller filter.
  assert.deepEqual(grant.targets[0], {
    id: "gem-jammer.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-007-221 Gem Jammer golden: the grant registers Ganking only on the locked unit until turn end", () => {
  const kernel = world()
    .unit("unit-1")
    .unit("unit-2", { owner: "B", controller: "B" })
    .build();
  kernel.setTargets("gem-jammer.unit", [kernel.ref("unit-2")]);

  const outcome = resolveChainBody([grant], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: keyword grants live in the ability layer; 317.1.a / 468.7.c:
  // "this turn" expires at the turn-end timing point.
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.equal(registration.effect.effect.keywordValue, undefined);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // Granting to an enemy unit is legal for "a unit" (no controller filter).
  assert.deepEqual(effectiveKeywords(kernel, "unit-2"), ["Ganking"]);
  assert.deepEqual(effectiveKeywords(kernel, "unit-1"), []);
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  for (const entry of registrations(kernel)) layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  assert.equal(layers.evaluate(kernel.ref("unit-2")).movement.canGank, true);
  assert.equal(movement(layers.registry, kernel.ref("unit-2"), layers.evaluate(kernel.ref("unit-2")), "A").canGank, true);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.deepEqual(layers.evaluate(kernel.ref("unit-2")).keywords, []);
});

test("sfd-007-221 Gem Jammer golden: a stale locked target makes the grant ignored", () => {
  const kernel = world().unit("unit-1").build();
  const stale = kernel.ref("unit-1");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("gem-jammer.unit", [stale]);

  const outcome = resolveChainBody([grant], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("sfd-007-221 Gem Jammer: the reference pipeline plays the same program shape and resolves the grant", () => {
  // The production adapter turns this program's card-played trigger into a
  // registration once the card is executable; assert the full path
  // with the card's own trigger/body over a synthetic identity, the same
  // convention as the merged trigger-registration tests.
  const playable = {
    canonicalCardId: "card:gem-jammer",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: SOURCE_TEXT,
    abilities: program.abilities
  };
  const binding = createProgramBinding({ cardPrograms: [playable] });
  const choices = [];
  const f = fixture({
    cards: [
      { id: "gem", cardId: "card:gem-jammer", types: ["unit"], energy: 2, power: [], might: 2 },
      { id: "ally", cardId: "card:ally", types: ["unit"], energy: 1, power: [], might: 2 }
    ],
    describePlay: binding.describePlay,
    choose: (request) => {
      if (request.type !== "select-objects") return undefined;
      choices.push([request.id, request.options.map((option) => option.id)]);
      const pick = request.options.find((option) => option.id === "ally");
      return pick ? [pick] : undefined;
    }
  });
  binding.attachLifecycle(f.engine);
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("ally"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  f.engine.commit({
    type: "play",
    object: f.kernel.ref("gem"),
    player: "A",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  resolveAll(f.engine);

  // The play resolves, then the card-played trigger enters the chain and the
  // grant's target is chosen at Finalize (one real target request).
  assert.deepEqual(stages(f.engine), [
    "pending:play:gem:1:A:1",
    "finalized:play:gem:1:A:1",
    "pending:trigger:1",
    "resolved:play:gem:1:A:1",
    "removed:play:gem:1:A:1",
    "finalized:trigger:1",
    "resolved:trigger:1",
    "removed:trigger:1"
  ]);
  assert.deepEqual(choices, [["target:gem-jammer.unit", ["source", "enemy", "gem", "ally"]]]);
  assert.equal(f.kernel.getObject("gem").zone, "board");
  // 810.1: the granted keyword reaches the chosen friendly unit only.
  assert.deepEqual(
    f.engine.layers.evaluate(f.kernel.ref("ally")).keywords.map((keyword) => keyword.id),
    ["Ganking"]
  );
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("gem")).keywords, []);
});
