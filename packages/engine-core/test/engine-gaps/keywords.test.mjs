import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import { keywordDefinitionsById } from "../../dist/effects/keywords/registry.generated.js";
import empower from "../../dist/effects/keywords/Empower.js";
import equip from "../../dist/effects/keywords/Equip.js";
import predict from "../../dist/effects/keywords/Predict.js";
import unique from "../../dist/effects/keywords/Unique.js";
import legion from "../../dist/effects/keywords/Legion.js";
import repeat from "../../dist/effects/keywords/Repeat.js";
import { expandProgram } from "../../dist/programs/keywords.js";
import { world } from "../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });
const card = (canonicalCardId, abilities = []) => ({
  canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  sourceText: "keyword gap regression",
  abilities
});

function source(canonicalCardId, keywords) {
  return world().object("host", {
    cardId: canonicalCardId,
    zone: "board",
    keywords,
    types: ["unit"]
  }).build().getObject("host");
}

test("program expansion forwards printed params.cost and gives separate instances stable ids", () => {
  const cost = { kind: "activated", energy: constant(2) };
  const program = card("test:keyword-params", [
    { kind: "keyword", keyword: "Equip", params: { cost } }
  ]);
  const expanded = expandProgram(program, source("test:keyword-params", [
    { id: "Equip", params: { cost: { kind: "activated", energy: constant(3) } } },
    { id: "Equip", params: { cost: { kind: "activated", energy: constant(4) } } }
  ]));

  assert.equal(expanded.expanded.length, 3);
  assert.deepEqual(expanded.expanded.map(ability => ability.cost.energy.value), [2, 3, 4]);
  assert.equal(new Set(expanded.expanded.map(ability => ability.body[0].id)).size, 3);
  assert.equal(new Set(expanded.expanded.map(ability => ability.body[0].targets[0].id)).size, 3);
  assert.equal(validateCardProgram(card("test:keyword-params", expanded.expanded)).ok, true);
});

test("Empower receives its printed CostSpec through the production expander", () => {
  const cost = { kind: "activated", energy: constant(5) };
  const expanded = expandProgram(
    card("test:empower-params"),
    source("test:empower-params", [{ id: "Empower", params: { cost } }])
  );
  assert.equal(expanded.expanded.length, 1);
  assert.deepEqual(expanded.expanded[0].cost, cost);
  assert.equal(expanded.expanded[0].body[0].id, "empower:test:empower-params");
});

test("Legion exposes the additive symbolic self exclusion while retaining legacy reads", () => {
  const [ability] = legion.expand({ host: { canonicalCardId: "test:legion" } });
  assert.equal(ability.effect.history.exclude, "self");
  assert.equal(ability.effect.history.excluding, "test:legion");
});

test("missing printed costs stay unsupported instead of becoming zero", () => {
  const [ability] = repeat.expand({ host: { canonicalCardId: "test:repeat" } });
  assert.deepEqual(ability.effect.cost, { kind: "repeat" });
  assert.equal(Object.hasOwn(ability.effect.cost, "energy"), false);
});

test("Predict is registered but remains judge-required until a body-fragment contract exists", () => {
  assert.equal(keywordDefinitionsById.get("Predict"), predict);
  assert.throws(
    () => predict.expand({ host: { canonicalCardId: "test:predict" }, value: 2 }),
    error => error?.code === "judge-required" && /body-fragment/.test(error.message)
  );
});

test("Unique is registered under its legacy lowercase id and has no gameplay expansion", () => {
  assert.equal(keywordDefinitionsById.get("unique"), unique);
  assert.equal(keywordDefinitionsById.get("Unique"), undefined);
  assert.deepEqual(unique.expand({ host: { canonicalCardId: "test:unique" } }), []);
  assert.deepEqual(expandProgram(card("test:unique"), source("test:unique", [{ id: "Unique" }])).expanded, []);
});

test("legacy snapshots without params still expand with their historical defaults", () => {
  const expanded = expandProgram(card("test:legacy-equip"), source("test:legacy-equip", [{ id: "Equip" }]));
  assert.deepEqual(expanded.expanded[0].cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
});
