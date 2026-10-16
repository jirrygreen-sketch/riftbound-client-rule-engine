import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/orianna-mechanical-marvel.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CARD_ID =
  "card.hash-d4ef90d20d4782edbcabe8cd157c2b6565e5c53b930df73f688bd58c0289d3a1";

const [costModification] = program.abilities;

test("rad-068-167 Orianna, Mechanical Marvel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("rad-068-167 Orianna, Mechanical Marvel: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "Once each turn, while I'm at a battlefield, you may pay :rb_energy_1::rb_rune_rainbow: less to play a gear."
  );
});

test("rad-068-167 Orianna, Mechanical Marvel: the discount is a static cost modification, not a resolving instruction (366.2 / 404.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -1 });
  // "1 Energy and one rainbow rune" = 1 Energy plus 1 Power of any domain (135.2.e.5).
  assert.deepEqual(costModification.effect.power, {
    kind: "constant",
    value: { amount: -1, domain: "any" }
  });
  assert.deepEqual(costModification.effect.appliesTo, {
    kind: "constant",
    value: { type: "gear", controller: "controller" }
  });
  assert.deepEqual(costModification.effect.stage, {
    kind: "constant",
    value: "total-cost"
  });
  // "Once each turn" is the usage limit of this continuous effect.
  assert.deepEqual(costModification.effect.once, { kind: "constant", value: "per-turn" });
});

test("rad-068-167 Orianna, Mechanical Marvel: 'while I'm at a battlefield' is the source location condition (364.3)", () => {
  assert.deepEqual(costModification.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "location" },
    operator: "eq",
    right: { kind: "constant", value: "battlefield" }
  });
});

test("rad-068-167 Orianna, Mechanical Marvel: no continuous.cost-modification instruction is registered", () => {
  // The concrete dependency, asserted so the judge-required status is reproducible.
  assert.equal(instructionDefinitionsById.has("continuous.cost-modification"), false);
});

test("rad-068-167 Orianna, Mechanical Marvel: the merged cost pipeline only takes caller-supplied discounts", () => {
  // A discount applied by the caller works (RIFT-89's existing API) ...
  const kernel = world().unit("orianna", { might: 5 }).build();
  const withDiscount = buildCostPlan(kernel, {
    id: "gear-play",
    cost: { energy: { kind: "constant", value: 3 } },
    discounts: [
      { id: "orianna-discount", resource: "energy", amount: { kind: "constant", value: 1 } }
    ]
  });
  assert.equal(withDiscount.total.energy, 2);
  // ... but nothing in the pipeline reads a continuous effect to discover that discount,
  // and the printed Power component cannot be reduced this way without a domain choice.
  assert.equal(withDiscount.total.power.length, 0);
});

test("rad-068-167 Orianna, Mechanical Marvel: the +1 Energy / +1 Power discount cannot be approximated by a plain energy reduction", () => {
  // Documents the second half of the discount so the missing any-domain Power reduction is
  // visible: an energy-only discount would under-apply the printed card text.
  const kernel = world().unit("orianna", { might: 5 }).build();
  const plan = buildCostPlan(kernel, {
    id: "gear-play",
    cost: {
      energy: { kind: "constant", value: 0 },
      power: { kind: "constant", value: 1 }
    },
    domains: ["Fury"]
  });
  assert.equal(plan.total.power.length, 1);
  assert.deepEqual(plan.total.power[0].allowedDomains, ["Fury"]);
});

test.todo(
  "rad-068-167 Orianna, Mechanical Marvel: consume the continuous cost modification at Finalize " +
    "(1 Energy + 1 any-domain Power less for a gear the controller plays, once each turn, while " +
    "the source is at a battlefield) — needs continuous.cost-modification plus a layers/cost " +
    "reader (RIFT-89, RIFT-91) and a per-turn use counter on continuous effects"
);

test.todo(
  "rad-068-167 Orianna, Mechanical Marvel: any-domain Power discount semantics — reducing a " +
    "printed Power component by 1 regardless of domain, and honoring 356.4.c component ordering"
);
