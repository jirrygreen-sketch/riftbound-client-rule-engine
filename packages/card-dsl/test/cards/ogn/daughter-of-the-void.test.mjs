// RIFT-654 template execution evidence: ../templates/activated-activated-effect-resources-654.test.mjs
// (printed [Reaction] + Exhaust cost through the real chain, plus the exhausted-source and
// no-invented-Domain [A] boundaries). The card stays judge-required for the Universal Power
// representation, the resource-use restriction and the Legend Zone asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/daughter-of-the-void.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d1376b95989d72f123c2e7fbde3eab74d70c047906b489ce0e076e7e25c757c2";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. Use only to play spells. " +
  "(Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;
const [add] = ability.body;

test("ogn-247-298 Daughter of the Void: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-247-298 Daughter of the Void: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // CR 135.2.e.5 / 163.2.b: [A] is Universal Power; the merged Domain union is
  // the closed six-domain set, so no executable value exists yet.
  assert.match(program.judgeReason, /Universal/);
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /use-only-to-play-spells/);
  assert.match(program.judgeReason, /430\.2/);
  assert.match(program.judgeReason, /107\.4/);
});

test("ogn-247-298 Daughter of the Void: [Reaction] activation with the printed Exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.c/813.1.d: [Reaction] on an ability is a Closed-State activation
  // permission; the card declares its own speed.
  assert.equal(ability.timing, "reaction");
  // 404.1.a / 415.5: the Exhaust symbol before ":" is the cost "Exhaust me".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // “Use only to play spells”: preserved as a restriction for review; the
  // merged chain has no resource-use consumer for this restriction.
  assert.deepEqual(ability.restriction, { kind: "use-only-to-play-spells" });
  assert.equal(ability.body.length, 1);
  assert.equal(add.id, "daughter-of-the-void.add-universal-power");
  assert.equal(add.op, "effect.resources");
  // [A] has no representable Domain; the descriptive "rainbow" spelling is
  // kept instead of silently choosing one of the six domains.
  assert.deepEqual(add.args, { power: { kind: "constant", value: ["rainbow"] } });
  assert.equal(add.linkedTo, undefined);
  assert.equal(add.targets, undefined);
  assert.equal(add.picks, undefined);
});

test("ogn-247-298 Daughter of the Void: the Exhaust cost is payable under the merged cost pipeline", () => {
  // Supported part: the printed :rb_exhaust: cost (415.5) is a real, payable
  // activated cost in cost/plan-values.ts + cost/payment.ts.
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("daughter", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("daughter")) });
  const plan = buildCostPlan(ctx, { id: "daughter-of-the-void", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.equal(ctx.player("A").energy, 3);
  assert.equal(ctx.object(ctx.ref("daughter")).exhausted, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
});

test.todo(
  "ogn-247-298: represent and spend Universal Power ([A], CR 163.2.b / 135.2.e.5.b) — the closed " +
    "Domain union and gain-power action have no universal value (contract change request)"
);

test.todo(
  "ogn-247-298: enforce “Use only to play spells” and reserve the resource for spell payment " +
    "(restriction consumption) plus the 430.3 Reaction-Add window during payment"
);


