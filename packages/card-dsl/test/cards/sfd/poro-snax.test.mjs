// Golden test for Poro Snax (sfd-046-221).
//
// Both printed abilities run end to end on merged paths:
// - "When you play this, draw 1." is a Play Effect (383.4.a.1/.2) whose
//   TriggerRegistration now comes from the merged card-program binding
//   (programs/triggers.ts, RIFT-257): the golden plays the Gear through the real
//   ChainEngine, the chain emits card-played, the trigger enters the chain and
//   its effect.draw body really draws the top card.
// - ":rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1." is an
//   activated ability (151/151.2, 377.1) whose printed 1 energy + 1 Calm Power,
//   exhaust and kill costs are paid by the merged cost pipeline (415.5, 429.2.a)
//   before its Draw 1 resolves.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/poro-snax.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d4f30fcce9c425fcfc0987d7d2692d637e171ebc5b18e435a74380d01a617c8a";
const SOURCE_TEXT =
  "When you play this, draw 1.\n:rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1.";

const [playTrigger, activated] = program.abilities;
const [playDraw] = playTrigger.body;
const [abilityDraw] = activated.body;

/** The real ChainEngine over the reference kernel, plus the card-program binding. */
function fixture({ energy = 5, power = ["Calm"], onBoard = false, deck = ["top-card", "next-card"] } = {}) {
  const builder = world()
    .player("A", { energy, power })
    .player("B", { energy: 5 });
  if (deck.length) builder.deck(deck, { owner: "A" });
  if (onBoard) {
    builder.object("poro-snax", {
      name: "Poro Snax",
      cardId: CANONICAL,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: ["Calm"],
      might: null,
      owner: "A",
      controller: "A"
    });
  } else {
    builder.hand("poro-snax", {
      name: "Poro Snax",
      cardId: CANONICAL,
      types: ["gear"],
      energy: 1,
      power: ["Calm"],
      owner: "A"
    });
  }
  const kernel = builder.build();
  const decide = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false, describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);
  return { engine, kernel, binding };
}

function resolveAll(engine) {
  let count = 0;
  while (engine.items.length) {
    if (++count > 50) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
}

const timings = (engine) => engine.pipeline.events.map((event) => event.timingPoint);

test("sfd-046-221 Poro Snax: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-046-221 Poro Snax: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
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

test("sfd-046-221 Poro Snax golden: playing the Gear fires the Play Effect and really draws 1 (383.4.a.2, 414.1)", () => {
  const { engine, kernel, binding } = fixture();

  const draft = binding.describePlay(
    { type: "play", object: kernel.ref("poro-snax"), player: "A" },
    kernel.getObject("poro-snax")
  );
  engine.execute({ ...draft, location: { type: "base", player: "A" } });
  engine.advance();
  resolveAll(engine);

  // The Gear resolved onto the Board and its card-played trigger really drew.
  assert.equal(kernel.getObject("poro-snax").zone, "board");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  const fired = timings(engine);
  assert.equal(fired.includes("card-played"), true);
  assert.equal(fired.includes("card-drawn"), true);
  // The Play Effect enters the chain as its own item after the permanent's Resolve.
  assert.equal(
    engine.trace.some((entry) => entry.step === "pending" && entry.item.startsWith("trigger:")),
    true
  );
});

test("sfd-046-221 Poro Snax golden: the printed activation cost is paid for real through the chain (energy, Calm Power, exhaust, kill)", () => {
  const { engine, kernel, binding } = fixture({ onBoard: true });

  const activation = binding.describeActivate(kernel.getObject("poro-snax"), "A", 0);
  // The program binding translates the printed cost verbatim (never coerced).
  assert.deepEqual(activation.cost.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: ["Calm"] },
    payments: [
      { kind: "exhaust", object: "self" },
      { kind: "kill", object: "self" }
    ]
  });
  assert.deepEqual(activation.cost.domains, ["Calm"]);

  engine.execute(activation);
  engine.advance();
  resolveAll(engine);

  // 377.1 / 415.5 / 429.2.a: resources were spent and the Gear left the Board.
  assert.equal(kernel.player("A").energy, 4);
  assert.equal(kernel.getObject("poro-snax").zone, "trash");
  // "Draw 1." really drew exactly one card (414.1/414.3).
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(kernel.player("A").handSize, 1);
  const fired = timings(engine);
  assert.equal(fired.includes("object-exhausted"), true);
  assert.equal(fired.includes("object-killed"), true);
  assert.equal(fired.includes("card-drawn"), true);
});

test("sfd-046-221 Poro Snax golden: paying the printed cost really exhausts and kills the Gear (415.5, 429.2.a)", () => {
  const { kernel } = fixture({ onBoard: true });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("poro-snax") });
  const plan = buildCostPlan(context, { id: "cost:poro-snax:kill", cost: activated.cost });
  const receipt = payCostPlan(context, plan);

  // 357.2: the nonstandard payments run in the declared order; both really
  // happened and the Gear reached its owner's Trash (429.2).
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust", "kill"]);
  assert.equal(receipt.total.energy, 1);
  assert.deepEqual(receipt.total.power, [{ amount: 1, allowedDomains: ["Calm"] }]);
  assert.equal(context.getObject("poro-snax").zone, "trash");
  assert.equal(context.player("A").energy, 4);
});

test("sfd-046-221 Poro Snax golden: an empty Main Deck draws nothing without inventing cards (414.4)", () => {
  const { kernel } = fixture({ onBoard: true, deck: [] });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("poro-snax") });
  const outcome = resolveChainBody(playTrigger.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(scoped.player("A").handSize, 0);
  assert.equal(outcome.results[0].result.linkedValues.drawn, 0);
});

test.todo(
  "sfd-046-221 Poro Snax: the printed [Action]-slot activation permission is the chain's own timing check " +
    "(151.2/377.3); no card-side wiring is missing. This TODO records that admission is owned by chain/canAct."
);

