// RIFT-648 template execution evidence: ../templates/empty-648.test.mjs.
// The template rows play this Gear through the real chain and assert the
// printed-cost, target-restriction and Equip-payment boundaries; this file
// keeps validation, identity, the keyword structure and the merged
// effect.attach slice.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/hexdrinker.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146";
const SOURCE_TEXT =
  "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)";

// The Equip target filter is `controller: "self"`; the production matcher
// (layers/filter.ts) reads player selectors, so bind it and resolve "self" to
// the ability controller, exactly like the target pipeline does.
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

const equipActivation = () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({
    value: program.abilities[0].value,
    host: { canonicalCardId: CARD_ID }
  });
  return activation;
};

test("sfd-102-221 Hexdrinker: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-102-221 Hexdrinker: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the real gaps, not a generic "not implemented".
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /describeActivate 能给出草稿/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261|RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-102-221 Hexdrinker: one Equip keyword declaration carrying the printed Body Power rune", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip [Body]": one resource symbol, the Body Power rune; the
  // card-level 2 Energy play cost is not the Equip cost.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
});

test("sfd-102-221 Hexdrinker: the merged Equip body attaches this gear to the chosen controlled unit", () => {
  const activation = equipActivation();
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [activation],
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues, null, 2));

  const kernel = world()
    .unit("hexdrinker", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 3 })
    .build();
  // The activation host is the live gear instance; bind the resolver source to
  // it so effect.attach reads the real source reference.
  const bound = kernel.clone({
    source: kernel.ref("hexdrinker"),
    sourceSnapshot: kernel.getObject("hexdrinker")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  const [attachResult] = outcome.results;
  assert.equal(attachResult.op, "effect.attach");
  assert.equal(attachResult.result.status, "executed");
  assert.deepEqual(attachResult.result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("hexdrinker")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("hexdrinker").attachedTo, bound.ref("ally"));
});

test("sfd-102-221 Hexdrinker: the merged expansion's cost placeholder is what Finalize cannot pay yet", () => {
  // The merged Equip expansion is the real effect.attach slice (executed
  // above); its generic cost placeholder is the exact gap the judgeReason
  // names, recorded here through the real cost-plan entry point.
  const activation = equipActivation();
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .object("hexdrinker", {
      owner: "A",
      cardId: CARD_ID,
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 2,
      power: []
    })
    .unit("ally", { might: 3 })
    .build();
  const bound = kernel.clone({
    source: kernel.ref("hexdrinker"),
    sourceSnapshot: kernel.getObject("hexdrinker")
  });

  assert.throws(
    () => buildCostPlan(bound, { id: "cost:hexdrinker-equip", cost: activation.cost }),
    (error) => {
      assert.equal(error.reason, "judge-required");
      assert.match(String(error.message), /Unsupported payment kind: equip/);
      return true;
    }
  );
  // Nothing was charged or attached by the refused plan.
  assert.equal(bound.getObject("hexdrinker").attachedTo, null);
  assert.equal(bound.getObject("hexdrinker").exhausted, false);
});

test.todo(
  "sfd-102-221 Hexdrinker: charge the printed Equip cost (1 Body Power, CR 818.1.c) at Finalize once the " +
    "\"equip\" cost-payment kind exists in cost/plan-values.ts and contract 3.8.3 params.cost is delivered to " +
    "KeywordDef.expand by programs/keywords.ts"
);

test("sfd-102-221 Hexdrinker boundary: the card-program binding describes the activation but the Equip cost still cannot be planned", () => {
  // The production activate path: the ability listing and the draft both work,
  // and the printed cost is the blocker, not the description surface.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .object("hexdrinker", {
      owner: "A",
      cardId: CARD_ID,
      types: ["gear"],
      tags: ["Equipment"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 2,
      power: null
    })
    .unit("ally", { might: 3 })
    .build();
  const source = kernel.getObject("hexdrinker");
  assert.equal(binding.activationAbilities(source).length, 1);

  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.cost.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  assert.throws(
    () => buildCostPlan(kernel.clone({ sourceSnapshot: source }), draft.cost),
    (error) => {
      assert.equal(error.reason, "judge-required");
      assert.match(String(error.message), /Unsupported payment kind: equip/);
      return true;
    }
  );
  // Nothing was charged or attached by the refused plan.
  assert.equal(kernel.getObject("hexdrinker").attachedTo, null);
  assert.equal(kernel.getObject("hexdrinker").exhausted, false);
  assert.equal(kernel.player("A").energy, 20);
});

test("sfd-102-221 Hexdrinker boundary: the printed Body rune never reaches the merged expansion", () => {
  // programs/keywords.ts expandProgram passes only value/host, so the printed
  // domain cannot appear in the expansion even though the card records it.
  const definition = keywordDefinitionsById.get("Equip");
  assert.equal(JSON.stringify(definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } })).includes("Body"), false);
  assert.equal(program.abilities[0].costDomain, "Body");
});
