import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/poro-snax.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d4f30fcce9c425fcfc0987d7d2692d637e171ebc5b18e435a74380d01a617c8a";
const SOURCE_TEXT =
  "When you play this, draw 1.\n:rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1.";

const [playTrigger, activated] = program.abilities;
const [playDraw] = playTrigger.body;
const [abilityDraw] = activated.body;

function poroWorld() {
  const base = world()
    .object("poro-snax", {
      name: "Poro Snax",
      cardId: CANONICAL,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: 1,
      might: null
    })
    .player("A", { energy: 1, power: ["Calm"] })
    .deck("top-card", { owner: "A" })
    .deck("next-card", { owner: "A" })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("poro-snax") });
}

test("sfd-046-221 Poro Snax: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-046-221 Poro Snax: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // judgeReason must name the real missing wiring, not a generic "not implemented".
  assert.match(program.judgeReason, /Play Effect|383\.4\.a/);
  assert.match(program.judgeReason, /TriggerRegistration|触发/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-046-221 Poro Snax structure: [When you play this] draw trigger, no [Equip] keyword (tags empty)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  // "When you play this" — the Play Effect filters on this card's own played event
  // (CR 383.4.a.1/.2); the printed card has no Equipment tag, so no Equip keyword.
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CANONICAL }
  });
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.body.length, 1);
  assert.equal(playDraw.id, "poro-snax.play-draw-1");
  assert.equal(playDraw.op, "effect.draw");
  assert.deepEqual(playDraw.args.amount, { kind: "constant", value: 1 });
  assert.equal(playDraw.targets, undefined);
  assert.equal(playDraw.picks, undefined);
  assert.equal(playDraw.linkedTo, undefined);
  // The card prints no keyword ability of its own (tags are empty, CR 150.1).
  assert.equal(program.abilities.some((ability) => ability.kind === "keyword"), false);
});

test("sfd-046-221 Poro Snax structure: the activated ability's printed cost and Draw 1 body (151/151.2, 377.1, 429.6)", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.restriction, undefined);
  // ":rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this:" — 1 energy + 1 Calm Power,
  // exhaust this (415.3.a/415.5) and kill this (429.2.a/429.6) as cost payments.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: ["Calm"] },
    payments: [
      { kind: "exhaust", object: "self" },
      { kind: "kill", object: "self" }
    ]
  });
  assert.equal(activated.body.length, 1);
  assert.equal(abilityDraw.id, "poro-snax.ability-draw-1");
  assert.equal(abilityDraw.op, "effect.draw");
  assert.deepEqual(abilityDraw.args.amount, { kind: "constant", value: 1 });
  assert.equal(abilityDraw.linkedTo, undefined);
});

test("sfd-046-221 Poro Snax golden: the printed activation cost is paid for real (energy, Calm Power, exhaust, kill)", () => {
  const kernel = poroWorld();
  const plan = buildCostPlan(kernel, { id: "cost:poro-snax", cost: activated.cost });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Calm"] }]);
  assert.deepEqual(
    plan.total.actions.map((action) => action.action.type),
    ["exhaust", "kill"]
  );

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.player("A").power, ["Calm"]);
  assert.equal(kernel.getObject("poro-snax").exhausted, true);
  // 429.1/429.2.a: the killed Gear left the Board for its owner's Trash.
  assert.equal(kernel.getObject("poro-snax").zone, "trash");
  assert.deepEqual(
    receipt.actions.map((action) => action.action.type),
    ["pay", "exhaust", "kill"]
  );
});

test("sfd-046-221 Poro Snax golden: the 'Draw 1.' halves draw exactly one card through effect.draw (414.1/414.3)", () => {
  // Play Effect half ("When you play this, draw 1.").
  const triggerKernel = poroWorld();
  const triggerOutcome = resolveChainBody(playTrigger.body, triggerKernel);
  assert.equal(triggerOutcome.status, "executed");
  assert.equal(triggerKernel.player("A").handSize, 1);
  assert.deepEqual(triggerOutcome.events.map((event) => event.action), ["draw"]);

  // Activated-ability half ("Kill this: Draw 1.") — same instruction body and the same
  // real effect.draw primitive, executed after the printed cost was paid.
  const activatedKernel = poroWorld();
  const plan = buildCostPlan(activatedKernel, { id: "cost:poro-snax-2", cost: activated.cost });
  assert.equal(payCostPlan(activatedKernel, plan).paid, true);
  const outcome = resolveChainBody(activated.body, activatedKernel);
  assert.equal(outcome.status, "executed");
  assert.equal(activatedKernel.player("A").handSize, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
  assert.equal(outcome.results[0].result.linkedValues.drawn, 1);
});

test("sfd-046-221 Poro Snax golden: an empty Main Deck draws nothing without inventing cards (414.4)", () => {
  const base = world()
    .object("poro-snax", {
      name: "Poro Snax",
      cardId: CANONICAL,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: 1,
      might: null
    })
    .player("A", { energy: 0, power: [] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("poro-snax") });
  const outcome = resolveChainBody(playTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.results[0].result.linkedValues.drawn, 0);
});

test("sfd-046-221 Poro Snax golden: the kill cost cannot be paid once the Gear already left the Board (415.5, 429.2.a)", () => {
  const kernel = poroWorld();
  assert.equal(kernel.perform({ type: "kill", object: kernel.ref("poro-snax") }).status, "done");
  assert.throws(
    () => payCostPlan(kernel, buildCostPlan(kernel, { id: "cost:poro-snax-3", cost: { kind: "activated", payments: [{ kind: "kill", object: "self" }] } })),
    /no longer in its selected zone|requires a controlled permanent/
  );
});

test.todo("sfd-046-221 Poro Snax: registering the Play Effect trigger (CR 383.4.a.1/.2) so 'When you play this, draw 1.' enters the chain needs the card-program -> TriggerRegistration wiring (contract 3.5, RIFT-120).");
test.todo("sfd-046-221 Poro Snax: resolving the activated ability through the chain so its 'Draw 1.' body runs inside the same Finalize/Resolve transaction needs the same RIFT-120 trigger/chain production wiring; the cost payment and the merged effect.draw bodies above are already executed for real.");
