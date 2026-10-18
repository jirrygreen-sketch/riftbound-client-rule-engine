// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import pettyOfficer from "../../../dist/cards/ogn/petty-officer.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL =
  "card.hash-2daf12389f3f2209c75815321b3f70aaadfe8d1f9e8cc4b3dd747c93c0f780dc";
const HOST = { canonicalCardId: CANONICAL };

function boundAssault(combatRole) {
  const kernel = world().unit("petty-officer", {
    cardId: CANONICAL, might: 5, combatRole
  }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: chain => {
      chain.layers.setObjects(kernel.objects);
      const lethal = chain.layers.evaluateAll().filter(object =>
        object.zone === "board" && object.types.includes("unit") &&
        object.might !== null && (object.might <= 0 || object.damage >= object.might)
      );
      for (const object of lethal) chain.commit({ type: "kill", object: object.ref });
      return lethal.length > 0;
    }
  });
  const source = kernel.getObject("petty-officer");
  // inspect expands the original judge-required program without bypassing its
  // production status guard; only the resulting static ability is bound here.
  const binding = createProgramBinding({ cardPrograms: [pettyOfficer] });
  const ability = binding.inspect(source).abilities.find(item => item.kind === "static");
  assert.ok(ability);
  const handle = createEngineStaticBinder(engine).bindStatic(ability, source);
  return { kernel, engine, source, handle };
}

test("ogn-215-298 Petty Officer: program passes validateCardProgram", () => {
  const result = validateCardProgram(pettyOfficer);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-215-298 Petty Officer: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(pettyOfficer.canonicalCardId, CANONICAL);
  assert.equal(pettyOfficer.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(pettyOfficer.status, "judge-required");
  assert.match(pettyOfficer.judgeReason, /Assault/);
  assert.match(pettyOfficer.judgeReason, /designation/);
  assert.match(pettyOfficer.judgeReason, /combatRole/);
  assert.match(pettyOfficer.judgeReason, /compare/);
  assert.match(pettyOfficer.judgeReason, /evaluateCondition/);
  assert.match(pettyOfficer.judgeReason, /false/);
  assert.doesNotMatch(pettyOfficer.judgeReason, /恒真|conditionMatches|未知条件按 true/);
  assert.doesNotMatch(pettyOfficer.judgeReason, /RIFT-\d+/);
  assert.equal(pettyOfficer.sourceText, "[Assault] (+1 :rb_might: while I'm an attacker.)");
});

test("ogn-215-298 Petty Officer: exactly one unvalued Assault keyword ability", () => {
  assert.equal(pettyOfficer.abilities.length, 1);
  assert.deepEqual(pettyOfficer.abilities, [{ kind: "keyword", keyword: "assault" }]);
  assert.equal(pettyOfficer.abilities[0].value, undefined);
});

test("ogn-215-298 Petty Officer: the declared keyword resolves to the merged Assault definition", () => {
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  const [ability] = assault.expand({ value: pettyOfficer.abilities[0].value, host: HOST });
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.amount.value, 1, "807.1.b.3 default for a valueless printing");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.right.value, "attacker");
});

test("ogn-215-298 Petty Officer: the Assault expansion validates as EffectIR for this card identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: assault.expand({ value: pettyOfficer.abilities[0].value, host: HOST }),
    sourceText: pettyOfficer.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("Petty Officer: production Assault binding leaves defenders and units outside combat at printed Might", () => {
  for (const combatRole of ["defender", null]) {
    const { kernel, engine, source, handle } = boundAssault(combatRole);
    assert.equal(source.combatRole, combatRole);
    const [registration] = engine.layers.registry.list();
    assert.equal(registration.effect.effect.amount, 1);
    assert.equal(typeof registration.effect.effect.condition, "function");
    assert.equal(engine.layers.snapshot(source.ref).might, 5, "807.1.d.1: no Assault bonus without Attacker designation");
    assert.equal(kernel.getObject("petty-officer").might, 5, "layers preserve printed Might");
    handle.unbind();
    assert.deepEqual(engine.layers.registry.list(), []);
  }
});

test("Petty Officer: production Assault must add 1 Might to an attacker (CR 807.1.c/807.1.d.1)", {
  todo: "Assault reads designation instead of ObjectSnapshot.combatRole; the production binder catches the unavailable property and returns false"
}, () => {
  const { engine, source, handle } = boundAssault("attacker");
  try {
    assert.equal(source.combatRole, "attacker");
    const [registration] = engine.layers.registry.list();
    assert.equal(registration.effect.effect.amount, 1);
    assert.equal(typeof registration.effect.effect.condition, "function");
    assert.equal(engine.layers.snapshot(source.ref).might, 6, "807.1.c: a 5 Might attacker with Assault 1 has 6 Might");
  } finally {
    handle.unbind();
  }
});

test("Petty Officer: Assault stacking keeps the merged value in one continuous effect", () => {
  const [stacked] = assault.expand({ value: 3, host: HOST });
  assert.equal(stacked.kind, "static");
  assert.equal(stacked.effect.kind, "continuous.might");
  assert.deepEqual(stacked.effect.amount, { kind: "constant", value: 3 });
});
