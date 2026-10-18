import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rengar-unseen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement as queryMovement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { fixture as turnFixture } from "../../../../engine-core/test/turn/helpers.mjs";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";

/** Drain the merged chain until it blocks; used to reach the combat gate. */
function settleTurn(flow) {
  let budget = 0;
  while (flow.chain.items.length) {
    if (++budget > 100) throw new Error("Nonterminating test chain");
    flow.pass(flow.chain.priority);
  }
  flow.advance();
}

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

/** The card's own source snapshot as a Board unit carrying this identity. */
function boardSource(overrides = {}) {
  const f = fixture({ cards: [] });
  const source = { ...f.kernel.getObject("source"), keywords: [], cardId: CANONICAL_ID, ...overrides };
  return { ...f, source };
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
  // 2026-10-18 re-sweep: the reason must name the measured production gaps, not
  // the stale "no binder / no ObjectSnapshot field" wording.
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /abilityEnvironment/);
  assert.match(program.judgeReason, /expr-ext/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /standard-move-transaction/);
  assert.doesNotMatch(program.judgeReason, /尚未进入实际 ObjectSnapshot|不存在 designation/);
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
  // These are structural checks against the merged keyword files (contract
  // 3.7); they do not claim the keywords are consumed by the engine.
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

// ---- 2026-10-18 re-sweep execution evidence ----
// The merged binder/chain/layer code is measured directly instead of asserting
// the contract text. Nothing here promotes the card: each test pins one live
// production gap.

test("unl-024-219 Rengar, Unseen golden: Assault 2 and Ganking bind into a layer, Accelerate's cost and Deflect's tax still do not", () => {
  // 805.1.b / 807.1.c / 809.1.c / 810.1.b: every expansion is real IR, and the
  // production binder accepts the Assault and Ganking declarations (both
  // register an ability-layer effect). The Accelerate cost declaration and the
  // Deflect tax declaration still refuse a layer mapping because nothing
  // consumes those kinds, which is why the card cannot be plugged into the
  // play/cost and targeting pipelines yet.
  const { engine, source } = boardSource();
  const expanded = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  }).inspect(source).abilities;
  const binder = createEngineStaticBinder(engine);
  const bound = expanded.filter(candidate => candidate.kind === "static").map(ability => {
    try {
      bindStaticAbility(binder, ability, source);
      return [ability.effect.kind, "bound"];
    } catch (error) {
      return [ability.effect.kind, error.message];
    }
  });
  assert.deepEqual(bound, [
    ["accelerate.cost", "Static ability kind accelerate.cost has no layer mapping"],
    ["continuous.might", "bound"],
    ["target.tax", "Static ability kind target.tax has no layer mapping"],
    ["continuous.movement", "bound"]
  ]);
});

test("unl-024-219 Rengar, Unseen golden: Assault 2 grants no Might because the designation gate cannot be evaluated", () => {
  // 807.1.c / 807.1.d.1: the expansion gates the +2 on
  // compare(object-property(self, "designation"), eq, "attacker").
  // programs/statics.ts evaluates ability.condition with the base interpreter,
  // which raises MissingInformation for that characteristic and then treats the
  // gate as false. The +2 never lands -- for the attacker as well as for the
  // defender -- until the designation read is wired; the merged expr-ext
  // evaluator already maps designation to combatRole but has no production
  // caller.
  const [assaultExpansion] = expansionFor("Assault", 2);
  const results = ["attacker", "defender", null].map(combatRole => {
    const { engine, source } = boardSource({ might: 2, combatRole });
    const handle = createEngineStaticBinder(engine).bindStatic(assaultExpansion, source);
    const layered = createLayerEngine([source], engine.layers.registry.list()).evaluate(source.ref);
    handle.unbind();
    return [combatRole, layered.might];
  });
  assert.deepEqual(results, [
    // 807.1.d.1 would need +2 for the attacker; the real layer result is flat.
    ["attacker", 2],
    ["defender", 2],
    [null, 2]
  ]);
});

test("unl-024-219 Rengar, Unseen golden: the real combat flow blocks and emits no Attacker designation", () => {
  // 807.1.d / 466.2: Assault is written against the Attacker designation, which
  // only a combat start transaction can produce. Driving the merged turn flow
  // into a staged Combat blocks with combat-start-transaction and publishes no
  // attack-declared timing, so no production ObjectSnapshot ever carries a real
  // combatRole for the expanded gate to read.
  const f = turnFixture({
    fields: [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    setup: w => w.unit("defender", { owner: "B", location: { type: "battlefield", id: "bf1" } })
  });
  f.flow.start();
  f.flow.execute(f.draft("move-to-enemy", [{
    id: "move",
    op: "effect.move",
    args: { to: { kind: "constant", value: { type: "battlefield", id: "bf1" } } }
  }]));
  assert.throws(
    () => settleTurn(f.flow),
    error => error.status === "blocked" && error.code === "combat-start-transaction"
  );
  assert.equal(f.flow.battlefields[0].staged, "combat");
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "attack-declared").length, 0);
  assert.equal(f.kernel.getObject("source").combatRole, null);
});

test("unl-024-219 Rengar, Unseen: the Ganking expansion still cannot grant the battlefield-to-battlefield route", () => {
  // 810.1.b / 144.4.c.1: layers/rules/query.ts movement() reads
  // effect.permission.routes, while the merged Ganking expansion writes the
  // string permission "battlefield-to-battlefield". The declaration binds, but
  // the reader finds no routes, so canGank stays false. The same registration
  // written with the { routes: [...] } spelling does grant the route, which
  // pins the mismatch to the expansion shape rather than to the layer engine.
  const [gankingExpansion] = expansionFor("Ganking", undefined);
  const { engine, source } = boardSource();

  const authored = createEngineStaticBinder(engine).bindStatic(gankingExpansion, source);
  const authoredView = queryMovement(engine.layers.registry, source.ref, source, "A");
  authored.unbind();
  assert.equal(authoredView.canGank, false);
  assert.equal(authoredView.battlefieldToBattlefield, false);
  assert.deepEqual(authoredView.permissions, []);

  const spelled = createEngineStaticBinder(engine).bindStatic({
    kind: "static",
    effect: {
      kind: "continuous.movement",
      permission: { routes: ["battlefield-to-battlefield"], move: "standard" }
    }
  }, source);
  const spelledView = queryMovement(engine.layers.registry, source.ref, source, "A");
  spelled.unbind();
  assert.equal(spelledView.canGank, true);
  assert.equal(spelledView.battlefieldToBattlefield, true);
});

test("unl-024-219 Rengar, Unseen golden: the chain's own tax path charges Energy where 809.1.c.1 requires any-domain Power", () => {
  // 809.1.c.1: choosing this unit must cost the chooser [A], one Power of any
  // domain. Chain Finalize still converts every collected tax into
  // { energy: amount } and never consults the merged tax adapter, so a chooser
  // holding Power but no Energy is rejected while a chooser holding Energy is
  // charged the wrong resource. Both halves are measured on the real
  // finalizeTargetPlan path with the card's own Deflect effect.
  const [deflectExpansion] = expansionFor("Deflect", undefined);
  const f = fixture({ cards: [] });
  const target = { ...f.kernel.getObject("enemy"), controller: "B", zone: "board", owner: "B" };
  const context = bindResolveContext(f.kernel, { source: target, controller: "A" });
  const taxes = [];
  const plan = finalizeTargetPlan(context, {
    id: "choose-rengar",
    filter: { objectId: target.ref.id, zone: "board" },
    min: 1,
    max: 1
  }, {
    selected: [target.ref],
    tax: { kind: "deflect", amount: deflectExpansion.effect.value.value },
    taxAdapter: { appendTargetTax: request => { taxes.push(request); } }
  });
  assert.deepEqual(plan.selected, [target.ref]);
  assert.equal(taxes.length, 1);
  assert.equal(taxes[0].kind, "deflect");
  assert.equal(taxes[0].amount, 1);
  // The chain turns that request into an Energy component, never the [A] Power
  // payment that the merged adapter would build.
  const energyComponent = { id: "target-tax:0", cost: { energy: { kind: "constant", value: taxes[0].amount } } };
  const planWithEnergy = buildCostPlan(context, {
    id: "choose-rengar",
    cost: { energy: { kind: "constant", value: 0 } },
    mandatoryAdditional: [energyComponent]
  });
  assert.equal(planWithEnergy.total.energy, 1);
  assert.deepEqual(planWithEnergy.total.power, []);
});

test("unl-024-219 Rengar, Unseen: the Accelerate declaration still cannot reach a cost plan", () => {
  // 805.2.b / 805.6: the merged cost plan accepts an optional "accelerate"
  // component and the chain consumes it when resolving a Unit, but the
  // expansion's cost shape (kind "additional-cost", optional: true) is refused
  // by programs/play.ts translateCost and the static declaration is refused by
  // the binder. Nothing produces { kind: "accelerate" } from the card.
  const [accelerateCost] = expansionFor("Accelerate", undefined);
  assert.throws(
    () => translateCost(accelerateCost.effect.cost, "rengar-unseen", "play"),
    /Unsupported play cost field optional/
  );
  const { engine, source } = boardSource();
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(accelerateCost, source),
    /Static ability kind accelerate\.cost has no layer mapping/
  );
});

test.todo(
  "unl-024-219 Rengar, Unseen: pay the Accelerate optional cost and enter ready (CR 805.1.b/805.2.b/805.6) " +
    "- the cost plan and the chain's ready entry both exist; the card's keyword still has no producer into CostPlanInput"
);

test.todo(
  "unl-024-219 Rengar, Unseen: apply Assault 2 exactly while the unit holds the Attacker designation " +
    "(CR 807.1.c/807.1.d.1) - the gate needs the designation read wired into the static-condition evaluator plus a real role producer"
);

test.todo(
  "unl-024-219 Rengar, Unseen: append the Deflect 1 tax through the chain with any-domain Power (CR 809.1.c.1) " +
    "- target/tax builds the payment, but Chain Finalize has no adapter caller and still records Energy"
);

test.todo(
  "unl-024-219 Rengar, Unseen: let the standard-move workflow read Ganking's continuous.movement permission " +
    "(CR 810.1.b/144.4.c.1) - movement() reads permission.routes while the expansion writes a permission string, " +
    "and the standard move itself still blocks with standard-move-transaction"
);
