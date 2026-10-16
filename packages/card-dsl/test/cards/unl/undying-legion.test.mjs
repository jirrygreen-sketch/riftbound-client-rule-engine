import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/undying-legion.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-701096ccbd927a28227b5fb94975bd38a4de82f4f38aa3f6cbe2c6dbc8b1c977";
const SOURCE_TEXT =
  "[Legion][>] You may play me from your trash for :rb_energy_3::rb_rune_fury:. " +
  "(Get the effect if you've played another card this turn.)";

const [legion, play] = program.abilities;

test("unl-025-219 Undying Legion: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-025-219 Undying Legion: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // 812.1.b.1 / 812.1.c: the dependent-keyword gate is named with its rule.
  assert.match(program.judgeReason, /812\.1/);
  assert.match(program.judgeReason, /RIFT-82/);
  // 366.1 / 356.1.a: the trash play permission and alternate cost.
  assert.match(program.judgeReason, /366\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-025-219 Undying Legion: [Legion] is declared, not re-implemented", () => {
  assert.equal(program.abilities.length, 2);
  // 812.1.b.1: functionally "If you have played another card this turn, this
  // card gains [Text]." The gate belongs to the keyword expansion, so the card
  // must not flatten the dependent ability into an unconditional one.
  assert.deepEqual(legion, { kind: "keyword", keyword: "legion" });
  assert.equal(legion.value, undefined);
});

test("unl-025-219 Undying Legion: the [Text] body declares the trash play permission and its alternate cost", () => {
  assert.equal(play.kind, "play");
  // 356.1.a: "play me from your trash for [3][Fury]" replaces the base cost.
  assert.equal(play.cost.kind, "explicit");
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 3 });
  // The card prints no Power cost (catalog power: null); this Power component
  // belongs to the alternate cost and must never be written as 0.
  assert.deepEqual(play.cost.power, { kind: "constant", value: ["Fury"] });
  // 366.1 / 366.2.a / 420.1.a: the default valid zone is hand/champion zone, so
  // the ability carries its own trash permission as a restriction declaration.
  assert.equal(play.restriction.kind, "play-from-zone");
  assert.deepEqual(play.restriction.value, { kind: "constant", value: "trash" });
  // The [Text] is entirely the play permission; there is no resolution body.
  assert.deepEqual(play.body, []);
  assert.equal(play.requirements, undefined);
});

test("unl-025-219 Undying Legion golden: the printed alternate cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 3, power: ["Fury"] })
    .card("legion", { zone: "trash", types: ["unit"], owner: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("legion") });
  const plan = buildCostPlan(ctx, { id: "undying-legion", cost: play.cost });
  const receipt = payCostPlan(ctx, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 3);
  assert.equal(receipt.total.power.length, 1);
  assert.deepEqual(receipt.total.power[0].allowedDomains, ["Fury"]);
  assert.equal(ctx.player("A").energy, 0);
  assert.deepEqual(ctx.player("A").power, ["Fury"]);
});

test("unl-025-219 Undying Legion golden: an insufficient Fury Power pool cannot pay the alternate cost", () => {
  const kernel = world()
    .player("A", { energy: 3, power: ["Calm"] })
    .card("legion", { zone: "trash", types: ["unit"], owner: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("legion") });
  const plan = buildCostPlan(ctx, { id: "undying-legion", cost: play.cost });
  assert.throws(
    () => payCostPlan(ctx, plan),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(ctx.player("A").energy, 3);
  assert.deepEqual(ctx.player("A").power, ["Calm"]);
});

test.todo(
  "unl-025-219 Undying Legion: expand [Legion][>] (CR 812.1.b.1 'if you have played another card this turn, this" +
    " card gains [Text]') with the 812.1.c card-identity exclusion through condition.history / HistoryQuery" +
    " exclude (RIFT-82 plus the contract 3.8 history query landing)"
);
test.todo(
  "unl-025-219 Undying Legion: the printed trash play permission (CR 366.1 / 420.1.a) and the 356.1.a alternate" +
    " cost are consumed by Finalize legality and the cost plan (RIFT-89)"
);
