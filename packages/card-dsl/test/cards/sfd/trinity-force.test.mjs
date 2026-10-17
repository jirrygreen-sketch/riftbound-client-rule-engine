// RIFT-648 template execution evidence: ../templates/empty-648.test.mjs.
// The template rows play this Gear through the real chain and assert the
// printed-cost, target-restriction and Equip-payment boundaries; this file
// keeps validation, identity, the keyword structure and the merged
// effect.attach slice.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/trinity-force.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-e6073f232b1dbf7483b03684f042e36bd6c5692386fa16bce43630d890454681";
const SOURCE_TEXT =
  "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)";

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

test("sfd-115-221 Trinity Force: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-115-221 Trinity Force: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(typeof program.judgeReason, "string");
  // README section 2: the reason names the missing wiring and the concrete cost gap.
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /818\.1/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-115-221 Trinity Force: one Equip keyword declaration carrying the printed Body Power rune", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // Printed "Equip [Body]": one resource symbol, the Body Power rune; the
  // card-level 4 Energy play cost is not the Equip cost.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
});

test("sfd-115-221 Trinity Force golden: the merged Equip body attaches this gear to the chosen controlled unit", () => {
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
    .unit("trinity-force", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 4 })
    .build();
  // The activation host is the live gear instance; bind the resolver source to
  // it so effect.attach reads the real source reference.
  const bound = kernel.clone({
    source: kernel.ref("trinity-force"),
    sourceSnapshot: kernel.getObject("trinity-force")
  });
  bound.setTargets("equip-target", [bound.ref("ally")]);

  const outcome = resolveChainBody(activation.body, productionContext(bound));
  assert.equal(outcome.status, "executed");
  const [attachResult] = outcome.results;
  assert.equal(attachResult.op, "effect.attach");
  assert.equal(attachResult.result.status, "executed");
  assert.deepEqual(attachResult.result.linkedValues.attached, {
    count: 1,
    objects: [bound.ref("trinity-force")],
    host: bound.ref("ally")
  });
  assert.deepEqual(bound.getObject("trinity-force").attachedTo, bound.ref("ally"));
});

test.todo(
  "sfd-115-221 Trinity Force: paying the printed Equip cost (1 Body Power, CR 818.1.c) needs the \"equip\" cost-payment kind " +
    "and contract 3.8.3 params.cost so the printed rune reaches KeywordDef.expand " +
    "(programs/keywords.ts currently calls def.expand({ value, host }) without params)."
);
