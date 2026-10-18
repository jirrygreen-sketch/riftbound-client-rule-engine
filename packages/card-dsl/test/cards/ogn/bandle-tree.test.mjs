// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/bandle-tree.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { buildHiddenCostPlan, payHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/hidden.js";

const [ability] = program.abilities;
const literal = (value) => ({ kind: "constant", value });

test("ogn-278-298 Bandle Tree: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("Bandle Tree original static declaration binds to this battlefield incarnation and unregisters", () => {
  const f = fixture({ cards: [{ id: "tree", types: ["battlefield"], might: null }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("tree"), to: "battlefield", location: { type: "battlefield", id: "tree-field" } });
  f.engine.advance();
  const source = f.kernel.getObject("tree");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.filter.objectId, "tree");
  assert.equal(entry.effect.filter.zoneEntryId, source.ref.zoneEntryId);
  assert.equal(entry.effect.effect.restriction, "facedown-zone-maximum-occupancy");
  assert.equal(entry.effect.effect.amount, 1);
  assert.equal(entry.effect.effect.location, "self");
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("ogn-278-298 Bandle Tree: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-278-298) carries this text verbatim.
  assert.equal(program.sourceText, "You may hide an additional card here.");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /Facedown Zone|facedown/i);
  assert.match(program.judgeReason, /107\.3\.c\/d/);
});

test("ogn-278-298 Bandle Tree: one static ability raising this battlefield's facedown limit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // CR 107.3.b / 107.3.b.1: the Facedown Zone has a maximum occupancy that can
  // be increased; "may hide" is a permission, not a chain instruction.
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "facedown-zone-maximum-occupancy");
  assert.equal(ability.effect.amount, 1);
  assert.equal(ability.effect.location, "self");
  // CR 190.6.a/190.6.d: the permission belongs to the battlefield's controller
  // (and to nobody while it is uncontrolled, 190.6.b).
  assert.equal(ability.condition, undefined);
});

test("ogn-278-298 Bandle Tree golden: the +1 Facedown Zone cap registers through continuous.restrict", () => {
  // CR 107.3.b.1: the declared permission is a numeric cap increase. The merged
  // continuous.restrict primitive registers it with mode "limit" and amount 1.
  const base = world().unit("bandle-tree", { types: ["battlefield"], zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("bandle-tree") });
  const run = runInstruction(
    restrict,
    {
      mode: literal("limit"),
      restriction: literal(ability.effect.restriction),
      amount: literal(ability.effect.amount),
      appliesTo: literal({ object: "self" })
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map((entry) => entry.duration), [{ type: "permanent" }]);
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const found = restrictions(registry, "facedown-zone-maximum-occupancy");
  assert.equal(found.length, 1);
  assert.equal(found[0].cap, true);
  assert.equal(found[0].amount, 1);
});

test.todo(
  "ogn-278-298 Bandle Tree: enforce the raised Facedown Zone maximum in the Hide action " +
    "(CR 422.1/422.2.a, 811.1.b) through the cost.hidden and occupancy consumers"
);

test.todo(
  "ogn-278-298 Bandle Tree: hiding an extra card must grant no discount and must not let cards " +
    "without Hidden be hidden (CR 422.2.a / 811.1.b)"
);

test("Bandle Tree Hidden plan still requests one any-domain Power", () => {
  // Planning/submission is supported; actual Power debit and the Hide action remain pending.
  for (const domain of ["Fury", "Chaos"]) {
    const initial = world().player("A", { energy: 4, power: [domain] })
      .unit("tree", { cardId: program.canonicalCardId, types: ["battlefield"] })
      .hand("hidden-card", { types: ["spell"], energy: 3, power: null, keywords: [{ id: "Hidden" }] }).build();
    const ctx = initial.clone({ sourceSnapshot: initial.getObject("hidden-card") });
    const plan = buildHiddenCostPlan(ctx, { id: "tree:hide-payment", mode: "hide", domains: [] });
    assert.equal(plan.total.energy, 0);
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }]);
    assert.deepEqual(plan.printed, { energy: 3, power: null });
    const receipt = payHiddenCostPlan(ctx, plan);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.events.map(event => event.action), ["pay"]);
    assert.equal(ctx.player("A").energy, 4);
    assert.deepEqual(receipt.actions[0].action.plan.power, [domain]);
    assert.equal(ctx.getObject("hidden-card").zone, "hand");
  }
});

test("Bandle Tree Hidden payment debits the required Power", { todo: "effects/testing/test-kernel.ts pay does not consume plan.power; outside card write scope (CR 357.2 / 811.1.b)" }, () => {
  const initial = world().player("A", { power: ["Chaos"] }).hand("hidden-card", { energy: 3, power: null }).build();
  const ctx = initial.clone({ sourceSnapshot: initial.getObject("hidden-card") });
  const plan = buildHiddenCostPlan(ctx, { id: "tree:power-debit", mode: "hide", domains: [] });
  assert.equal(payHiddenCostPlan(ctx, plan).paid, true);
  assert.deepEqual(ctx.player("A").power, []);
});
