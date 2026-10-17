import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/ultrasoft-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0e1d827782e2bd5c511ab700781d7a29ff0550a164e043183998c20b7d09d1f2";
const SOURCE_TEXT =
  ":rb_exhaust:: Play two :rb_energy_1: :rb_might: Bird unit tokens with [Deflect]. " +
  "Use this ability only while I'm at a battlefield. " +
  "(Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [ability] = program.abilities;
const [playBirds] = ability.body;

test("unl-160-219 Ultrasoft Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-160-219 Ultrasoft Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-160-219 Ultrasoft Poro: exhaust-self cost, action speed and the battlefield-only restriction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 404.1.a / 415.5: the printed ":rb_exhaust:" is "exhaust me"; 145.2: no
  // [Reaction] is printed, so the ability is Action speed.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // "Use this ability only while I'm at a battlefield": a Restriction, kept
  // separate from Requirements (contract 3.1).
  assert.deepEqual(ability.restriction, { kind: "use-only-while-at-battlefield" });
});

test("unl-160-219 Ultrasoft Poro: two Bird tokens in play mode with no invented entry or location", () => {
  assert.equal(playBirds.id, "ultrasoft-poro.play-birds");
  assert.equal(playBirds.op, "effect.token");
  // 187.7: a 1 [M] Bird token is a domainless unit token with 1 Might, the Bird
  // tag and [Deflect]; the frozen definition table has no bird entry yet.
  assert.deepEqual(playBirds.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBirds.args.amount, { kind: "constant", value: 2 });
  // 185.2.a / 440.2.c: "Play ... token" creates on the chain, then plays it.
  assert.deepEqual(playBirds.args.mode, { kind: "constant", value: "play" });
  // 355.2: the legal location is chosen at Finalize by the play procedure; the
  // placeholder must not be read as "your base" or "the source's battlefield".
  assert.deepEqual(playBirds.args.locations, {
    kind: "constant",
    value: ["valid-location-for-play"]
  });
  assert.deepEqual(playBirds.args.choiceId, {
    kind: "constant",
    value: "ultrasoft-poro.token-location"
  });
  assert.equal(playBirds.args.location, undefined);
  assert.equal(playBirds.linkedTo, undefined);
  assert.equal(playBirds.targets, undefined);
  assert.equal(playBirds.picks, undefined);
});

test("unl-160-219 Ultrasoft Poro golden: the exhaust-self cost is really paid (415.5)", () => {
  const kernel = world()
    .player("A")
    .unit("ultrasoft-poro", {
      controller: "A",
      exhausted: false,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ultrasoft-poro") });
  const plan = buildCostPlan(scoped, { id: "cost:ultrasoft-poro", cost: ability.cost });

  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["exhaust"]);
  const receipt = payCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(scoped.getObject("ultrasoft-poro").exhausted, true);
});

test("unl-160-219 Ultrasoft Poro golden: an already-exhausted host cannot pay the exhaust cost (415.4)", () => {
  const kernel = world()
    .player("A")
    .unit("ultrasoft-poro", { controller: "A", exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ultrasoft-poro") });
  const plan = buildCostPlan(scoped, { id: "cost:ultrasoft-poro", cost: ability.cost });
  assert.throws(() => payCostPlan(scoped, plan), /ready controlled object/);
});

test.todo(
  "unl-160-219 Ultrasoft Poro: add the CR 187.7 1 [M] Bird token (domainless unit token, 1 Might, Bird tag, " +
    "[Deflect]) to the frozen effect.token definition table"
);
test.todo(
  "unl-160-219 Ultrasoft Poro: Finalize provides the legal play locations for two NEW Unit tokens (355.2 / 355.2.a) " +
    "instead of a caller-supplied closed location list — RIFT-90"
);
test.todo(
  "unl-160-219 Ultrasoft Poro: the battlefield-only Restriction is enforced at Finalize (305 / 146.1) — RIFT-90/120"
);
