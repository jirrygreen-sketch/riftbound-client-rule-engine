import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/glowstone.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damageDefinition from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { buildCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/index.js";

const CARD_ID = "card.hash-f4f95f0992a519e07673e9e9d3ea66ae5196b1e0be2c8a2847aa8697cfdccf53";
const SOURCE_TEXT =
  "[Empower] :rb_rune_rainbow::rb_rune_rainbow: (:rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
  "Disempower this, :rb_exhaust:: Choose a player. They gain control of this and recall it. (Send it to their base.)\n" +
  "At the end of your turn, kill this and deal 5 to all units you control.";

const [empower, activated, endOfTurn] = program.abilities;
const [giveControl, recall] = activated.body;
const [killThis, dealFive] = endOfTurn.body;

const glowstoneWorld = () => world()
  .unit("glowstone", {
    types: ["gear"],
    might: null,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .unit("ally", { might: 3 })
  .unit("bystander", { owner: "B", controller: "B", might: 3 })
  .build();

test("ven-133-166 Glowstone: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-133-166 Glowstone: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /Disempower/);
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /turn-end/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-133-166 Glowstone: Empower 2, and the Disempower/exhaust activation that hands control away", () => {
  assert.equal(program.abilities.length, 3);
  // 827.1.c: the printed Empower cost is two [A]. The cost plan supports it via
  // six allowedDomains; keyword expansion and cost binding remain blocked.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 2 });

  // 443.2.a Disempower + 415.3.a/415.5 exhaust are the printed costs.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [
      { kind: "disempower", object: "self" },
      { kind: "exhaust", object: "self" }
    ]
  });

  // 127 / 191: take-control of this Gear by the chosen player. The "They" seat has
  // no authorable player selector (the frozen ObjectSelector only covers objects),
  // so it is a clearly-labelled placeholder, not a fabricated real PlayerId.
  assert.equal(giveControl.op, "effect.control");
  assert.deepEqual(giveControl.args.objects, { kind: "constant", value: "source" });
  assert.deepEqual(giveControl.args.player, { kind: "constant", value: "chosen-player" });
  assert.equal(giveControl.targets, undefined);

  // 457/458: "recall it" is a Recall, never a Move; effect.move's recall mode
  // fails closed with a blockedReason and must not be approximated.
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.linkedTo, "glowstone.give-control");
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.objects, {
    kind: "constant",
    value: "source"
  });
});

test("ven-133-166 Glowstone: the end-of-turn trigger kills itself and deals 5 to a non-target set", () => {
  // 317.1.a / 190.6.d: "At the end of your turn" is the controller's turn-end.
  assert.equal(endOfTurn.kind, "triggered");
  assert.equal(endOfTurn.optional, false);
  assert.deepEqual(endOfTurn.trigger, {
    at: "turn-end",
    filter: { event: "turn-end", player: "self" }
  });

  // 429.1: "kill this" — the merged effect.kill self form.
  assert.equal(killThis.op, "effect.kill");
  assert.deepEqual(killThis.args, { self: { kind: "constant", value: true } });
  assert.equal(killThis.targets, undefined);

  // 355.10.d: "all units you control" is programmatically selected, never chosen,
  // so it is NOT a target and no TargetSpec may be declared (355.7 / 754).
  assert.equal(dealFive.op, "effect.damage");
  assert.deepEqual(dealFive.args.amount, { kind: "constant", value: 5 });
  assert.equal(dealFive.targets, undefined);
  assert.equal(dealFive.picks, undefined);
  // The intended set is recorded with the merged query descriptor shape (the same
  // device ogn/flurry-of-blades uses); effect.damage has no set form yet.
  assert.deepEqual(dealFive.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", zone: "board", controller: "self" }
    }
  });
});

test("ven-133-166 Glowstone golden: the end-of-turn kill really moves this Gear to the trash", () => {
  const kernel = glowstoneWorld();
  const bound = kernel.clone({
    source: kernel.ref("glowstone"),
    sourceSnapshot: kernel.getObject("glowstone")
  });

  const outcome = resolveChainBody([killThis], bound);

  assert.equal(outcome.status, "executed");
  // The kill moves the Gear to the trash (124: the zone entry changes), so the
  // receipt names the pre-kill identity while the object is now a new one.
  const killed = outcome.results[0].result.linkedValues.killed;
  assert.equal(killed.length, 1);
  assert.equal(killed[0].id, "glowstone");
  assert.equal(killed[0].zoneEntryId, 1);
  assert.equal(bound.ref("glowstone").zoneEntryId, 2);
  assert.equal(bound.getObject("glowstone").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
});

test("ven-133-166 Glowstone golden: the printed 5 damage really lands on every selected friendly unit", () => {
  const kernel = glowstoneWorld();
  // The non-target set is supplied by the caller (the DSL has no damage-set form
  // yet), so the run proves the printed amount is exactly 5 and stays inside the
  // set: the enemy bystander is untouched.
  const run = runInstruction(
    damageDefinition,
    { amount: { kind: "constant", value: 5 }, target: "glowstone.friendly-units" },
    {
      world: kernel,
      targets: { "glowstone.friendly-units": [kernel.ref("ally")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").damage, 5);
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.equal(run.result.linkedValues.dealt, 5);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("ven-133-166 Glowstone: the cost plan allocates the printed two [A] from same or mixed Domains", () => {
  const allowedDomains = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
  for (const power of [...allowedDomains.map(domain => [domain, domain]), ["Fury", "Order"]]) {
    const base = world()
      .player("A", { energy: 0, power })
      .unit("glowstone", { types: ["gear"], might: null })
      .build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("glowstone") });
    // Verify only the printed resource component, without inventing an
    // Empower expansion or pretending its activation restriction is supported.
    const plan = buildCostPlan(kernel, {
      id: "glowstone-empower-resource-component",
      cost: {
        kind: "activated",
        payments: [{ kind: "power", amount: { kind: "constant", value: empower.value }, allowedDomains }]
      }
    });
    assert.deepEqual(plan.total.power, [{ amount: 2, allowedDomains }]);
    const payment = prepareCostPayment(kernel, plan);
    assert.deepEqual(payment.actions[0].action.plan.power, power);
  }
});

test.todo(
  "ven-133-166 Glowstone: the printed Empower cost of two :rb_rune_rainbow: (Universal Power [A], CR 135.2.e.5.a/163.2.b) " +
    "needs an Empower/Empowered KeywordDef and activation-cost binding (827.1.c.1); [A] resource allocation itself " +
    "is supported by kind:power with six allowedDomains"
);
test.todo(
  "ven-133-166 Glowstone: paying \"Disempower this\" (CR 443.2/443.2.a) needs the disempower payment kind in " +
    "cost/plan-values.ts readCost"
);
test.todo(
  "ven-133-166 Glowstone: \"Choose a player. They gain control of this and recall it\" needs a select-player form " +
    "(the frozen ObjectSelector only covers objects and no registry opcode selects a player) and a real Recall action — " +
    "effect.move's recall mode is explicitly blocked (CR 457-460)"
);
test.todo(
  "ven-133-166 Glowstone: the \"deal 5 to all units you control\" set needs a non-target set form for " +
    "effect.damage (CR 355.10.d); the turn-end trigger point itself is merged (programs/triggers.ts)"
);
