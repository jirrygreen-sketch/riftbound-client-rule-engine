// Golden test for Rabadon's Deathcrown (sfd-191-221).
//
// The catalog ability is [Unique] + [Equip] only; the merged Equip expansion's
// attach body is executed for real through the production interpreter adapter
// with a Finalize-locked target. The Unique deck constraint, the `equip` payment
// kind, the [A] Universal Power representation and the CR 715.4 source-text
// discrepancy are the judged gaps (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rabadons-deathcrown.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CARD_ID =
  "card.hash-963c1bf1475a7d2678d6b10353dd2919b09c2bac0c8a471f44fdf8d090a65c02";
const SOURCE_TEXT =
  "[Unique] (Your deck can have only 1 card with this name.)\n" +
  "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)";
const HOST = { canonicalCardId: CARD_ID };

const [unique, equip] = program.abilities;
const activation = keywordDefinitionsById.get("Equip").expand({ host: HOST })[0];

const crownWorld = () => world()
  .object("rabadons-deathcrown", {
    name: "Rabadon's Deathcrown",
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
  .unit("teemo", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
  .build();

/** Target re-verification uses the production matcher for the `controller` placeholder. */
const productionQuery = (kernel) => (filter) => kernel.objects.filter((object) => matchesObjectFilter(
  Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
  object
));

const runEquipBody = (chooseTarget) => {
  const kernel = crownWorld();
  const bound = bindResolveContext(kernel, {
    // ResolveContext.source is the source snapshot (effect.attach reads its .ref).
    source: kernel.getObject("rabadons-deathcrown"),
    sourceSnapshot: kernel.getObject("rabadons-deathcrown"),
    controller: "A",
    query: productionQuery(kernel)
  });
  kernel.setTargets("equip-target", chooseTarget ? [chooseTarget(kernel)] : []);
  return { kernel, outcome: resolveChainBody(activation.body, bound) };
};

test("sfd-191-221 Rabadon's Deathcrown: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-191-221 Rabadon's Deathcrown: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);

  assert.match(program.judgeReason, /715\.4/);
  assert.match(program.judgeReason, /Bonus Damage/);
  assert.match(program.judgeReason, /Unique/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("sfd-191-221 Rabadon's Deathcrown: the program keeps the catalog text and invents no Bonus Damage ability", () => {
  // The local catalog printing has exactly two lines. CR 715.4's example claims
  // "3 Bonus Damage from Rabadon's Deathcrown", which is a source-text
  // discrepancy reported in judgeReason — never silently added as an ability.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(unique, { kind: "keyword", keyword: "unique" });
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "rainbow");
  assert.equal(JSON.stringify(program.abilities).includes("bonus"), false);
  assert.equal(JSON.stringify(program.abilities).includes("continuous"), false);
});

test("sfd-191-221 Rabadon's Deathcrown: the merged Equip expansion is valid EffectIR for this identity", () => {
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

test("sfd-191-221 golden: the Equip body attaches the crown to a locked unit you control", () => {
  assert.deepEqual(activation.body[0].targets, [
    { id: "equip-target", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one" }
  ]);

  const attached = runEquipBody((kernel) => kernel.ref("teemo"));
  assert.equal(attached.outcome.status, "executed");
  assert.deepEqual(attached.kernel.getObject("rabadons-deathcrown").attachedTo, attached.kernel.ref("teemo"));
  assert.deepEqual(attached.outcome.events.map((event) => event.action), ["attach"]);

  const mistargeted = runEquipBody(null);
  assert.equal(mistargeted.outcome.results[0].result.status, "ignored");
  assert.equal(mistargeted.kernel.getObject("rabadons-deathcrown").attachedTo, null);
});

test.todo(
  "sfd-191-221 Rabadon's Deathcrown: resolve the source-text discrepancy before claiming executable semantics — " +
    "CR v1.5 715.4 (and v1.4's matching passage) describes 3 Bonus Damage from this card, while the local " +
    "deck-catalog printing (sfd-191-221) carries only [Unique] and [Equip]; an official errata/ruling (or a corrected " +
    "catalog entry) is required, and the Bonus Damage grant itself would still need 713/714 machinery"
);

test.todo(
  "sfd-191-221 Rabadon's Deathcrown: [Unique] (CR 825.1/825.3) needs a Unique KeywordDef and a continuous.deck " +
    "consumer; keywords/ registers 16 keywords and none of them is Unique, and contract 3.1/3.3 has no " +
    "deck-constraint semantics"
);

test.todo(
  "sfd-191-221 Rabadon's Deathcrown: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is " +
    "blocked on the `equip` payment kind in cost/plan-values.ts and on a contract representation for Universal Power " +
    "(CR 163.2.b; RIFT-89)"
);
