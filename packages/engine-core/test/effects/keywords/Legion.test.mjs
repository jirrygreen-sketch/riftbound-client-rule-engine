import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "@riftbound/card-dsl";

import legion from "../../../dist/effects/keywords/Legion.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = "ogn-217-298";

/** Wrap the expansion in the smallest validateCardProgram-compatible program. */
function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST,
    rulesetVersion: "core-1.5",
    status: "executable",
    abilities,
    sourceText: "[Legion][>] I cost [2] less."
  };
}

test("Legion KeywordDef identity: name, non-valued, single stacking (CR 812.1 / 812.2)", () => {
  assert.equal(legion.keyword, "Legion");
  assert.equal(legion.valued, false);
  assert.equal(legion.stacking, "single");
  assert.ok(legion.ruleRefs.includes("812.1.b.1"));
  assert.ok(legion.ruleRefs.includes("812.1.c"));
  assert.ok(legion.ruleRefs.includes("812.2"));
});

test("Legion expands to one static condition-predicate ability (CR 812.1.b.1)", () => {
  const abilities = legion.expand({ host: { canonicalCardId: HOST } });
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "condition.predicate");
  assert.equal(ability.effect.id, "legion:" + HOST + ":predicate");
  assert.equal(ability.effect.link, "active");
  assert.deepEqual(ability.condition, { kind: "always" });
});

test("Legion predicate encodes the turn-scope play history with the host excluded (CR 812.1.c)", () => {
  const [ability] = legion.expand({ host: { canonicalCardId: HOST } });
  assert.deepEqual(ability.effect.history, {
    scope: "turn",
    action: "play",
    player: "controller",
    excluding: HOST
  });
  assert.equal(ability.effect.operator, "gte");
  assert.equal(ability.effect.right, 1);
});

test("Legion expansion passes validateCardProgram (contract 3.7)", () => {
  const program = wrapProgram(legion.expand({ host: { canonicalCardId: HOST } }));
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Legion stacking is single: one played card satisfies every instance (CR 812.2)", () => {
  // v1.5 812.2: a single card finalized by the player satisfies all Legion instances they
  // control. The keyword therefore counts once ("single"), never sums and never duplicates.
  const first = legion.expand({ host: { canonicalCardId: HOST } });
  const second = legion.expand({ host: { canonicalCardId: HOST } });
  assert.equal(legion.stacking, "single");
  assert.deepEqual(first[0].effect.history, second[0].effect.history);
  const program = wrapProgram([...first, ...second]);
  const result = validateCardProgram(program);
  assert.equal(result.ok, true);
  assert.equal(result.value.abilities.length, 2);
});

test("Legion predicate id is host-scoped so card programs can reference it (CR 812.1.b)", () => {
  const other = legion.expand({ host: { canonicalCardId: "ogn-218-298" } });
  assert.equal(other[0].effect.id, "legion:ogn-218-298:predicate");
  assert.equal(other[0].effect.history.excluding, "ogn-218-298");
  // The valueless keyword ignores any stray numeric input.
  const withValue = legion.expand({ value: 2, host: { canonicalCardId: HOST } });
  assert.deepEqual(withValue, legion.expand({ host: { canonicalCardId: HOST } }));
});

test("Legion expansion registers in the generated keyword registry", () => {
  const registered = keywordDefinitionsById.get("Legion");
  assert.ok(registered);
  assert.equal(registered, legion);
});
