import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/eager-apprentice.js";

const CANONICAL = "card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6";

test("Eager Apprentice program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify|CostPlanInput\.discounts|cost\/cost-plan/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "While I'm at a battlefield, the Energy costs for spells you play is reduced by :rb_energy_1:, to a minimum of :rb_energy_1:."
  );
});

test("Eager Apprentice structure: one static cost-modification ability gated on being at a battlefield", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");

  // The discount is Energy-1 with the printed floor of 1 (356.4.e: a discount's
  // minimum applies only to that discount), applied to spells the controller plays.
  assert.equal(ability.effect.kind, "continuous.cost-modification");
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -1 });
  assert.deepEqual(ability.effect.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, { type: "spell", controller: "controller" });

  // "While I'm at a battlefield": the host must be at a battlefield location.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(ability.condition.left, {
    kind: "count",
    subject: "objects",
    filter: { object: "self", location: "battlefield" }
  });
});

test.todo(
  "Eager Apprentice discount applies at Finalize: Energy cost of a spell the controller plays is reduced " +
    "by 1 with the printed minimum of 1 (356.4.c.1 / 356.4.d ordering, 356.4.e per-discount floor), consumed by " +
    "the cost plan (RIFT-89) from a layers-registered continuous.cost-modification (RIFT-91)"
);

test.todo(
  "Eager Apprentice scope: the discount does not apply while the unit is at Base, and the minimum is a per-discount " +
    "floor (356.4.e worked example with Sky Splitter), verified once the cost consumer lands (RIFT-89)"
);
