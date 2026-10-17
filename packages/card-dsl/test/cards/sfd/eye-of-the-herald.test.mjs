// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/eye-of-the-herald.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-67da502bedfc109e81093202c4a30a43cf37ca8aada9f1460b33bee5c979fdae";
const SOURCE_TEXT =
  "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)";

const [equip] = program.abilities;

function controllerContext(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return filter => {
        const normalized = translateObjectFilter(filter);
        if (normalized.controller === "self") normalized.controller = target.controller;
        return target.query(normalized);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

/** Eye of the Herald as it sits on the Board; printed Might 0 stays 0. */
function eyeWorld() {
  const base = world()
    .object("eye-of-the-herald", {
      name: "Eye of the Herald",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: null,
      might: 0
    })
    .unit("ally", { might: 2 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("eye-of-the-herald") });
}

function expansionFor() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
}

test("sfd-153-221 Eye of the Herald: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-153-221 Eye of the Herald: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /Unsupported payment kind/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-153-221 Eye of the Herald: one valued Order Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.deepEqual(equip, { kind: "keyword", keyword: "equip", value: 1 });
});

test("sfd-153-221 Eye of the Herald: the merged Equip expansion is valid EffectIR for this card", () => {
  const expansion = expansionFor();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  assert.deepEqual(ability.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("sfd-153-221 Eye of the Herald golden: the merged attach body attaches the Gear and keeps Might 0", () => {
  const kernel = eyeWorld();
  const [expansion] = expansionFor();
  kernel.setTargets("equip-target", [kernel.ref("ally")]);
  const outcome = resolveChainBody(expansion.body, controllerContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("eye-of-the-herald").attachedTo, kernel.ref("ally"));
  // 150.1/150.2: the printed Might 0 is a real value, not "no value".
  assert.equal(kernel.getObject("eye-of-the-herald").might, 0);
  assert.equal(kernel.getObject("eye-of-the-herald").power, null);
  assert.deepEqual(outcome.events.map((event) => event.action), ["attach"]);
});

test("sfd-153-221 Eye of the Herald golden: a chosen Unit that left the Board is not re-attached (CR 359.3.e.6)", () => {
  const kernel = eyeWorld();
  const [expansion] = expansionFor();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");

  kernel.setTargets("equip-target", [stale]);
  const outcome = resolveChainBody(expansion.body, controllerContext(kernel));
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
  assert.equal(kernel.getObject("eye-of-the-herald").attachedTo, null);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["ally"]);
});

test("sfd-153-221 Eye of the Herald: the current cost reader rejects the printed Equip payment kind", () => {
  const [activation] = expansionFor();
  const kernel = eyeWorld();
  assert.throws(
    () => buildCostPlan(kernel.clone({ sourceSnapshot: kernel.getObject("eye-of-the-herald") }), {
      id: "eye-of-the-herald:equip",
      cost: activation.cost
    }),
    error => error.name === "CostPlanError" &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
});

test.todo(
  "sfd-153-221 Eye of the Herald: transmit the printed Order CostSpec through the keyword declaration " +
    "to the existing params.cost field and consume it in Equip.expand/activation (818.1.c.2/.3)"
);
