import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/boots-of-swiftness.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0";
const SOURCE_TEXT =
  "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)";

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

test("sfd-133-221 Boots of Swiftness: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-133-221 Boots of Swiftness: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /params\.cost|3\.8\.3/);
  assert.match(program.judgeReason, /818\.1\.c/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-133-221 Boots of Swiftness: one Equip keyword declaration carrying the printed Chaos Power rune", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip [Chaos]": one resource symbol, the Chaos Power rune; the
  // card-level 3 Energy play cost is not the Equip cost.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Chaos");
});

test("sfd-133-221 Boots of Swiftness: the merged Equip body attaches this gear to the chosen controlled unit", () => {
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
    .unit("boots-of-swiftness", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 2 })
    .build();
  // The activation host is the live gear instance; bind the resolver source to
  // it so effect.attach reads the real source reference.
  const bound = kernel.clone({
    source: kernel.ref("boots-of-swiftness"),
    sourceSnapshot: kernel.getObject("boots-of-swiftness")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  const [attachResult] = outcome.results;
  assert.equal(attachResult.op, "effect.attach");
  assert.equal(attachResult.result.status, "executed");
  assert.deepEqual(attachResult.result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("boots-of-swiftness")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("boots-of-swiftness").attachedTo, bound.ref("ally"));
});

test.todo(
  "sfd-133-221 Boots of Swiftness: paying the printed Equip cost (1 Chaos Power, CR 818.1.c) needs an " +
    "\"equip\" cost-payment kind in cost/plan-values.ts and contract 3.8.3 params.cost so the printed rune " +
    "reaches KeywordDef.expand; the expansion's cost component is declared today and the cost plan rejects it"
);
test.todo(
  "sfd-133-221 Boots of Swiftness: the card-program -> keyword expansion -> chain wiring from contract 3.5 must register the Equip activated ability before the whole card is executable."
);
