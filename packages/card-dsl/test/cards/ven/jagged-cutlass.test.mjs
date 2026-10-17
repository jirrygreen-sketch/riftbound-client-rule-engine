import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jagged-cutlass.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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

/** Merge the printed activation into the production program -> keyword -> chain path.
 *
 * ProgramRegistry rejects judge-required card programs, so the production-path
 * probe uses the exact merged Equip expansion in an otherwise identical probe
 * program marked executable. The card itself remains judge-required and gets a
 * separate fail-closed executable-run assertion.
 */
const boundCutlass = ({ answerTargets = true } = {}) => {
  const expansion = equipActivation();
  const binding = createProgramBinding({ cardPrograms: [{
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [expansion],
    sourceText: program.sourceText
  }] });
  const f = fixture({
    cards: [{ id: "cutlass", cardId: CARD_ID, types: ["gear"], energy: 3 }],
    describePlay: binding.describePlay,
    choose: request => {
      // Tests that probe chain registration leave the Equip target pick
      // unanswered so the chain stops before the unsupported equip payment.
      if (request.type === "select-objects") {
        if (!answerTargets) throw new AwaitChoice(request);
        return [request.options[0]];
      }
    }
  });
  const errors = [];
  binding.attachLifecycle(f.engine, error => errors.push(error));
  return { ...f, binding, errors };
};

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
  assert.ok(!/RIFT-89/.test(program.judgeReason), "RIFT-89 is merged; the reason names only the current payment-kind gap");
  assert.ok(!/RIFT-87/.test(program.judgeReason), "the keyword wiring is merged");
  assert.match(program.judgeReason, /params\.cost/);
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

test("ven-073-166 golden: the merged card-program path binds the Equip activation as a chain draft", () => {
  const f = boundCutlass({ answerTargets: false });
  assert.deepEqual(f.errors, []);
  const source = f.kernel.getObject("cutlass");
  const activations = f.binding.activationAbilities(source);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].cost.payments[0].kind, "equip");
  const draft = f.binding.describeActivate(source, "A");
  assert.equal(draft.kind, "activated");
  assert.equal(draft.cost.cost.kind, "activated");
  assert.equal(draft.body[0].op, "effect.attach");
  assert.deepEqual(draft.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.throws(() => f.engine.execute(draft), AwaitChoice, "the chain stops at target selection before the unsupported equip payment");
  assert.equal(f.engine.items.length, 0, "the pending activation rolls back while the choice is open");
});

test("ven-073-166 golden: the merged Equip activation fails closed on the unpayable equip payment", () => {
  const f = boundCutlass();
  const source = f.kernel.getObject("cutlass");
  const draft = f.binding.describeActivate(source, "A");
  f.engine.commit({ type: "ready", object: f.kernel.ref("cutlass") });
  f.engine.advance();
  assert.throws(() => f.engine.execute(draft), ChainContractBlockedError);
  try { f.engine.execute(draft); } catch (error) {
    assert.ok(error instanceof ChainContractBlockedError);
    assert.equal(error.message, "Unsupported payment kind: equip");
  }
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.getObject("cutlass").exhausted, false);
  assert.deepEqual(f.kernel.query({ zone: "board" }).map(object => object.name), ["source", "enemy"]);
});

test.todo(
  "ven-073-166 Jagged Cutlass: paying the printed Equip cost (1 Body rune, CR 818.1.c/135.2.e.4) " +
    "needs the CardProgram KeywordAbility to carry a CostSpec and expandProgram to forward it through " +
    "KeywordDef.expand params.cost; Equip.ts must read that cost and cost/plan-values.ts must consume " +
    "the resulting equip payment"
);