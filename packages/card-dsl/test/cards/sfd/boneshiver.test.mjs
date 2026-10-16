import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/boneshiver.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)";

const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

const equipActivation = () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const [activation] = definition.expand({
    value: program.abilities[0].value,
    host: { canonicalCardId: CARD_ID }
  });
  return activation;
};

test("sfd-118-221 Boneshiver: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-118-221 Boneshiver: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-118-221 Boneshiver: one Equip keyword declaration carrying the printed 1 Energy + Body Power runes", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip [1][Body]": two resource symbols (1 Energy + 1 Body Power);
  // the card-level 3 Energy play cost is not the Equip cost.
  assert.equal(equip.value, 2);
  assert.equal(equip.costDomain, "Body");
});

test("sfd-118-221 Boneshiver: the merged Equip body attaches this gear to the chosen controlled unit", () => {
  const activation = equipActivation();
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [activation],
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues, null, 2));

  const kernel = world()
    .unit("boneshiver", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 3 })
    .build();
  // The activation host is the live gear instance; bind the resolver source to
  // it so effect.attach reads the real source reference.
  const bound = kernel.clone({
    source: kernel.ref("boneshiver"),
    sourceSnapshot: kernel.getObject("boneshiver")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  const [attachResult] = outcome.results;
  assert.equal(attachResult.op, "effect.attach");
  assert.equal(attachResult.result.status, "executed");
  assert.deepEqual(attachResult.result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("boneshiver")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("boneshiver").attachedTo, bound.ref("ally"));
});

test.todo(
  "sfd-118-221 Boneshiver: paying the printed Equip cost (1 Energy + 1 Body Power, CR 818.1.c) needs the \"equip\" cost-payment kind in " +
    "cost/plan-values.ts (RIFT-89 cost-payment batch) and contract 3.8.3 params.cost so the printed runes reach KeywordDef.expand."
);
test.todo(
  "sfd-118-221 Boneshiver: the card-program -> keyword expansion -> chain wiring from contract 3.5 must register the Equip activated ability before the whole card is executable."
);
