// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
// Golden test for Forgefire Cape (sfd-190-221).
//
// The program declares two keyword identities (contract 3.1 / 3.7). The
// merge-verified half is the Equip expansion's attach body, executed through the
// production interpreter adapter with a Finalize-locked target. Unique's
// deck-constraint consumer, the `equip` payment kind and the [A] Universal Power
// representation are the judged gaps (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forgefire-cape.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID =
  "card.hash-f57b9ca8014fe44251722063cac371908fc07829fc257206b3c21b2c62f38d89";
const SOURCE_TEXT =
  "[Unique] (Your deck can have only 1 card with this name.)\n" +
  "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)";
const HOST = { canonicalCardId: CARD_ID };

const [unique, equip] = program.abilities;

const capeWorld = () => world()
  .object("forgefire-cape", {
    name: "Forgefire Cape",
    cardId: CARD_ID,
    types: ["gear"],
    tags: ["Ornn", "Equipment", "Signature"],
    keywords: [{ id: "Unique" }, { id: "Equip", value: 1 }],
    zone: "board",
    location: { type: "base", player: "A" },
    energy: 4,
    power: null,
    might: 3,
    controller: "A",
    owner: "A"
  })
  .unit("ally", { might: 3, location: { type: "battlefield", id: "battlefield-1" } })
  .build();

/**
 * Execute the merged Equip body with its Finalize-locked target. Target
 * re-verification runs the production matcher, which binds the contract's
 * `controller: "self"` placeholder to the ability controller; the reference
 * kernel compares that value literally and has no placeholder binding.
 */
const productionQuery = (kernel) => (filter) => kernel.objects.filter((object) => matchesObjectFilter(
  Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
  object
));

const runEquipBody = (chooseTarget) => {
  const kernel = capeWorld();
  const bound = bindResolveContext(kernel, {
    // ResolveContext.source is the source snapshot (effect.attach reads its .ref).
    source: kernel.getObject("forgefire-cape"),
    sourceSnapshot: kernel.getObject("forgefire-cape"),
    controller: "A",
    query: productionQuery(kernel)
  });
  kernel.setTargets("equip-target", chooseTarget ? [chooseTarget(kernel)] : []);
  return { kernel, outcome: resolveChainBody(activation.body, bound) };
};

const activation = keywordDefinitionsById.get("Equip").expand({ host: HOST })[0];

test("sfd-190-221 Forgefire Cape: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-190-221 Forgefire Cape: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);

  assert.match(program.judgeReason, /Unique/);
  assert.match(program.judgeReason, /825\./);
  assert.match(program.judgeReason, /163\.2\.b/);
  // The keyword registry now holds 27 keywords; Unique is still absent, so
  // the reason must not cite the stale count or an obsolete cost-task attribution.
  assert.match(program.judgeReason, /27 个关键词不含 Unique/);
  assert.match(program.judgeReason, /Keyword unique has no executable KeywordDef/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.doesNotMatch(program.judgeReason, /16 个关键词|25 个关键词/);
  // The dependency sentence lists gaps only; merged cost work is named as such.
  assert.doesNotMatch(program.judgeReason, /依赖：[^。]*RIFT-/);
});

test("sfd-190-221 Forgefire Cape: Unique declaration plus a valued rainbow-cost Equip", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(unique, { kind: "keyword", keyword: "unique" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c.2: one printed :rb_rune_rainbow: symbol.
  assert.equal(equip.value, 1);
  // [A] is Universal Power (135.2.e.5 / 163.2.b): recorded descriptively, never
  // narrowed to one of the six named domains.
  assert.equal(equip.costDomain, "rainbow");
  for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]) {
    assert.equal(equip.costDomain === domain, false);
  }
});

test("sfd-190-221 Forgefire Cape: the merged Equip expansion is valid EffectIR for this identity", () => {
  assert.deepEqual(
    keywordDefinitionsById.get("Equip").expand({ host: HOST }).map((ability) => ability.kind),
    ["activated"]
  );
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: keywordDefinitionsById.get("Equip").expand({ host: HOST }),
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("sfd-190-221 Forgefire Cape golden: the Equip body attaches the cape to a locked unit you control", () => {
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target restricted to units you control.
  assert.deepEqual(activation.body[0].targets, [
    { id: "equip-target", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one" }
  ]);
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);

  const attached = runEquipBody((kernel) => kernel.ref("ally"));
  assert.equal(attached.outcome.status, "executed");
  assert.deepEqual(attached.outcome.results.map((result) => [result.id, result.result.status]), [
    ["equip-attach", "executed"]
  ]);
  assert.deepEqual(attached.kernel.getObject("forgefire-cape").attachedTo, attached.kernel.ref("ally"));
  assert.deepEqual(attached.outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-190-221 Forgefire Cape golden: no locked target leaves the cape unattached (359.3.e.6/e.7)", () => {
  const mistargeted = runEquipBody(null);
  assert.equal(mistargeted.outcome.status, "partial");
  assert.equal(mistargeted.outcome.results[0].result.status, "ignored");
  assert.equal(mistargeted.outcome.results[0].result.reason, "mistargeted");
  assert.equal(mistargeted.kernel.getObject("forgefire-cape").attachedTo, null);
});

test.todo(
  "sfd-190-221 Forgefire Cape: [Unique] (CR 825.1/825.3 — a deck may contain only one card of a given name) needs " +
    "a Unique KeywordDef and a deck-constraint consumer; keywords/ registers 27 keywords and none of them is Unique " +
    "(expandProgram throws \"Keyword unique has no executable KeywordDef\"), and contract 3.1/3.3 has no " +
    "deck-constraint semantics (only the undefined deckbuilding?: DeckbuildingDecision[] shape)"
);

test.todo(
  "sfd-190-221 Forgefire Cape: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is blocked on " +
    "the `equip` payment binding in cost/plan-values.ts (the merged cost.pay / cost.modify kinds still reject it " +
    "with \"Unsupported payment kind: equip\") and on the missing Equip.ts params.cost binding; the [A] Universal Power " +
    "(CR 163.2.b) itself is still not representable by effect.resources / the closed Domain type"
);

test("sfd-190-221 Forgefire Cape: the production binding rejects the missing Unique KeywordDef", () => {
  // Evidence for gap (1): the registry refuses judge-required programs, so the
  // expansion path is exercised with the status lifted; expandProgram still
  // fails closed on the absent Unique KeywordDef.
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  assert.throws(
    () => binding.inspect(capeWorld().getObject("forgefire-cape")),
    /Keyword unique has no executable KeywordDef/
  );
});

test("sfd-190-221 Forgefire Cape: the merged cost pipeline still rejects the Equip payment kind", () => {
  assert.throws(
    () => buildCostPlan(capeWorld(), { id: "forgefire-cape.equip", cost: activation.cost }),
    (error) => {
      assert.ok(error instanceof CostPlanError);
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});
