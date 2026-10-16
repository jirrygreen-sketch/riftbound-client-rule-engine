import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kraken-hunter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-763d40ad13566634b64cc2de5da621393c0cf40858bb36abd9052e741aba4c2f";

test("ogn-150-298 Kraken Hunter: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
      "As you play me, you may spend any number of buffs as an additional cost. Reduce my cost by :rb_rune_body: for each buff you spend."
  );
});

test("ogn-150-298 Kraken Hunter: judgeReason cites the variable additional cost and linked discount", () => {
  assert.match(program.judgeReason, /spend-buff/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /356\.4\.c/);
});

test("ogn-150-298 Kraken Hunter: Accelerate and Assault stay keyword declarations only", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault" });
  // No hand-rolled expansion of either keyword: 805.1.b / 807.1.b.3 are owned by
  // the KeywordDef files (cards/README.md section 5).
  assert.equal(program.abilities.some(ability => ability.kind === "static"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "replacement"), false);
});

test("ogn-150-298 Kraken Hunter: the merged Assault KeywordDef expands the printed keyword (807)", () => {
  const assault = keywordDefinitionsById.get("Assault");
  assert.ok(assault, "Assault KeywordDef must be registered");
  assert.equal(assault.valued, true);
  assert.equal(assault.stacking, "sum");
  const [expanded] = assault.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  // 807.1.b.3: no printed Assault Value means 1.
  assert.deepEqual(expanded.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expanded.effect.kind, "continuous.might");
  assert.equal(expanded.condition.left.property, "designation");
  assert.deepEqual(expanded.condition.right, { kind: "constant", value: "attacker" });
});

test("ogn-150-298 Kraken Hunter: the merged Accelerate KeywordDef declares the optional [1][C] cost (805.1.b)", () => {
  const accelerate = keywordDefinitionsById.get("Accelerate");
  assert.ok(accelerate, "Accelerate KeywordDef must be registered");
  assert.equal(accelerate.valued, false);
  assert.equal(accelerate.stacking, "single");
  const expanded = accelerate.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 2);
  const [cost, replacement] = expanded;
  assert.equal(cost.kind, "static");
  assert.equal(cost.effect.kind, "accelerate.cost");
  assert.deepEqual(cost.effect.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 } }
  ]);
  assert.equal(cost.effect.cost.optional, true);
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-enters-board");
});

test.todo(
  "ogn-150-298 Kraken Hunter: 'you may spend any number of buffs as an additional cost' needs a " +
    "variable-count optional additional cost at Finalize (CR v1.5 356.4 / 203.x); the merged " +
    "cost-plan optionalAdditional is a per-component boolean (cost/README.md), not an unbounded count."
);
test.todo(
  "ogn-150-298 Kraken Hunter: 'Reduce my cost by [Body] for each buff you spend' needs a component " +
    "discount that reads the paid spend-buff count (CR v1.5 356.4.c); CostDiscount.amount only takes a " +
    "static Expr today (RIFT-89 cost-plan workstream)."
);
