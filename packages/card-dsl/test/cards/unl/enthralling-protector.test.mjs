import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/enthralling-protector.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-3c81d27035052bbf066d3d86c77c616e488c8b32a943ecf5eb24842c9c273080";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "Spend 2 XP: [Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)";
const SELF = "enthralling-protector.self";

const [hunt, activated] = program.abilities;
const [buffMe] = activated.body;
const targetSpec = buffMe.targets[0];

function protectorWorld(xp = 5, extra = () => {}) {
  const builder = world()
    .player("A", { xp })
    .unit("enthralling-protector", {
      controller: "A",
      location: { type: "battlefield", id: "bf-1" }
    });
  extra(builder);
  return builder.build();
}

/** Point the host/source identity at the unit under test (contract 3.6 "self"). */
function asHost(kernel) {
  return kernel.clone({
    source: kernel.ref("enthralling-protector"),
    sourceSnapshot: kernel.getObject("enthralling-protector")
  });
}

test("unl-162-219 Enthralling Protector: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-162-219 Enthralling Protector: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-162-219 Enthralling Protector: [Hunt] is declared as a bare keyword and expands through the merged KeywordDef (823)", () => {
  // 823.1.c.2: an omitted Hunt value means 1, so the card omits value and the
  // KeywordDef supplies the default (cards/README.md section 5: declare only).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });

  const registered = keywordDefinitionsById.get("Hunt");
  assert.ok(registered, "effects/keywords/Hunt.ts must be in the generated registry");
  assert.equal(registered.valued, true);
  // 823.2: granted Hunt values are summed.
  assert.equal(registered.stacking, "sum");
  const expanded = registered.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expanded.map(ability => ability.trigger.at), ["conquer", "hold"]);
  for (const ability of expanded) {
    assert.equal(ability.body[0].op, "effect.xp");
    // 823.1.c.2: omitted value = Hunt 1.
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 1 });
  }
});

test("unl-162-219 Enthralling Protector: 'Spend 2 XP:' is an action-speed activated ability whose base cost is 2 XP", () => {
  assert.equal(activated.kind, "activated");
  // 145.2: unit activated abilities run in the controller's Main Phase during an
  // Open State; no [Reaction] is printed.
  assert.equal(activated.timing, "action");
  // 404.1.a: the part before ":" is the base cost; 205 rules out reading the
  // spend as a plain effect because a Linked Effect follows.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
  });
  assert.equal(activated.restriction, undefined);
});

test("unl-162-219 Enthralling Protector: '[Buff] me' is one self-anchored effect.buff instruction", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(buffMe.id, "enthralling-protector.buff-me");
  // 427.1 / 702.2.a: place a Buff counter on the unit.
  assert.equal(buffMe.op, "effect.buff");
  assert.deepEqual(buffMe.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffMe.args.target, { kind: "constant", value: SELF });
  // 427.1 / 702.3.a: no per-target "may"; whether the counter is placed is up to
  // the already-buffed no-op rule inside the primitive.
  assert.equal(buffMe.args.chooseUpTo, undefined);
  assert.equal(buffMe.linkedTo, undefined);
  assert.equal(buffMe.picks, undefined);
  assert.deepEqual(targetSpec, {
    id: SELF,
    filter: { type: "unit", object: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-162-219 Enthralling Protector golden: the printed 2 XP cost is really paid through the merged cost pipeline (730.2)", () => {
  const kernel = protectorWorld(5);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("enthralling-protector") });
  const plan = buildCostPlan(scoped, { id: "cost:enthralling-protector", cost: activated.cost });

  assert.equal(plan.finalized, true);
  assert.equal(plan.total.xp, 2);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);

  const receipt = payCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "spend-xp"]);
  assert.equal(scoped.player("A").xp, 3);
});

test("unl-162-219 Enthralling Protector golden: fewer than 2 XP cannot pay the activation cost", () => {
  const kernel = protectorWorld(1);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("enthralling-protector") });
  const plan = buildCostPlan(scoped, { id: "cost:enthralling-protector", cost: activated.cost });

  assert.equal(plan.total.xp, 2);
  assert.throws(
    () => payCostPlan(scoped, plan),
    error => error instanceof CostPlanError && /Insufficient XP/.test(error.message)
  );
  // No partial payment: the transaction aborts before any action commits.
  assert.equal(scoped.player("A").xp, 1);
});

test("unl-162-219 Enthralling Protector golden: the body really places one Buff counter on the host (427.1 / 702.2.a)", () => {
  const kernel = asHost(protectorWorld(5));
  kernel.setTargets(SELF, [kernel.ref("enthralling-protector")]);
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enthralling-protector").buffs, 1);
  const buffed = outcome.linkedValues["enthralling-protector.buff-me.buffed"];
  assert.deepEqual(buffed, [{ id: "enthralling-protector", zoneEntryId: 1 }]);
  assert.equal(outcome.linkedValues["enthralling-protector.buff-me.buffedCount"], 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("unl-162-219 Enthralling Protector golden: a unit that already has a Buff is not Buffed again (702.3 / 702.3.a)", () => {
  const kernel = asHost(protectorWorld(5, builder => builder.unit("enthralling-protector", {
    controller: "A",
    might: 2,
    buffs: 1,
    location: { type: "battlefield", id: "bf-1" }
  })));
  kernel.setTargets(SELF, [kernel.ref("enthralling-protector")]);
  const outcome = resolveChainBody(activated.body, kernel);

  // 702.3.a / 427.1.c: the already-buffed unit stays a legal choice and is
  // simply not Buffed; the primitive reports the no-op as negated/skipped.
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("enthralling-protector").buffs, 1);
  assert.deepEqual(outcome.events, []);
});

test("unl-162-219 Enthralling Protector golden: a host that left the board makes the Buff ignored (359.3.e.6)", () => {
  const kernel = asHost(protectorWorld(5));
  const stale = kernel.ref("enthralling-protector");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(SELF, [stale]);
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "unl-162-219 Enthralling Protector: the [Hunt] expansion's conquer/hold trigger subscriptions entering the " +
    "chain through the CardProgram -> trigger pipeline adapter (823.1.b / 383.4.c-d) — RIFT-120 follow-up; " +
    "the KeywordDef, its effect.xp body, the 2 XP cost and the Buff body all execute for real above"
);
test.todo(
  "unl-162-219 Enthralling Protector: the CardProgram -> ChainDraft activation adapter that pays the declared " +
    "cost at Finalize and puts this activated ability on the chain (contract 3.5) — the cost is already paid " +
    "through the real cost pipeline above"
);
