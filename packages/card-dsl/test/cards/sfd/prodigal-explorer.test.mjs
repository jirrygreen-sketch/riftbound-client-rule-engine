import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/prodigal-explorer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0f2d2889821a45fbe61cc42c0f59fd9c445a9a0a9cab9d8af29603770ea28aff";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn " +
  "with spells or unit abilities.";

const [activatedAbility] = program.abilities;
const [drawInstruction] = activatedAbility.body;

const legendWorld = ({ deck = [], energy = 0 } = {}) => {
  const builder = world().unit("prodigal-explorer", {
    types: ["legend"],
    location: { type: "base", player: "A" }
  });
  if (deck.length > 0) builder.deck(deck, { owner: "A" });
  const base = builder.build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("prodigal-explorer") });
  kernel.addPlayer("A", { energy });
  return kernel;
};

test("sfd-199-221 Prodigal Explorer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-199-221 Prodigal Explorer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /054\.2/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /use-only-if/);
  // became-target itself is merged now, so the reason must point at the
  // missing count/attribution dimensions instead of the timing point.
  assert.match(program.judgeReason, /became-target 时点已合入/);
  assert.match(program.judgeReason, /RIFT-259/);
});

test("sfd-199-221 Prodigal Explorer: a Reaction-speed activated ability exhausting the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activatedAbility.kind, "activated");
  // 813.1.c.2 / 813.1.d: the printed [Reaction] on an ability is the Closed
  // State activation permission for any player's turn.
  assert.equal(activatedAbility.timing, "reaction");
  assert.equal(activatedAbility.cost.kind, "activated");
  // 404.1.a / 415.5: the leading :rb_exhaust: is the cost "Exhaust me".
  assert.deepEqual(activatedAbility.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.deepEqual(activatedAbility.cost.energy, undefined);
});

test("sfd-199-221 Prodigal Explorer: 'Use only if you've chosen … twice this turn' is a restriction", () => {
  // 054.2: the printed "only" gate is kept as a Restriction, separate from the
  // cost (contract 3.1). The condition cannot be evaluated today (judgeReason).
  assert.deepEqual(activatedAbility.restriction, {
    kind: "use-only-if",
    value: {
      kind: "constant",
      value: "chosen-enemy-units-or-gear-twice-this-turn-with-spells-or-unit-abilities"
    }
  });
});

test("sfd-199-221 Prodigal Explorer: 'Draw 1.' is a single effect.draw for the controller", () => {
  assert.equal(activatedAbility.body.length, 1);
  assert.equal(drawInstruction.id, "prodigal-explorer.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  // 414.3: "Draw 1."; the drawer defaults to the ability controller (190.6.d).
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("sfd-199-221 Prodigal Explorer: the Draw 1 body really draws the controller's top card", () => {
  const kernel = legendWorld({ deck: ["top-card", "next-card"] });

  const outcome = resolveChainBody(activatedAbility.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["prodigal-explorer.draw-1", "executed"]
  ]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["next-card"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
});

test("sfd-199-221 Prodigal Explorer: -1 drawn when the deck is empty", () => {
  const kernel = legendWorld();

  const outcome = resolveChainBody(activatedAbility.body, kernel);

  // The body itself still executes; an empty deck draws nothing (414.4's Burn
  // Out handling belongs to the kernel/turn flow, not to this instruction).
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
});

test("sfd-199-221 Prodigal Explorer: the printed exhaust cost is charged for real", () => {
  const kernel = legendWorld({ deck: ["top-card"] });
  const plan = buildCostPlan(kernel, { id: "cost:prodigal-explorer", cost: activatedAbility.cost });

  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("prodigal-explorer").exhausted, true);
});

test.todo(
  "sfd-199-221 Prodigal Explorer: 'chosen enemy units and/or gear twice this turn with spells or unit " +
    "abilities' needs a turn-scoped count of 355.6/355.7 targeting events plus their spell/unit-ability " +
    "attribution (412.4/412.6, 754); became-target itself is merged, but HistoryQuery exposes only " +
    "scope/action/timingPoint/player/object/exclude/objectFilter and no attribution dimension"
);
test.todo(
  "sfd-199-221 Prodigal Explorer: the restriction needs a Finalize consumer for card Restrictions " +
    "(054.2); chain/engine.ts only tests conditions supplied by its caller"
);
test.todo(
  "sfd-199-221 Prodigal Explorer: a Legend has no Legend Zone in contract 3.6's ZoneId (CR 108.3), so the " +
    "cost's 'exhaust me' host cannot be bound in production"
);
test.todo(
  "sfd-199-221 Prodigal Explorer: chain.canAct (the contract 3.5 timing query) must read the merged " +
    "continuous.timing grants from the layers/rules registry (RIFT-259 query without a chain consumer) " +
    "before the printed [Reaction] permission is enforced"
);
