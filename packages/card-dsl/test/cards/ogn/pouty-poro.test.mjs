import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pouty-poro.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)";

test("ogn-013-298 Pouty Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-013-298 Pouty Poro: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-013-298 Pouty Poro: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /taxSpecs\/appendTaxes/);
  // cost.pay / cost.modify and the target-tax planner are merged; the current
  // gap is the production binder plus Finalize/payment integration.
  assert.match(program.judgeReason, /chain\/engine\.ts/);
  assert.match(program.judgeReason, /Energy mandatoryAdditional/);
  assert.match(program.judgeReason, /any-domain Power CostPlan/);
  assert.ok(!/RIFT-360/.test(program.judgeReason));
  assert.match(program.judgeReason, /layer mapping/);
});

test("ogn-013-298 Pouty Poro: exactly one unvalued Deflect keyword ability", () => {
  // CR 809.1.b.3: the omitted X is presumed to be 1, so the card omits value and
  // the KeywordDef supplies the default.
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "deflect");
  assert.equal(keyword.value, undefined);
});

test("ogn-013-298 Pouty Poro: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "effects/keywords/Deflect.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("809.1.c"));
  assert.ok(registered.ruleRefs.includes("809.1.c.1"));
  // 809.2: granted Deflect values sum; the merged KeywordDef declares "sum".
  assert.equal(registered.stacking, "sum");
  // 809.1.b.3: the omitted value expands to the presumed Deflect 1 for this card.
  const [expansion] = deflect.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("ogn-013-298 Pouty Poro: the merged TargetPlan tax path appends the Deflect tax", () => {
  // This executes the merged target-plan API that 809.1.d routes the opener's
  // chosen target through: the Deflect tax is a Mandatory Additional Cost, so
  // choosing the Deflect permanent appends a tax request for the chooser.
  const kernel = world()
    .unit("pouty-poro", { might: 2, keywords: [{ id: "deflect", value: 1 }] })
    .build();
  const requests = [];
  const plan = finalizeTargetPlan(
    kernel,
    { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
    {
      selected: [kernel.ref("pouty-poro")],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: { appendTargetTax: request => { requests.push(request); return { status: "appended" }; } }
    }
  );

  assert.deepEqual(plan.selected, [kernel.ref("pouty-poro")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "deflect");
  assert.equal(requests[0].amount, 1);
  assert.equal(requests[0].payer, "A");
  assert.deepEqual(requests[0].target, kernel.ref("pouty-poro"));
});

test("ogn-013-298 Pouty Poro: an unpayable Deflect tax rejects the choice (CR 809.1.d)", () => {
  const kernel = world().unit("pouty-poro", { might: 2 }).build();
  assert.throws(
    () => finalizeTargetPlan(
      kernel,
      { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
      {
        selected: [kernel.ref("pouty-poro")],
        tax: { kind: "deflect", amount: 1 },
        taxAdapter: { appendTargetTax: () => ({ status: "unpayable", reason: "no power available" }) }
      }
    ),
    error => error.code === "target-tax-unpayable"
  );
});

test.todo(
  "Pouty Poro: an opponent's spell or ability that chooses me costs 1 additional Power payable with "
    + "any Domain (CR 809.1.c/809.1.c.1), derived from my target.tax continuous effect and charged at "
    + "Finalize — blocked because the merged static binder has no target.tax layer mapping, no producer "
    + "derives the Deflect tax from a permanent's target.tax effect, and the merged tax-to-cost "
    + "conversion still bills Energy in chain/engine.ts instead of consuming the any-domain Power CostPlan"
);
