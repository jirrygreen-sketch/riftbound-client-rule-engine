// Execution evidence for the merged slice (exhaust me + Draw 1) lives in the
// RIFT-689 parameterized template golden:
// test/cards/templates/activated-activated-effect-draw-689.test.mjs
// This file keeps validation, identity, verbatim text, the declared status and
// the key structure of the printed cost/restriction/body.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/prodigal-explorer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { describeActivate } from "../../../../engine-core/dist/programs/activate.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CARD_ID = "card.hash-0f2d2889821a45fbe61cc42c0f59fd9c445a9a0a9cab9d8af29603770ea28aff";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn " +
  "with spells or unit abilities.";
const [ability] = program.abilities;

test("sfd-199-221 Prodigal Explorer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-199-221 Prodigal Explorer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Each stated gap carries its v1.5 anchor and the merged evidence measured by
  // the RIFT-689 golden: the condition, the Restriction adapter, the Legend
  // Zone and the production activation path (assertCanControl).
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /412\.4/);
  assert.match(program.judgeReason, /754/);
  assert.match(program.judgeReason, /054\.2/);
  assert.match(program.judgeReason, /use-only-if/);
  assert.match(program.judgeReason, /needs a rules adapter/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /assertCanControl/);
  // 108.3 is the Champion Zone; the Legend Zone is 107.4 in v1.5.
  assert.doesNotMatch(program.judgeReason, /108\.3/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-199-221 Prodigal Explorer: one [Reaction]-speed activated ability exhausting the source", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  // 813.1.c.2 / 813.1.d: the printed [Reaction] on an ability is the Closed
  // State activation permission on any player's turn.
  assert.equal(ability.timing, "reaction");
  assert.equal(ability.cost.kind, "activated");
  assert.equal(ability.cost.energy, undefined);
  // 404.1.a / 415.5: the leading :rb_exhaust: is the cost "Exhaust me"; 415.4
  // requires the action to be completable.
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust", object: "self" }]);
});

test("sfd-199-221 Prodigal Explorer golden: the printed exhaust cost really locks a plan (415.5)", () => {
  // 404.1.a / 415.5: the leading :rb_exhaust: is the ability's cost. The plan
  // side is merged and really locks one exhaust action, exactly like the
  // RIFT-689 template golden (which plays the legend on the Board).
  const kernel = world()
    .player("A", { energy: 5 })
    .object("explorer", {
      cardId: CARD_ID,
      types: ["legend"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null,
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("explorer") });

  const plan = buildCostPlan(context, { id: "prodigal-explorer", cost: ability.cost });
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("explorer").exhausted, true);
});

test("sfd-199-221 Prodigal Explorer: a legend created on the chain cannot pay the exhaust cost (CR 107.4)", () => {
  // Live evidence for the legend-host gap in the judgeReason: the match builder
  // creates the legend as a chain token and never moves it into a Legend Zone,
  // so the merged cost payment rejects the exhaust (415.4/415.5) and no
  // activation can happen in the production layout.
  const kernel = world()
    .player("A", { energy: 5 })
    .object("explorer", {
      cardId: CARD_ID,
      types: ["legend"],
      zone: "chain",
      location: null,
      energy: null,
      power: null,
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("explorer") });
  assert.equal(context.getObject("explorer").zone, "chain");

  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "prodigal-explorer", cost: ability.cost })),
    (error) => error?.name === "CostPlanError" && error?.reason === "cannot-pay-cost"
  );
  assert.equal(context.getObject("explorer").exhausted, false);
});

test("sfd-199-221 Prodigal Explorer: the use-only-if restriction still has no rules adapter (054.2)", () => {
  // Live evidence for gap (2): the production description path fails closed on
  // the printed "Use only if" clause, so the 054.2 gate is not executable.
  assert.throws(
    () => translateRestriction(ability.restriction, "prodigal-explorer"),
    (error) => error.name === "ProgramBindingError" && /use-only-if needs a rules adapter/.test(error.message)
  );
  const kernel = world()
    .object("explorer", { cardId: CARD_ID, types: ["legend"], zone: "board", location: { type: "base", player: "A" }, energy: null, power: null })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => describeActivate(registry, kernel.getObject("explorer"), "A"),
    (error) => /use-only-if needs a rules adapter/.test(error.message)
  );
});

test("sfd-199-221 Prodigal Explorer: became-target history counting cannot answer the printed condition (754)", () => {
  // Live evidence for gap (1): TestWorld.history counts committed GameActions,
  // while became-target is a Chain timing point; choosing a target therefore
  // never shows up, and there is no "chosen with spells or unit abilities"
  // provenance dimension at all.
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("enemy-unit") });
  // A real selected target, recorded through the merged became-target emitter.
  context.setTargets("prodigal-explorer.unit", [context.ref("enemy-unit")]);

  assert.equal(context.targets("prodigal-explorer.unit").length, 1);
  assert.equal(context.history({ scope: "turn", timingPoint: "became-target" }), 0);
  assert.equal(context.history({ scope: "turn", timingPoint: "became-target", objectFilter: { controller: "opponent" } }), 0);
});

test("sfd-199-221 Prodigal Explorer: the printed 'use only if' clause stays a restriction", () => {
  const [ability] = program.abilities;
  assert.deepEqual(ability.restriction, {
    kind: "use-only-if",
    value: {
      kind: "constant",
      value: "chosen-enemy-units-or-gear-twice-this-turn-with-spells-or-unit-abilities"
    }
  });
});

test("sfd-199-221 Prodigal Explorer: the body is one unlinked Draw 1 for the controller", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [draw] = ability.body;
  assert.equal(draw.id, "prodigal-explorer.draw-1");
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
  assert.equal(draw.condition, undefined);
});
