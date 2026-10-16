import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hexplosives-expert.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-35388dd2b47ca5aff627f64dbadee600be5e2d4c7d1f00c2d412147b43679458";
const SOURCE_TEXT =
  ":rb_energy_1::rb_rune_rainbow:, :rb_exhaust:: Play a Bomb gear token to a battlefield. " +
  "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)";

const [ability] = program.abilities;
const [playBomb] = ability.body;

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
  // cards README §2: the judgeReason must name the missing token definition
  // and the location gap, with task numbers.
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /judge-required/);
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /RIFT-81/);
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
  assert.equal(ability.body.length, 1);
  assert.equal(playBomb.id, "hexplosives-expert.play-bomb");
  assert.equal(playBomb.op, "effect.token");
  assert.deepEqual(playBomb.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBomb.args.amount, { kind: "constant", value: 1 });
  // 185.2.a / 440.2.c: a token that is "played" is created on the Chain and
  // then handed to the play action.
  assert.deepEqual(playBomb.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBomb.args.location, {
    kind: "constant",
    value: { type: "battlefield", id: "battlefield-chosen-by-effect" }
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

test("rad-141-167 Hexplosives Expert: the Bomb token is negated by the merged primitive, never guessed", () => {
  // 187.12 defines the Bomb gear token with its own [Deploy] and [Deathknell]
  // abilities. effect.token's frozen definition table has no bomb entry and
  // documents that definitions requiring other abilities stay judge-required;
  // the golden locks that negative evidence instead of inventing a Bomb.
  const kernel = world().build();
  const run = runInstruction(token, playBomb.args, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked["bombToken.amount"], 0);
  assert.deepEqual(run.linked["bombToken.objects"], []);
  assert.equal(run.linked.bombToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({}).length, 0);
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "rad-141-167: add the CR 187.12 Bomb gear token definition (domainless Gear token with " +
    "[Deploy] and [Deathknell]) to the effect.token definition table — the frozen table stops " +
    "at recruit/sand-soldier/mech/reflection/tentacle and blocks ability-bearing definitions " +
    "(RIFT-81~91)"
);

test.todo(
  "rad-141-167: create the Bomb token on the Chain and hand it to the play action, then place it " +
    "at the chosen battlefield — needs the chain-create + play handoff (CR 440.2.c / 185.2.a / " +
    "350.2 / 354) and a controller-relative way to name the chosen legal battlefield (CR 355.2.a)"
);

test.todo(
  "rad-141-167: expand the Bomb token's [Deploy] (CR 830) and [Deathknell] (CR 808) abilities " +
    "once the keyword expansions are merged"
);
