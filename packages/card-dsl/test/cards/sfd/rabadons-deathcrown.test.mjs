// Golden test for Rabadon's Deathcrown (sfd-191-221).
//
// The catalog ability is [Unique] + [Equip] only; the merged Equip expansion's
// attach body is executed for real through the production interpreter adapter
// with a Finalize-locked target. The Unique deck constraint, the `equip` payment
// kind, the Equip cost binding and the CR 715.4 source-text discrepancy are the
// judged gaps (see judgeReason). Universal Power is representable by the
// six-domain allowedDomains payment plan.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rabadons-deathcrown.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createEngineStaticBinder, expandProgram } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  // The Equip payment kind and the ExpandInput params.cost binding are the
  // still-current dependencies; Universal Power is already represented by the
  // six-domain allowedDomains payment plan.
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /params\.cost/);
  // The [Unique] gap is now the missing keyword layer mapping / deckbuilding
  // consumer, not a missing continuous.deck primitive.
  assert.match(program.judgeReason, /continuous\.deck/);
  assert.match(program.judgeReason, /no layer mapping/);
});

test("sfd-191-221 Rabadon's Deathcrown: the merged binder rejects [Unique]'s continuous.deck shape (CR 825.3.a)", () => {
  // 825.3.a: a Unique deck holds only one card of the name. The instruction
  // primitive exists, but the card-side static binder has no layer mapping for
  // it, so a keyword would still be unrepresentable today.
  const { engine, kernel } = fixture({ cards: [{ id: "crown", cardId: CARD_ID, types: ["gear"], might: 3 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("crown"), to: "base", location: { type: "base", player: "A" } });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic({
      kind: "static",
      effect: { kind: "continuous.deck", mode: "max", name: "Rabadon's Deathcrown" }
    }, kernel.getObject("crown")),
    (error) => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /continuous\.deck has no layer mapping/);
      return true;
    }
  );
});

test("sfd-191-221 Rabadon's Deathcrown: the merged cost pipeline refuses the declared Equip payment kind (CR 818.1.b)", () => {
  const kernel = crownWorld();
  const context = bindResolveContext(kernel, { source: kernel.getObject("rabadons-deathcrown") });
  assert.throws(
    () => buildCostPlan(context, {
      id: "rabadons-equip-activation",
      cost: { payments: [{ kind: "equip", value: { kind: "source" } }] }
    }),
    (error) => {
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});

test("sfd-191-221 Rabadon's Deathcrown: expandProgram still stops on the unregistered Unique keyword (kw-unique)", () => {
  const kernel = crownWorld();
  assert.throws(
    () => expandProgram({ ...program, status: "executable", judgeReason: undefined }, kernel.getObject("rabadons-deathcrown")),
    (error) => {
      assert.match(error.message, /Keyword unique has no executable KeywordDef/);
      return true;
    }
  );
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
  // The declared ability list is exactly the two catalog lines: each entry is a
  // keyword declaration, so no Bonus Damage instruction was authored.
  assert.deepEqual(program.abilities.map((ability) => ability.kind), ["keyword", "keyword"]);
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
    "consumer; keywords/ registers 26 keywords and none of them is Unique, and contract 3.1/3.3 has no " +
    "deck-constraint semantics"
);

test.todo(
  "sfd-191-221 Rabadon's Deathcrown: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is " +
    "blocked on the `equip` payment kind in cost/plan-values.ts and on Equip.ts reading the printed cost from " +
    "ExpandInput params.cost (contract 3.8 item 3); the Universal Power portion is already representable via " +
    "six-domain allowedDomains"
);
