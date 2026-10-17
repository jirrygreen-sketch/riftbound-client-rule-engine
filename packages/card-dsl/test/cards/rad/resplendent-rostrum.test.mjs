import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/resplendent-rostrum.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { AwaitChoice } = await import(new URL("effects/contract.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));

const CANONICAL = "card.hash-3fbe07d45b81cd1a97249fa165c6aa18b0f3350d24e4eaf06e090a22035f70d4";
const [activated, triggered] = program.abilities;
const [drawOne, channelOne] = activated.body;
const grantMight = triggered.body[0];

const constant = (value) => ({ kind: "constant", value });

/** Drives one ability body through the real ChainEngine (Finalize + Resolve). */
function fixture(kernel) {
  const choose = (request) => {
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects, perform: (action) => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

function drain(engine) {
  let passes = 0;
  while (engine.items.length) {
    if (++passes > 20) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
}

test("rad-046-167 Resplendent Rostrum: program passes validateCardProgram and keeps the catalog text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Draw 1 and channel 1 rune exhausted.\n" +
      "When I become exhausted, give a friendly unit +3 :rb_might: this turn."
  );
});

test("rad-046-167 Resplendent Rostrum: executable with no judgeReason", () => {
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
});

test("rad-046-167 Resplendent Rostrum: exhaust-costed activated ability with Draw 1 and channel 1 exhausted", () => {
  assert.equal(program.abilities.length, 2);

  // The printed ":rb_exhaust:" is the whole activation cost (415.3/415.3.a is
  // the Limited-Action description; the cost itself is the merged cost planner's
  // nonstandard "exhaust" payment, CostSpec.kind "activated"). No Energy/Power
  // is printed on this ability.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust" }]
  });
  assert.equal(activated.restriction, undefined);

  assert.deepEqual(activated.body.map((instruction) => instruction.id), [
    "resplendent-rostrum.draw-1",
    "resplendent-rostrum.channel-1"
  ]);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(channelOne.op, "effect.channel");
  assert.deepEqual(channelOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelOne.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelOne.linkedTo, "resplendent-rostrum.draw-1");
});

test("rad-046-167 Resplendent Rostrum: the become-exhausted trigger grants +3 Might for the turn", () => {
  assert.equal(triggered.kind, "triggered");
  // CR 415.1/415.1.c: becoming Exhausted is the merged "object-exhausted"
  // timing point; "I" scopes it to the source (415.2 makes the state readable).
  assert.equal(triggered.trigger.at, "object-exhausted");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-exhausted",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  assert.equal(grantMight.id, "resplendent-rostrum.grant-might");
  // RIFT-258 merged the card-facing continuous.might instruction; `objects`
  // carries the Finalize-locked TargetSpec through the chain interpreter.
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "resplendent-rostrum.unit" }
  });
  assert.equal(grantMight.args.target, undefined);
  assert.deepEqual(grantMight.targets, [
    {
      id: "resplendent-rostrum.unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grantMight.picks, undefined);
});

test("rad-046-167 Resplendent Rostrum golden: the activated body draws 1 and channels 1 rune exhausted", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .rune(["rune-1", "rune-2"])
    .build();
  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["resplendent-rostrum.draw-1", "executed"],
      ["resplendent-rostrum.channel-1", "executed"]
    ]
  );
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
  // CR 431.1/431.2: the printed exhausted stipulation is passed to the action.
  assert.equal(outcome.linkedValues["resplendent-rostrum.channel-1.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["rune-1"]);
});

test("rad-046-167 Resplendent Rostrum golden: the activated ability pays the exhaust cost and channels exhausted", () => {
  const kernel = world().player("A", { energy: 0 })
    .unit("resplendent-rostrum", {
      types: ["gear"], might: null, energy: 8, power: ["Calm"], zone: "board",
      location: { type: "base", player: "A" }
    })
    .deck(["top-card"])
    .rune(["rune-1"])
    .build();
  const engine = fixture(kernel);

  engine.execute({
    id: "resplendent-rostrum:activate", controller: "A",
    source: kernel.getObject("resplendent-rostrum"), kind: "activated", speed: "action",
    cost: { id: "resplendent-rostrum:cost", cost: activated.cost },
    body: activated.body
  });
  drain(engine);

  // 415.5: the [E] payment really exhausted the Gear as a cost.
  assert.equal(kernel.getObject("resplendent-rostrum").exhausted, true);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
  // 431.2: the printed "exhausted" stipulation is passed to the channel action
  // (the reference kernel records the committed action; the production kernel
  // applies the entry state).
  const channelAction = kernel.stateForTest().history
    .map((entry) => entry.action)
    .find((action) => action.type === "channel-rune");
  assert.deepEqual(channelAction, { type: "channel-rune", player: "A", amount: 1, exhausted: true });
  assert.deepEqual(kernel.events.map((event) => event.action).filter(Boolean), ["pay", "exhaust", "draw", "channel-rune"]);
});

test("rad-046-167 Resplendent Rostrum golden: the trigger grants +3 Might this turn through the merged layers", () => {
  const kernel = world()
    .unit("resplendent-rostrum", {
      types: ["gear"], might: null, energy: 8, power: ["Calm"], zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 2, zone: "board" })
    .build();
  const engine = fixture(kernel);

  engine.enqueue({
    id: "trigger:resplendent-rostrum", controller: "A",
    source: kernel.getObject("resplendent-rostrum"), kind: "triggered", body: triggered.body
  });
  engine.advance();
  drain(engine);

  const registration = engine.layers.registry.snapshot();
  assert.equal(registration.length, 1);
  assert.equal(registration[0].effect.layer, "arithmetic");
  assert.equal(registration[0].effect.effect.kind, "continuous.might");
  assert.equal(registration[0].effect.effect.amount, 3);
  assert.deepEqual(registration[0].duration, { type: "end-of-turn" });

  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 5);

  // 317.2.c: the grant expires with the end-of-turn batch.
  engine.emit({ timingPoint: "turn-end" });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
});

test.todo(
  "rad-046-167 Resplendent Rostrum: the object-exhausted trigger firing from the real exhaust action " +
    "and the CardProgram -> TriggerRegistration wiring (RIFT-120); the golden enqueues the card's own " +
    "trigger body through the real ChainEngine above"
);
test.todo(
  "rad-046-167 Resplendent Rostrum: data issue — the official RAD-046/167 image shows a GEAR " +
    "(green banner) reading 'When this becomes exhausted, ...', while " +
    "packages/card-data/data/deck-catalog.json records cardType 'Spell' and 'When I become " +
    "exhausted'; reported by this task, not edited here"
);
