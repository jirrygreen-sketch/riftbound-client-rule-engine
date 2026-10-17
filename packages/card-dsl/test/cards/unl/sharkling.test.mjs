import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sharkling.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "[Assault 4] (+4 :rb_might: while I'm an attacker.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("unl-006-219 Sharkling: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-006-219 Sharkling: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /805\.6/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /play producer|替代生命周期/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /conditionMatches/);
});

test("unl-006-219 Sharkling: unvalued Accelerate plus Assault 4, in printed order", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the Accelerate cost is the fixed [1][C] payment, so the keyword
  // carries no value; on this printing [C] must match the unit's Fury domain
  // (805.1.b.1) — card data only declares the keyword.
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[0].keyword, "accelerate");
  // 807.1.b.1-2: the printed "Assault 4" fixes the Assault Value at 4.
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault", value: 4 });
});

test("unl-006-219 Sharkling: both declared keywords resolve to the merged KeywordDefs", () => {
  const registeredAccelerate = keywordDefinitionsById.get("Accelerate");
  const registeredAssault = keywordDefinitionsById.get("Assault");
  assert.equal(registeredAccelerate, accelerate);
  assert.equal(registeredAssault, assault);
  // 805.4: multiple Accelerate instances are redundant; 807.2: Assault sums.
  assert.equal(registeredAccelerate.valued, false);
  assert.equal(registeredAccelerate.stacking, "single");
  assert.equal(registeredAssault.valued, true);
  assert.equal(registeredAssault.stacking, "sum");
});

test("unl-006-219 Sharkling: the Accelerate expansion declares the optional [1][C] cost and the enter-ready replacement", () => {
  const expansion = accelerate.expand({ host: HOST });
  assert.equal(expansion.length, 2);
  const [costDeclaration, replacement] = expansion;
  // 805.1.b / 805.2.a: the additional cost is [1] plus one matching-domain Power.
  assert.equal(costDeclaration.kind, "static");
  assert.equal(costDeclaration.effect.kind, "accelerate.cost");
  assert.deepEqual(costDeclaration.effect.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 } }
  ]);
  // 805.6 / 805.6.a: the paid cost replaces entering exhausted with entering ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces.filter, {
    self: true,
    cardId: CANONICAL_ID,
    exhausted: true
  });
  assert.deepEqual(replacement.with.map(instruction => instruction.op), ["effect.ready"]);
});

test("unl-006-219 Sharkling: the Assault 4 expansion is +4 Might gated on the Attacker designation", () => {
  const [ability] = assault.expand({ value: program.abilities[1].value, host: HOST });
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.condition.left.property, "designation");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("unl-006-219 Sharkling golden: the merged cost plan pays the optional Accelerate [1][Fury] (CR 805.1.b.1)", () => {
  // 805.1.b / 805.1.b.1: paying Accelerate adds 1 Energy and 1 Power that must
  // match one of the unit's domains (Fury here). The merged cost plan already
  // supports the accelerate optional group; only the card-declared
  // accelerate.cost -> plan wiring is missing (judgeReason).
  const kernel = world()
    .player("A", { energy: 5, power: ["Fury", "Fury"] })
    .unit("sharkling", { owner: "A", might: 1, power: ["Fury"] })
    .build();
  const context = kernel.clone({ source: kernel.ref("sharkling"), sourceSnapshot: kernel.getObject("sharkling") });
  const base = { id: "sharkling", cost: { kind: "explicit", energy: { kind: "constant", value: 3 } }, domains: ["Fury"] };

  const paid = buildCostPlan(context, {
    ...base,
    optionalAdditional: [{ id: "accelerate", kind: "accelerate", selected: true }]
  });
  assert.equal(paid.total.energy, 4);
  assert.deepEqual(paid.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  assert.deepEqual(paid.components.map((component) => [component.id, component.stage]), [
    ["base", "base"],
    ["accelerate", "optional-additional"]
  ]);

  const declined = buildCostPlan(context, {
    ...base,
    optionalAdditional: [{ id: "accelerate", kind: "accelerate", selected: false }]
  });
  assert.equal(declined.total.energy, 3);
  assert.deepEqual(declined.total.power, []);
  assert.deepEqual(declined.declinedAdditional, ["accelerate"]);
});

test("unl-006-219 Sharkling golden: the merged entry replacement turns the exhausted entry ready (CR 805.6 / 805.6.a)", () => {
  const [, replacement] = accelerate.expand({ host: HOST });
  const kernel = world()
    .unit("sharkling", {
      zone: "hand",
      types: ["unit"],
      power: ["Fury"],
      exhausted: false,
      // The KeywordDef's entry filter names the printed card identity
      // (cardId: host.canonicalCardId), so the host snapshot has to carry it.
      cardId: CANONICAL_ID
    })
    .build();
  const hostRef = kernel.ref("sharkling");
  const bound = bindReplacement(replacement, hostRef, {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: () => {} }
  });

  // The unit is played: Hand -> Chain, then 143.4's default exhausted entry.
  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const chainIncarnation = kernel.ref("sharkling");
  assert.equal(kernel.perform({ type: "exhaust", object: chainIncarnation }).status, "done");

  const entering = {
    type: "move-zone",
    object: chainIncarnation,
    to: "base",
    location: { type: "base", player: "A" }
  };
  assert.equal(bound.registration.matches(entering, entering), true);
  const applied = bound.registration.apply(entering, entering);
  assert.deepEqual(applied.actions.map((action) => action.type), ["ready", "move-zone"]);
  for (const action of applied.actions) assert.equal(kernel.perform(action).status, "done");
  const entered = kernel.getObject("sharkling");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
});

test("unl-006-219 Sharkling golden: the Assault 4 Might modification itself registers and the merged layer engine applies it", () => {
  // 807.1.c / 143.2.a: the +4 is an arithmetic-layer Might modification. The
  // continuous.might instruction is executed by the merged interpreter and the
  // layer engine consumes the registration; the designation gate is the
  // remaining gap asserted below.
  const instruction = {
    id: "sharkling.assault-might",
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: "add" },
      amount: { kind: "constant", value: 4 },
      objects: { kind: "constant", value: { kind: "target", id: "sharkling.self" } }
    },
    targets: [
      { id: "sharkling.self", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
    ]
  };
  const kernel = world().unit("sharkling", { owner: "A", might: 1 }).build();
  kernel.setTargets("sharkling.self", [kernel.ref("sharkling")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("sharkling") });
  const outcome = resolveChainBody([instruction], context);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");

  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layered = createLayerEngine(context.objects, registrations).evaluate(context.ref("sharkling"));
  assert.equal(layered.might, 5);
});

test("unl-006-219 Sharkling: the Assault designation gate is still observable in the merged layer result", () => {
  // 807.1.d.1: Assault applies only while the unit holds the Attacker
  // designation. The IR keeps that gate as a compare condition, while the
  // current layer vocabulary cannot evaluate designation; preserving the
  // non-attacker result records the supported arithmetic half and the live
  // reason this card remains judge-required.
  const [ability] = assault.expand({ value: program.abilities[1].value, host: HOST });
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.property, "designation");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });

  const kernel = world().unit("sharkling", { owner: "A", might: 3, combatRole: null }).build();
  const snapshot = kernel.getObject("sharkling");
  const layered = createLayerEngine([snapshot], [{
    effect: {
      id: "assault-4",
      layer: "arithmetic",
      source: snapshot.ref,
      filter: { objectId: "sharkling" },
      effect: ability.effect,
      condition: ability.condition
    },
    duration: { type: "permanent" }
  }]).evaluate(snapshot.ref);
  assert.equal(snapshot.combatRole, null);
  assert.equal(layered.might, 7);
});

test("unl-006-219 Sharkling: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-006-219 Sharkling: pay the optional Accelerate cost [1][Fury] during the play and let the unit enter " +
    "ready instead of exhausted (CR 805.1.b.1 / 805.2.b / 805.6) — the merged cost plan and bindReplacement both " +
    "handle it above; no merged producer feeds a card's keyword abilities into cost/cost-plan.ts optionalAdditional " +
    "or into the replacement lifecycle"
);

test.todo(
  "unl-006-219 Sharkling: apply Assault 4 as +4 Might exactly while the unit holds the Attacker designation " +
    "(CR 807.1.c / 807.1.d.1) — the merged layer engine applies the Might modification unconditionally because the " +
    "compare(designation) gate is outside its condition vocabulary and the Attacker designation is not produced by a " +
    "merged combat transaction (RIFT-124); the designation condition is also outside the current layer condition vocabulary"
);
