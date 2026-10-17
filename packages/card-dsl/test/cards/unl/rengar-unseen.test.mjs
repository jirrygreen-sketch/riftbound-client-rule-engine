import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rengar-unseen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-aefc9e1b1b204e123d076f130b2b9b284f4a1f64a08fa9127a1a92c95ff3f6d9";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)";

const [accelerate, assault, deflect, ganking] = program.abilities;

/** Expanded abilities must be valid EffectIR for this card identity. */
function expansionFor(keywordId, value) {
  const definition = keywordDefinitionsById.get(keywordId);
  assert.ok(definition, "effects/keywords/" + keywordId + ".ts must be registered");
  const expansion = definition.expand({
    value,
    host: { canonicalCardId: CANONICAL_ID }
  });
  const validated = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "expansion shape check against the merged keyword file",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(validated.issues, []);
  assert.equal(validated.ok, true);
  return expansion;
}

test("unl-024-219 Rengar, Unseen: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-024-219 Rengar, Unseen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /continuous\.movement/);
  // The stale "no KeywordDef consumer / combatRole not in ObjectSnapshot" wording
  // is gone (RIFT-257/258 and contract 3.8 landed); the reason must name the real
  // remaining pipeline gaps.
  assert.match(program.judgeReason, /CardProgram/);
  assert.match(program.judgeReason, /静态 compare 条件已可求值/);
  assert.match(program.judgeReason, /combatRole/);
  // Second-sweep refresh proof: the merged target-plan Deflect-tax scaffolding
  // is named instead of claiming target.tax has no merged consumer.
  assert.match(program.judgeReason, /target-plan/);
  assert.doesNotMatch(program.judgeReason, /尚未进入实际 ObjectSnapshot/);
});

test("unl-024-219 Rengar, Unseen: four keyword declarations in printed order", () => {
  assert.equal(program.abilities.length, 4);
  assert.deepEqual(
    program.abilities.map(ability => [ability.kind, ability.keyword, ability.value]),
    [
      ["keyword", "accelerate", undefined],
      // 807.1.b.1/.b.2: the printed Assault Value is 2.
      ["keyword", "assault", 2],
      // 809.1.b.3: the printed [Deflect] carries no number.
      ["keyword", "deflect", undefined],
      ["keyword", "ganking", undefined]
    ]
  );
  assert.equal(accelerate.value, undefined);
  assert.equal(deflect.value, undefined);
  assert.equal(ganking.value, undefined);
});

test("unl-024-219 Rengar, Unseen: each merged keyword expansion is valid IR for this host", () => {
  // These are structural/existence checks against the merged keyword files
  // (contract 3.7); they do not claim the keywords are consumed by the engine.
  const accelerateExpansion = expansionFor("Accelerate", undefined);
  assert.equal(keywordDefinitionsById.get("Accelerate").stacking, "single");
  assert.deepEqual(accelerateExpansion.map(ability => ability.kind), ["static", "replacement"]);
  // 805.6 / 805.6.a: the replacement readies the entering unit without a
  // separate "becomes ready" event.
  assert.equal(accelerateExpansion[1].replaces.filter.exhausted, true);

  const assaultExpansion = expansionFor("Assault", 2);
  assert.equal(keywordDefinitionsById.get("Assault").stacking, "sum");
  // 807.1.c: functionally "+2 [M] while I'm an attacker".
  assert.equal(assaultExpansion[0].kind, "static");
  assert.equal(assaultExpansion[0].effect.kind, "continuous.might");
  assert.deepEqual(assaultExpansion[0].effect.amount, { kind: "constant", value: 2 });

  const deflectExpansion = expansionFor("Deflect", undefined);
  assert.equal(keywordDefinitionsById.get("Deflect").stacking, "sum");
  // 809.1.c: the static target-tax declaration.
  assert.deepEqual(deflectExpansion[0].effect.kind, "target.tax");
  assert.deepEqual(deflectExpansion[0].effect.value, { kind: "constant", value: 1 });

  const gankingExpansion = expansionFor("Ganking", undefined);
  assert.equal(keywordDefinitionsById.get("Ganking").stacking, "single");
  // 810.1.b / 144.4.c.1: the added battlefield-to-battlefield standard-move permission.
  assert.equal(gankingExpansion[0].effect.kind, "continuous.movement");
  assert.equal(gankingExpansion[0].effect.permission, "battlefield-to-battlefield");
});

test("unl-024-219 Rengar, Unseen: every ability is a bare keyword declaration (contract 3.7)", () => {
  // The card layer declares keywords only; it never carries a second copy of a
  // keyword's expansion (README §5).
  for (const ability of program.abilities) {
    assert.deepEqual(ability, {
      kind: "keyword",
      keyword: ability.keyword,
      ...(ability.value === undefined ? {} : { value: ability.value })
    });
  }
});

test("unl-024-219 Rengar, Unseen golden: its expanded Deflect taxes an opposing ability with any-domain Power", () => {
  // Bind the actual keyword expansion at the tax API boundary. Chain Finalize
  // and the static binder still need to supply this bound tax automatically.
  const initial = world().player("A", { energy: 0, power: ["Order"] })
    .unit("ability-source").unit("rengar", { owner: "B", cardId: CANONICAL_ID, might: 4 }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("ability-source") });
  const target = kernel.getObject("rengar");
  const expanded = createProgramBinding({ cardPrograms: [program] }).inspect(target).abilities;
  const tax = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "target.tax");
  assert.ok(tax);
  const adapter = createTargetTaxAdapter(kernel, {
    id: "choose-rengar", cost: { energy: { kind: "constant", value: 0 } }
  }, { kind: "ability", effects: [{ id: "rengar-deflect", target: target.ref, effect: tax.effect }] });
  const requirement = { id: "enemy", filter: { type: "unit", controller: "B", zone: "board" }, min: 1, max: 1 };
  assert.deepEqual(adapter.finalizeTargetPlan(requirement, { selected: [target.ref] }).selected, [target.ref]);
  assert.equal(adapter.costPlan.total.energy, 0);
  assert.equal(adapter.costPlan.total.power.reduce((sum, item) => sum + item.amount, 0), 1);
  const receipt = payCostPlan(kernel, adapter.costPlan);
  assert.deepEqual(receipt.actions[0].action.plan, { finalized: true, energy: 0, power: ["Order"] });
  assert.equal(kernel.getObject("rengar").might, 4);
});

test.todo(
  "unl-024-219 Rengar, Unseen: charge the Accelerate optional additional cost (CR 805.1.b: [1][Fury]) in the" +
    " Finalize cost plan and apply the 805.6 enter-ready replacement (the merged keyword expansion is" +
    " not consumed by the card-program -> cost/replacement pipeline)"
);
test.todo(
  "unl-024-219 Rengar, Unseen: apply Assault 2 in the arithmetic layer only while this unit holds the Attacker" +
    " designation (CR 807.1.c/.d) — map the keyword designation read to ObjectSnapshot.combatRole and" +
    " provide the combat designation transaction"
);
test.todo(
  "unl-024-219 Rengar, Unseen: append the Deflect 1 target tax when an opponent chooses this unit (CR 809.1.c;" +
    " target/tax computes any-domain Power, but Chain Finalize does not use that adapter)"
);
test.todo(
  "unl-024-219 Rengar, Unseen: let the movement system read the Ganking continuous.movement permission" +
    " (CR 810.1.b / 144.4.c.1 — movement() is merged but has no caller)"
);
