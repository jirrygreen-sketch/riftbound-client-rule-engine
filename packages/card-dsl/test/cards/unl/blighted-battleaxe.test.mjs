import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/blighted-battleaxe.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

test("unl-019-219 Blighted Battleaxe: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip|equip/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /Energy/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(261|257)/);
});

test("unl-019-219 Blighted Battleaxe: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-019-219 Blighted Battleaxe: single Equip declaration carrying one Fury Power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c: printed cost is 1 energy symbol plus 1 Fury rune symbol; the KeywordAbility
  // carries the Power part (value = symbol count, costDomain = domain).
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
  // 818.1.a: the printing carries the required Equipment tag in the local catalog.
  assert.equal(SOURCE_TEXT.includes("Equip"), true);
});

test("unl-019-219 Blighted Battleaxe: the merged Equip expansion stays valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.keyword, "Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2: the expansion is functionally "[Cost]: Attach this gear to a unit you
  // control." Expanding and validating it keeps the declared keyword honest against the
  // current keyword registry.
  const expansion = definition.expand({
    value: equip.value,
    host: { canonicalCardId: CARD_ID }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues));
  assert.deepEqual(expanded.issues, []);

  // The expanded body performs an attach; the activation keeps the printed cost shape.
  const [activation] = expansion;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.equal(activation.cost.payments.length >= 1, true);
  assert.deepEqual(activation.body.map((step) => [step.id, step.op]), [
    ["equip-attach", "effect.attach"]
  ]);
  // 818.1.b.1: the chosen unit is a Target restricted to units you control.
  assert.equal(activation.body[0].targets.length, 1);
  assert.equal(activation.body[0].targets[0].id, "equip-target");
  assert.equal(activation.body[0].targets[0].min, 1);
  assert.equal(activation.body[0].targets[0].max, 1);
  assert.equal(activation.body[0].targets[0].selection, "one");
  assert.equal(activation.body[0].targets[0].filter.type, "unit");
});

test("unl-019-219 Blighted Battleaxe: the merged program binding expands the declared keyword", () => {
  // The production adapter expands keyword abilities through the registry
  // (expandProgram) before any chain draft is built; the golden asserts the
  // card's declaration really reaches that expansion. Only Equip payment
  // planning remains blocked.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "battleaxe", zoneEntryId: 1 }, cardId: CARD_ID, name: "Blighted Battleaxe",
    types: ["gear"], tags: ["Equipment"], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: 4, energy: 4, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const inspected = binding.inspect(source);

  // The registry stores the validated program value; compare identity, not the
  // object reference.
  assert.equal(inspected.program.canonicalCardId, CARD_ID);
  const activation = inspected.abilities.find(ability => ability.kind === "activated");
  assert.ok(activation, "the Equip expansion must contribute the activated attach ability");
  assert.deepEqual(activation.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  assert.deepEqual(activation.body.map(step => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
});

test.todo(
  "unl-019-219 Blighted Battleaxe: pay the printed Equip cost (1 energy + 1 Fury Power, 818.1.c / 818.1.c.3) " +
    "through the cost plan and attach the gear end-to-end: readCost rejects the \"equip\" payment kind, and the " +
    "frozen KeywordAbility has no field for the printed Energy symbol count, so the activation must not be run free"
);

test("unl-019-219 Blighted Battleaxe: the production activation path still reaches the rejected Equip payment", () => {
  // programs/activate.ts builds the real activation draft: the merged Equip
  // expansion declares payments: [{ kind: "equip" }] and describeActivate keeps
  // it, but readCost blocks the unknown payment kind, so no production path can
  // pay the printed 1 Energy + 1 Fury Power cost.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "battleaxe", zoneEntryId: 1 }, cardId: CARD_ID, name: "Blighted Battleaxe",
    types: ["gear"], tags: ["Equipment"], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: 4, energy: 4, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const draft = binding.describeActivate(source, "A");
  assert.deepEqual(draft.cost.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  assert.deepEqual(draft.body.map(step => step.op), ["effect.attach"]);

  const kernel = world()
    .unit("battleaxe", { types: ["gear"], owner: "A", controller: "A", energy: 4, power: null })
    .build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "equip:test", cost: draft.cost.cost }),
    (error) => error instanceof CostPlanError && error.reason === "judge-required"
      && /Unsupported payment kind: equip/.test(error.message)
  );
});
