import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hexplosives-expert.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-35388dd2b47ca5aff627f64dbadee600be5e2d4c7d1f00c2d412147b43679458";
const SOURCE_TEXT =
  ":rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: Play a Bomb gear token to a battlefield. " +
  "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)";

const [ability] = program.abilities;
const [chooseBattlefield, playBomb] = ability.body;
const FIELD = { type: "battlefield", id: "chosen-field" };
const OTHER_FIELD = { type: "battlefield", id: "other-field" };
const choiceKey = `${chooseBattlefield.id}/hexplosives-expert.battlefield`;

const locationWorld = () => world()
  .unit("first-marker", { location: FIELD })
  .unit("second-marker", { location: OTHER_FIELD })
  .base("base-unit")
  .build();

test("rad-141-167 Hexplosives Expert: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-141-167 Hexplosives Expert: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // cards README §2: distinguish location expressions from complete candidates.
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /judge-required/);
  assert.match(program.judgeReason, /Bomb|token definition/);
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /LocationState/);
});

test("rad-141-167 Hexplosives Expert: one Action-speed activated ability with the printed cost", () => {
  // 377.1 / 404.1.a / 415.5: 1 Energy, 1 [A] Power and Exhaust this.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  const [powerPayment, exhaustPayment] = ability.cost.payments;
  // 135.2.e.5.a: [A] is a single Power requirement payable with Power of any
  // Domain, so it is one requirement whose allowedDomains covers all six.
  assert.equal(powerPayment.kind, "power");
  assert.deepEqual(powerPayment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(powerPayment.allowedDomains, ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  assert.deepEqual(exhaustPayment, { kind: "exhaust", object: "self" });
  assert.equal(ability.restriction, undefined);
});

test("rad-141-167 Hexplosives Expert: body plays a Bomb gear token to a battlefield", () => {
  assert.equal(ability.body.length, 2);
  assert.equal(chooseBattlefield.op, "condition.value");
  assert.deepEqual(chooseBattlefield.args.value, {
    kind: "location",
    value: { kind: "choose", id: "hexplosives-expert.battlefield", filter: { type: "battlefield" } }
  });
  assert.equal(playBomb.id, "hexplosives-expert.play-bomb");
  assert.equal(playBomb.op, "effect.token");
  assert.deepEqual(playBomb.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBomb.args.amount, { kind: "constant", value: 1 });
  // 185.2.a / 440.2.c: a token that is "played" is created on the Chain and
  // then handed to the play action.
  assert.deepEqual(playBomb.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBomb.args.location, {
    kind: "linked-value", instructionId: chooseBattlefield.id, key: "value"
  });
  assert.deepEqual(playBomb.args.linkKey, { kind: "constant", value: "bombToken" });
  // 355.10.b: "to a battlefield" is a permission/restriction on the play
  // location, not a target, so there is no TargetSpec.
  assert.equal(playBomb.targets, undefined);
  assert.equal(playBomb.picks, undefined);
  assert.equal(playBomb.linkedTo, undefined);
  assert.equal(playBomb.condition, undefined);
});

test("rad-141-167 Hexplosives Expert: the printed [A] cost is payable with Power of any Domain", () => {
  // The supported half of the ability: 135.2.e.5.a lets [A] be paid by Power
  // of any Domain. Paying with a Body Power must satisfy it.
  const kernel = world()
    .player("A", { energy: 3, power: ["Body"] })
    .unit("ziggs", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("ziggs") });
  const plan = buildCostPlan(ctx, { id: "hexplosives-expert", cost: ability.cost });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["exhaust"]);

  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.player("A").energy, 2);
  assert.deepEqual(ctx.player("A").power, ["Body"]);
  assert.equal(ctx.getObject("ziggs").exhausted, true);
});

test("rad-141-167 Hexplosives Expert boundary: an unresolved Bomb request has empty receipts and no side effects", () => {
  const kernel = locationWorld();
  const objects = kernel.query({});
  const before = kernel.snapshot();
  kernel.setAnswers({ [choiceKey]: FIELD });
  const run = resolveChainBody(ability.body, kernel);

  // Preserve the receipt and state invariants while the token definition is
  // judge-required; these checks do not assert that an opcode is missing.
  assert.deepEqual(run.results.at(-1).result.events, []);
  assert.equal(run.linkedValues[`${playBomb.id}.bombToken.amount`], 0);
  assert.deepEqual(run.linkedValues[`${playBomb.id}.bombToken.objects`], []);
  assert.deepEqual(kernel.query({}), objects);
  assert.equal(kernel.query({}).filter(object => object.isToken).length, 0);
  assert.equal(kernel.events.length, 0);
  assert.deepEqual(kernel.snapshot(), before);
});

test.todo(
  "rad-141-167: add the CR 187.12 Bomb gear token definition (domainless Gear token with " +
    "[Deploy] and [Deathknell]) and expand those abilities before the token can execute"
);

test("rad-141-167 Hexplosives Expert golden: the original body publicly chooses a battlefield and binds the answer", () => {
  const kernel = locationWorld();
  const before = kernel.snapshot();
  assert.throws(() => resolveChainBody(ability.body, kernel), error => {
    assert.ok(error instanceof AwaitChoice);
    assert.deepEqual(error.request, {
      id: choiceKey, type: "mode", chooser: "A", visibility: "public", options: [FIELD, OTHER_FIELD]
    });
    return true;
  });
  assert.deepEqual(kernel.snapshot(), before);
  kernel.setAnswers({ [choiceKey]: OTHER_FIELD });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues[`${chooseBattlefield.id}.value`], OTHER_FIELD);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.pendingItems, []);
});

test("rad-141-167 Hexplosives Expert boundary: a base cannot answer the battlefield choice (355.10.b)", () => {
  const kernel = locationWorld();
  const before = kernel.snapshot();
  kernel.setAnswers({ [choiceKey]: { type: "base", player: "A" } });
  assert.throws(() => resolveChainBody(ability.body, kernel), /Invalid.*choice/i);
  assert.deepEqual(kernel.snapshot(), before);
});

test.todo(
  "rad-141-167: bind the Bomb definition's Deploy/Deathknell bodies (CR 830 / 808) and supply the complete " +
    "LocationState list, including otherwise unrepresented empty battlefields, to the LocationExpr choice (355.2.a)"
);
