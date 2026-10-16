import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/galio-indefatigable.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0c05d1ff76277272f14ee7bb4bda6bb8d7a8d633932b28983770c8aa000f4d0d";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "[Tank] (I must be assigned combat damage first.)\n" +
  "I don't deal combat damage.";

const [deflectKeyword, tankKeyword, combatRestriction] = program.abilities;

test("unl-171-219 Galio, Indefatigable: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-171-219 Galio, Indefatigable: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /467\.2\.a/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /815/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-171-219 Galio, Indefatigable: [Deflect] and [Tank] are declarations only, with their expansions merged", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.deepEqual(tankKeyword, { kind: "keyword", keyword: "tank" });

  const registeredDeflect = keywordDefinitionsById.get("Deflect");
  assert.ok(registeredDeflect, "effects/keywords/Deflect.ts must be registered");
  // 809.1.b.3: an omitted Deflect value is 1; 809.2: granted values sum.
  assert.equal(registeredDeflect.valued, true);
  assert.equal(registeredDeflect.stacking, "sum");
  const [deflectExpansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(deflectExpansion.effect.kind, "target.tax");
  assert.deepEqual(deflectExpansion.effect.value, { kind: "constant", value: 1 });

  const registeredTank = keywordDefinitionsById.get("Tank");
  assert.ok(registeredTank, "effects/keywords/Tank.ts must be registered");
  // 815.2: multiple Tank instances are redundant.
  assert.equal(registeredTank.stacking, "single");
  const [tankExpansion] = registeredTank.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tankExpansion.effect.kind, "continuous.combat");
  assert.equal(tankExpansion.effect.mode, "damage-assignment");
  assert.equal(tankExpansion.effect.priority, "first");
});

test("unl-171-219 Galio, Indefatigable: \"I don't deal combat damage\" is a static combat restriction, never a trigger or a Might rewrite", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(combatRestriction.kind, "static");
  assert.equal(combatRestriction.effect.kind, "continuous.combat");
  assert.equal(combatRestriction.effect.appliesTo, "self");
  // 467.2.a / 467.2.b sum Might; suppressing this unit's contribution is not the
  // same as changing its Might or adding a trigger.
  assert.equal(combatRestriction.effect.restriction, "no-combat-damage");
  assert.equal(combatRestriction.condition, undefined);
  assert.equal(program.abilities.some(ability => ability.kind === "triggered"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "replacement"), false);
});

test("unl-171-219 Galio, Indefatigable golden: choosing the Deflect unit appends a target tax for the chooser (809.1.d)", () => {
  // 809.1.c / 809.1.d: opponents must pay [A] to choose me with a spell or
  // ability, and the tax is a Mandatory Additional Cost appended at Finalize.
  const kernel = world()
    .unit("galio", { might: 6, keywords: [{ id: "deflect", value: 1 }] })
    .build();
  const requests = [];
  const plan = finalizeTargetPlan(
    kernel,
    { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
    {
      selected: [kernel.ref("galio")],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: { appendTargetTax: request => { requests.push(request); return { status: "appended" }; } }
    }
  );

  assert.deepEqual(plan.selected, [kernel.ref("galio")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "deflect");
  assert.equal(requests[0].amount, 1);
  // The chooser pays (809.1.c.1: Power of any Domain), not the Deflect unit's controller.
  assert.equal(requests[0].payer, "A");
  assert.deepEqual(requests[0].target, kernel.ref("galio"));
});

test("unl-171-219 Galio, Indefatigable golden: an unpayable Deflect tax rejects the choice (809.1.d)", () => {
  const kernel = world().unit("galio", { might: 6 }).build();
  assert.throws(
    () => finalizeTargetPlan(
      kernel,
      { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
      {
        selected: [kernel.ref("galio")],
        tax: { kind: "deflect", amount: 1 },
        taxAdapter: { appendTargetTax: () => ({ status: "unpayable", reason: "no power available" }) }
      }
    ),
    error => error.code === "target-tax-unpayable"
  );
});

test.todo(
  "unl-171-219 Galio, Indefatigable: a producer that derives the Deflect tax from the permanent's target.tax continuous " +
    "effect and bills Power of any Domain at Finalize (809.1.c.1) — the merged tax-to-cost conversion bills Energy"
);
test.todo(
  "unl-171-219 Galio, Indefatigable: combat damage assignment that honours [Tank]'s lethal-first ordering " +
    "(815.1.b / 815.1.c.1) — combat/base-combat-allocation.ts binds no assignment priority"
);
test.todo(
  "unl-171-219 Galio, Indefatigable: a consumer for the \"does not contribute combat damage\" restriction so 467.2.a/.b " +
    "skip this unit's Might (no layer or combat path reads continuous.combat restrictions yet)"
);
