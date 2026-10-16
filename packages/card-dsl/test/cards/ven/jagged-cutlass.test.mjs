import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jagged-cutlass.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-2c2d2ea79ffc4ad60c612406b6e615a62c4219ad076ec64e1c6d09747c71e39e";
const SOURCE_TEXT = "Equip :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)";

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

const equipActivation = () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CARD_ID } });
  return activation;
};

const cutlassWorld = () => world()
  .unit("jagged-cutlass", {
    types: ["gear"],
    tags: ["Equipment"],
    might: 2,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .unit("ally", { might: 3 })
  .build();

test("ven-073-166 Jagged Cutlass: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-073-166 Jagged Cutlass: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the real gap: the equip payment kind rejected by the cost plan.
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-073-166 Jagged Cutlass: one Equip keyword declaration carrying the printed Body rune", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip :rb_rune_body:": one resource symbol (one Body Power rune).
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
});

test("ven-073-166 Jagged Cutlass: the merged Equip expansion attaches this Gear to a controlled unit", () => {
  const activation = equipActivation();
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "expanded structure probe",
    abilities: [activation],
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues, null, 2));
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.deepEqual(activation.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target on a unit you control.
  assert.deepEqual(activation.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  const kernel = cutlassWorld();
  const bound = kernel.clone({
    source: kernel.ref("jagged-cutlass"),
    sourceSnapshot: kernel.getObject("jagged-cutlass")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  const [attachResult] = outcome.results;
  assert.equal(attachResult.op, "effect.attach");
  assert.equal(attachResult.result.status, "executed");
  assert.deepEqual(attachResult.result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("jagged-cutlass")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("jagged-cutlass").attachedTo, bound.ref("ally"));
});

test("ven-073-166 Jagged Cutlass: a unit you do not control is not redirected, it is rejected", () => {
  const activation = equipActivation();
  const kernel = cutlassWorld();
  kernel.addObject({
    ...kernel.getObject("ally"),
    ref: { id: "enemy", zoneEntryId: 1 },
    owner: "B",
    controller: "B"
  }, "board");
  const bound = kernel.clone({
    source: kernel.ref("jagged-cutlass"),
    sourceSnapshot: kernel.getObject("jagged-cutlass")
  });
  bound.setTargets("equip-target", [bound.ref("enemy")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(bound.getObject("jagged-cutlass").attachedTo, null);
});

test("ven-073-166 Jagged Cutlass: the Equip expansion carries the printed cost as an equip payment", () => {
  // 818.1.c: the printed Equip cost (one Body rune, no Energy symbol) reaches the
  // activation as the equip payment kind; this is structure, not a claim that the
  // merged cost pipeline can settle that kind yet (see judgeReason and test.todo).
  const activation = equipActivation();
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.equal(activation.cost.energy, undefined);
  assert.equal(activation.cost.power, undefined);
});

test.todo(
  "ven-073-166 Jagged Cutlass: paying the printed Equip cost (1 Body rune, CR 818.1.c/135.2.e.4) needs the " +
    "\"equip\" cost-payment kind in cost/plan-values.ts (RIFT-89 cost-payment batch) and contract 3.8.3 params.cost so the " +
    "printed rune reaches KeywordDef.expand"
);
test.todo(
  "ven-073-166 Jagged Cutlass: the card-program -> keyword expansion -> chain wiring from contract 3.5 must register the " +
    "Equip activated ability before the whole card is executable"
);
