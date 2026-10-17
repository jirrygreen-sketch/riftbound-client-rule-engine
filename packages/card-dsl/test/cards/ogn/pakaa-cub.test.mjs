import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pakaa-cub.js";
import hidden from "../../../../engine-core/dist/effects/keywords/Hidden.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildHiddenCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e6d9cb8b5b7516aaf9f0acb84629037ed610be0c027965d443bbe45210273059";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)";

test("ogn-135-298 Pakaa Cub: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-135-298 Pakaa Cub: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-135-298 Pakaa Cub: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /buildHiddenCostPlan/);
  assert.match(program.judgeReason, /811\.1\.c/);
  assert.match(program.judgeReason, /811\.1\.d\.1/);
  assert.match(program.judgeReason, /Hide/);
  assert.match(program.judgeReason, /面朝下区域/);
});

test("ogn-135-298 Pakaa Cub: exactly one unvalued Hidden keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "hidden");
  assert.equal(keyword.value, undefined);
});

test("ogn-135-298 Pakaa Cub: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Hidden");
  assert.ok(registered, "effects/keywords/Hidden.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("811.1.c"));
  assert.ok(registered.ruleRefs.includes("811.1.d.2"));
  assert.equal(registered.stacking, "single");
  const [expansion] = hidden.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(expansion, { kind: "static", effect: { kind: "cost.hidden" } });
});

test("ogn-135-298 Pakaa Cub: the merged hidden cost plan charges 1 any-domain Power to hide (CR 811.1.b)", () => {
  // This executes the merged cost planning that Hidden's Hide Discretionary
  // Action depends on: the Hide cost is one Power payable with any Domain. The
  // cost pipeline reads the card's printed cost from the resolve context's
  // source, so the case is bound to the card itself rather than to whichever
  // object the kernel happens to list first.
  const base = world()
    .hand("pakaa-cub", { name: "Pakaa Cub", types: ["unit"], energy: 3, power: null })
    .build();
  const kernel = base.clone({ sourceSnapshot: undefined, source: base.ref("pakaa-cub") });
  const hidePlan = buildHiddenCostPlan(kernel, { id: "hidden:pakaa-cub", mode: "hide" });

  assert.equal(hidePlan.total.energy, 0);
  assert.equal(hidePlan.total.power.length, 1);
  assert.equal(hidePlan.total.power[0].amount, 1);
  assert.deepEqual(
    [...hidePlan.total.power[0].allowedDomains].sort(),
    ["Body", "Calm", "Chaos", "Fury", "Mind", "Order"]
  );
});

test("ogn-135-298 Pakaa Cub: the merged hidden play plan ignores the printed base cost (CR 811.1.b)", () => {
  const base = world()
    .hand("pakaa-cub", { name: "Pakaa Cub", types: ["unit"], energy: 3, power: null })
    .build();
  const kernel = base.clone({ sourceSnapshot: undefined, source: base.ref("pakaa-cub") });
  const playPlan = buildHiddenCostPlan(kernel, {
    id: "hidden:pakaa-cub:play",
    mode: "play",
    cost: { kind: "printed" }
  });

  assert.deepEqual(playPlan.modifications, [{ kind: "ignore-base", ignore: "resources" }]);
  assert.equal(playPlan.base.energy, 3);
  assert.equal(playPlan.total.energy, 0);
  assert.deepEqual(playPlan.total.power, []);
});

test.todo(
  "Pakaa Cub: take the Hide Discretionary Action (pay [A], hide facedown at a battlefield I control "
    + "without a facedown card), then play me from facedown with [Reaction] ignoring my base cost, "
    + "to the battlefield I was hidden at (CR 811.1.b/811.1.c.3/811.1.d.1) — blocked because "
    + "the Hide action has no caller and the ZoneId contract has no facedown zone"
);
