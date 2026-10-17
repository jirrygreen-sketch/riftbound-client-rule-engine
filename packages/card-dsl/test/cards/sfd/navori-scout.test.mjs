import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/navori-scout.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-c75d6f4a1bbeb87090ae0f7135aac4f6a4f1062063662b9ccae6fe99f1c9bc7d";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)";

const [keyword] = program.abilities;

test("sfd-037-221 Navori Scout: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-037-221 Navori Scout: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-037-221 Navori Scout: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /Energy/);
  assert.match(program.judgeReason, /any-Domain Power/);
});

test("sfd-037-221 Navori Scout: exactly one unvalued Deflect keyword ability", () => {
  // 809.1.b.3: the omitted X is presumed to be 1, so the card omits value and
  // the KeywordDef supplies the default.
  assert.equal(program.abilities.length, 1);
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "deflect");
  assert.equal(keyword.value, undefined);
});

test("sfd-037-221 Navori Scout: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "effects/keywords/Deflect.ts must be in the generated registry");
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("809.1.c"));
  assert.ok(registered.ruleRefs.includes("809.1.c.1"));
  // 809.2: granted Deflect values sum; the merged KeywordDef declares "sum".
  assert.equal(registered.stacking, "sum");
  // 809.1.b.3: the omitted value expands to the presumed Deflect 1 for this card.
  const [expansion] = deflect.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("sfd-037-221 Navori Scout: the merged TargetPlan tax path appends the Deflect tax", () => {
  // This executes the merged target-plan API that 809.1.d routes the opener's
  // chosen target through: the Deflect tax is a Mandatory Additional Cost, so
  // choosing the Deflect permanent appends a tax request for the chooser.
  const kernel = world()
    .unit("navori-scout", { might: 4, keywords: [{ id: "deflect", value: 1 }] })
    .build();
  const requests = [];
  const plan = finalizeTargetPlan(
    kernel,
    { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
    {
      selected: [kernel.ref("navori-scout")],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: {
        appendTargetTax: request => {
          requests.push(request);
          return { status: "appended" };
        }
      }
    }
  );

  assert.deepEqual(plan.selected, [kernel.ref("navori-scout")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "deflect");
  assert.equal(requests[0].amount, 1);
  assert.equal(requests[0].payer, "A");
  assert.deepEqual(requests[0].target, kernel.ref("navori-scout"));
});

test("sfd-037-221 Navori Scout: an unpayable Deflect tax rejects the choice (CR 809.1.d)", () => {
  const kernel = world().unit("navori-scout", { might: 4 }).build();
  assert.throws(
    () =>
      finalizeTargetPlan(
        kernel,
        { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
        {
          selected: [kernel.ref("navori-scout")],
          tax: { kind: "deflect", amount: 1 },
          taxAdapter: {
            appendTargetTax: () => ({ status: "unpayable", reason: "no power available" })
          }
        }
      ),
    error => error.code === "target-tax-unpayable"
  );
});

test.todo(
  "sfd-037-221 Navori Scout: an opponent's spell or ability that chooses me costs 1 additional " +
    "Power payable with any Domain (CR 809.1.c/809.1.c.1), derived from my target.tax continuous " +
    "effect and charged at Finalize — blocked because no producer derives the Deflect tax from a " +
    "permanent's target.tax effect (RIFT-90), and chain/engine.ts still books the tax as an " +
    "Energy constant instead of any-Domain Power (809.1.c.1)"
);
