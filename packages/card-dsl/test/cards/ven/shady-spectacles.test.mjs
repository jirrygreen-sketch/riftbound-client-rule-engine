import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shady-spectacles.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-0b22da1f55c97313d8b71cfe7bc85b5b13ccca85dda9b92eea0b197fde0ed543";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Attach this to a unit you control.)\n" +
  "As this is attached to a unit, choose another friendly unit. " +
  "The equipped unit becomes a copy of that unit for as long as this is attached to it.";

const [equip] = program.abilities;

/** The reference kernel compares filter fields literally; bind the symbolic "self" controller. */
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

const spectaclesWorld = () => world()
  .unit("shady-spectacles", {
    types: ["gear"],
    tags: ["Equipment"],
    might: 0,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .unit("equipped-unit", { might: 2 })
  .unit("other-friendly", { might: 5 })
  .build();

test("ven-137-166 Shady Spectacles: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-137-166 Shady Spectacles: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /copy-layer-traits-exceptions-and-attachment-duration-unavailable/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-137-166 Shady Spectacles: one Equip declaration carrying the printed 1 Energy + Order rune", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip :rb_energy_1::rb_rune_order:": two resource symbols
  // (1 Energy + 1 Order Power); the card-level 4 Energy play cost is not this cost.
  assert.equal(equip.value, 2);
  assert.equal(equip.costDomain, "Order");
  // The card-local copy sentence is a copy-layer effect (446/479.1); the card layer
  // does not hand-write a settlement for it and does not invent an IR declaration.
  assert.equal(program.abilities.some((ability) => ability.kind !== "keyword"), false);
});

test("ven-137-166 Shady Spectacles: the merged Equip expansion attaches the Gear to a controlled unit", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "expanded structure probe",
    abilities: [activation],
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues, null, 2));
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target on a unit you control.
  assert.deepEqual(activation.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  const kernel = spectaclesWorld();
  const bound = kernel.clone({
    source: kernel.ref("shady-spectacles"),
    sourceSnapshot: kernel.getObject("shady-spectacles")
  });
  bound.setTargets("equip-target", [bound.ref("equipped-unit")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("shady-spectacles")],
    host: bound.ref("equipped-unit")
  });
  assert.deepEqual(bound.getObject("shady-spectacles").attachedTo, bound.ref("equipped-unit"));
});

test("ven-137-166 Shady Spectacles: the copied sentence has no card-local instruction and is never faked", () => {
  // 479.1.d / 446.2: the copy effect is applied in the Copy Effects layer. No merged
  // consumer turns a CardProgram declaration into that layer effect, so the card
  // declares none and the gap is recorded instead of being approximated.
  assert.equal(program.abilities.length, 1);
  assert.equal(program.abilities[0].kind, "keyword");
  assert.equal(program.abilities[0].keyword, "equip");
});

test("ven-137-166 Shady Spectacles: the Equip expansion declares the printed cost as an equip payment", () => {
  // Structure only: the printed cost (1 Energy + 1 Order Power) reaches the
  // activation as the equip payment kind, which the cost pipeline cannot settle
  // yet (see judgeReason and test.todo).
  const definition = keywordDefinitionsById.get("Equip");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
});

test.todo(
  "ven-137-166 Shady Spectacles: paying the printed Equip cost (1 Energy + 1 Order Power, CR 818.1.c/135.2.e.4) needs the " +
    "\"equip\" cost-payment kind in cost/plan-values.ts (RIFT-89 cost-payment batch) and contract 3.8.3 params.cost so the " +
    "printed runes reach KeywordDef.expand"
);
test.todo(
  "ven-137-166 Shady Spectacles: \"As this is attached to a unit, choose another friendly unit\" needs an attachment-driven " +
    "selection (355.5) — the IR has no \"on attach, choose another unit\" declaration form and nested targets are blocked by " +
    "chain/engine.ts assertFinalizationSurface"
);
test.todo(
  "ven-137-166 Shady Spectacles: \"The equipped unit becomes a copy of that unit for as long as this is attached to it\" " +
    "(CR 446.1/446.2/446.4.a/479.1/479.1.d) needs the copy layer's trait copy plus an attachment-bound lifetime and an " +
    "attachment-driven registration (RIFT-91); effect.copy mode \"effect\" stays blocked today"
);
test("ven-137-166 Shady Spectacles binding: Equip expands into an activated ChainDraft with its target and cost", () => {
  const kernel = world().unit("shady-spectacles", {
    cardId: CARD_ID, types: ["gear"], tags: ["Equipment"], might: 0
  }).build();
  // Inspect the merged binding separately from the unsupported copy ability and Equip payment.
  // This local projection is only a draft inspection, never an executable full-card settlement.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const source = kernel.getObject("shady-spectacles");
  const [activation] = binding.activationAbilities(source);
  const draft = binding.describeActivate(source, "A");

  assert.equal(activation.kind, "activated");
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.equal(draft.controller, "A");
  assert.deepEqual(draft.source, source);
  assert.deepEqual(draft.body, activation.body);
  assert.deepEqual(draft.body[0].targets, [{
    id: "equip-target", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one"
  }]);
  assert.deepEqual(draft.cost.cost, activation.cost);
  assert.deepEqual(draft.cost.cost.payments.map(payment => payment.kind), ["equip"]);
});
