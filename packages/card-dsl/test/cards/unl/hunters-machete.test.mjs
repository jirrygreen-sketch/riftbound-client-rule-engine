import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/hunters-machete.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

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

test.todo(
  "unl-096-219 Hunter's Machete: wire the card program through keyword expansion into the activation/chain path " +
    "with a dedicated Equip payment kind so the 818.1.b.2 top-most attach can be exercised end to end"
);
