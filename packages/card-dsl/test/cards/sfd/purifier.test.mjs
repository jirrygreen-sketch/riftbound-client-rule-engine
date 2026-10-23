// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Purifier, and the merged keyword-grant half. The whole-card execution evidence
// (its own scenario through the generic card harness plus the measured outcome of
// binding its own static ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the merged KeywordGrantLayerEngine can expand
// the granted Assault in isolation, but production lifecycle wiring and the
// 718.3 Attached-card propagation bridge are still absent.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/purifier.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";

const CANONICAL_ID = "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5";
const SOURCE_TEXT =
  "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)";
const [grant] = program.abilities;

test("sfd-183-221 Purifier: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL_ID), program);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-183-221 Purifier: one static ability granting a keyword to your Equipment on the Board", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  // 807.1 / 807.1.a: Assault is granted through a characteristic-changing
  // continuous effect, never a chain item.
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Assault");
  // 807.1.b.3: the printed Assault has no value, so none is declared.
  assert.equal(grant.effect.keywordValue, undefined);
  assert.equal(grant.effect.value, undefined);
  // 818.1.a / 718.5.a: "Equipment" is a Gear tag; 190.6.d: "your" is the
  // ability controller.
  assert.deepEqual(grant.effect.filter, { zone: "board", controller: "controller", tags: ["Equipment"] });
  assert.equal(grant.condition, undefined);
});

test("sfd-183-221 Purifier: the granted keyword id is the merged Assault definition", () => {
  const definition = keywordDefinitionsById.get(grant.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition.keyword, "Assault");
  // 807.2: valued, and multiple Assaults on one unit sum.
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  assert.ok(definition.ruleRefs.includes("807.1.c"));
});

test("sfd-183-221 Purifier: the production binder grants Assault to your Equipment only", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .object("purifier", { cardId: CANONICAL_ID, types: ["legend"], zone: "board", might: null })
    .object("blade", { owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"], zone: "board" })
    .object("enemy-blade", { owner: "B", controller: "B", types: ["gear"], tags: ["Equipment"], zone: "board" })
    .object("rig", { owner: "A", controller: "A", types: ["gear"], tags: [], zone: "board" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static binding must not ask for a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const liveSource = kernel.getObject("purifier");
  const handle = createEngineStaticBinder(engine).bindStatic(grant, liveSource);
  const mine = kernel.getObject("blade");
  const theirs = kernel.getObject("enemy-blade");
  const plain = kernel.getObject("rig");
  engine.layers.setObjects(kernel.objects);
  // 818.1.a / 718.5.a: only your Equipment-tagged Gear qualifies.
  assert.deepEqual(engine.layers.snapshot(mine.ref).keywords.map(keyword => keyword.id), ["Assault"]);
  assert.deepEqual(engine.layers.snapshot(theirs.ref).keywords, []);
  assert.deepEqual(engine.layers.snapshot(plain.ref).keywords, []);
  handle.unbind();
  assert.deepEqual(engine.layers.snapshot(mine.ref).keywords, []);
});

test("sfd-183-221 Purifier: the merged keyword layer expands the granted Assault", () => {
  const kernel = world()
    .unit("purifier", { owner: "A", controller: "A", zone: "board", might: null })
    .unit("blade", {
      owner: "A", controller: "A", zone: "board", types: ["gear"], tags: ["Equipment"],
      might: 3, combatRole: "attacker"
    })
    .unit("enemy-blade", { owner: "B", controller: "B", zone: "board", types: ["gear"], tags: ["Equipment"], might: 3, combatRole: "attacker" })
    .build();
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  layers.addContinuous({
    id: "purifier.grant",
    layer: "ability",
    source: kernel.ref("purifier"),
    filter: { zone: "board", controller: "A", tags: ["Equipment"] },
    effect: { kind: "continuous.grant-keyword", keyword: "Assault" }
  }, { type: "permanent" });
  const blade = layers.evaluate(kernel.ref("blade"));
  assert.deepEqual(blade.keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(blade.might, 4);
  assert.deepEqual(layers.evaluate(kernel.ref("enemy-blade")).keywords, []);
  assert.equal(layers.evaluate(kernel.ref("enemy-blade")).might, 3);
});

test("sfd-183-221 Purifier: judgeReason names the measured propagation gaps", () => {
  // Re-probed 2026-10-18 (RIFT-667): the standalone re-expander now reads the
  // granted Assault, while production lifecycle and attachment propagation remain.
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /effects\/keywords\/Assault\.ts/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /718\.3/);
});

test.todo(
  "sfd-183-221 Purifier: 718.3 propagation of the granted Assault from the attached card to its equipped unit " +
    "- no executable bridge exists; production lifecycle also does not feed granted keywords into the re-expander"
);
