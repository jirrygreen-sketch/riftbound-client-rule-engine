// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/hunters-machete.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { createProgramBinding } = await import(new URL("programs/index.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/index.js", ENGINE));

const CANONICAL_ID =
  "card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d";
const SOURCE_TEXT =
  "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)";

const [equip] = program.abilities;

test("unl-096-219 Hunter's Machete: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-096-219 Hunter's Machete: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The judgeReason must name the real pipeline rejection, not a vague placeholder.
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /plan-values/);
  assert.match(program.judgeReason, /CostPlanError/);
  assert.match(program.judgeReason, /818\.1\.c/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-257/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-096-219 Hunter's Machete: one valued Body Equip declaration, nothing re-expanded in the card", () => {
  assert.equal(program.abilities.length, 1);
  // 150.3 / 818.1.a: Equip on a Gear with the Equipment tag; the card only
  // declares keyword identity, printed value and cost domain (contract 3.7).
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
  // 818.1.c: the printed cost is one Body rune symbol; no energy component.
  assert.equal(equip.energy, undefined);
});

test("unl-096-219 Hunter's Machete: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL_ID } });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  // 818.1.b / 818.1.b.1 / 818.1.c.2: "[Cost]: Attach this gear to a unit you control."
  const [activation] = expansion;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.deepEqual(activation.cost.payments.map(payment => payment.kind), ["equip"]);
  assert.deepEqual(activation.body.map(step => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  assert.deepEqual(activation.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("unl-096-219 Hunter's Machete: the printed Equip payment remains an explicit keyword cost", () => {
  const definition = keywordDefinitionsById.get("Equip");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(activation.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
});

test("unl-096-219 Hunter's Machete golden: the merged Equip body attaches the Gear once the target is locked", () => {
  // 818.2 / 818.2.a: the attach action itself is merged and executable; only the
  // activation cost above blocks the end-to-end activation. The golden supplies
  // the target the Finalize target system would lock (355.8 / 355.9). The
  // reference kernel's filter vocabulary compares controller placeholders
  // verbatim, so the TargetSpec is dropped from the execution copy (the
  // pit-rookie / one-two-punch convention) while the card's own TargetSpec is
  // asserted separately above.
  const kernel = world()
    .unit("hunters-machete", {
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A"
    })
    .unit("ally", { types: ["unit"], might: 2, controller: "A", owner: "A" })
    .build();
  const definition = keywordDefinitionsById.get("Equip");
  const [activation] = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL_ID } });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("hunters-machete") });
  context.setTargets("equip-target", [kernel.ref("ally")]);

  const executableBody = activation.body.map(({ targets, ...rest }) => rest);
  const outcome = resolveChainBody(executableBody, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["equip-attach", "executed"]
  ]);
  // resolveChainBody mutates the world it is handed, so assertions read the same
  // context (the finalize-locked target and source come from that clone).
  assert.deepEqual(context.events.map(event => event.action), ["attach"]);
  const gear = context.getObject("hunters-machete");
  assert.equal(gear.attachedTo?.id, "ally");
});

test("unl-096-219 Hunter's Machete: the merged program binding describes the 818.1.c activation as an action-speed attach", () => {
  // 818.1.b / 818.1.b.2 / 818.1.c.2: the printed Equip is an activated ability that
  // attaches the Gear; programs/activate.ts builds that activation from the card's
  // own expansion. The card program is fed as an executable copy because the
  // registry guard (ProgramRegistry.get) refuses judge-required programs.
  const kernel = world()
    .object("gear", {
      cardId: CANONICAL_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
    })
    .unit("ally", { might: 2 })
    .build();
  const source = kernel.getObject("gear");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });

  const draft = binding.describeActivate(source, "A");
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.body.map(step => step.op), ["effect.attach"]);
  assert.deepEqual(draft.body[0].targets, [{
    id: "equip-target",
    // 818.1.b.2 / contract 3.6: the card's relative "you control" stays the
    // symbolic "self" selector; programs/filters.ts is what resolves it against
    // the ability controller at Finalize.
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  // 818.1.c: the activation's cost is the printed Equip payment, not the Gear's
  // 3 Energy play cost. The declared component is carried through unchanged.
  assert.deepEqual(draft.cost.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
});

test("unl-096-219 Hunter's Machete: the production activation cost still fails closed on the equip payment kind", () => {
  // 818.1.c / 818.1.c.3: paying the printed cost is part of the activation, so the
  // real cost planner must be able to price it. cost/plan-values.ts reads the
  // payments array and blocks the unknown kind, which is why this card stays
  // judge-required instead of approximating Equip as a bare effect.attach.
  const kernel = world()
    .object("gear", {
      cardId: CANONICAL_ID,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
    })
    .unit("ally", { might: 2 })
    .build();
  const source = kernel.getObject("gear");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const draft = binding.describeActivate(source, "A");
  const context = kernel.clone({ sourceSnapshot: source });

  assert.throws(
    () => buildCostPlan(context, { id: "cost:hunters-machete", cost: draft.cost.cost }),
    error => {
      assert.equal(error.name, "CostPlanError");
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
  // 150.4 / 818.1.c: the printed 3 Energy play cost and the null Power are untouched;
  // the card's own Equip declaration still carries the printed Body rune.
  assert.equal(kernel.getObject("gear").energy, 3);
  assert.equal(kernel.getObject("gear").power, null);
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
});

test("unl-096-219 Hunter's Machete: the merged Equip expansion declares no parameters, so the printed rune has no path in", () => {
  // Contract 3.8 item 3 wants the printed Equip cost carried through params.cost;
  // effects/keywords/Equip.ts declares a zero-arity expand, so the card's value and
  // costDomain cannot reach the payment it produces.
  const definition = keywordDefinitionsById.get("Equip");
  assert.equal(definition.expand.length, 0);
  const [activation] = definition.expand({
    value: equip.value,
    costDomain: equip.costDomain,
    host: { canonicalCardId: CANONICAL_ID }
  });
  assert.deepEqual(activation.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  // The printed Body rune is neither dropped nor turned into an Energy amount.
  assert.equal(activation.cost.payments[0].value.value.kind, "source");
});

test.todo(
  "unl-096-219 Hunter's Machete: pay the printed Body Equip cost end to end (CR 818.1.c.3) once " +
    "cost/plan-values.ts understands the equip payment kind and Equip.expand consumes params.cost (contract 3.8 item 3)"
);
