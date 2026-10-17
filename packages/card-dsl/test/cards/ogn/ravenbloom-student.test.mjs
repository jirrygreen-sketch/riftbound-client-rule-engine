import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ravenbloom-student.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1e9496baf34c0f775ffe94233c00bca385044ae51ac57ce745999144f3493a9d";
const [ability] = program.abilities;

test("Ravenbloom Student program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play a spell, give me +1 :rb_might: this turn.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Ravenbloom Student structure: a card-played trigger filtered to a spell played by the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter.object, { type: "spell" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.trigger.once, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "ravenbloom-student.give-plus-1");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // "give me +1 [M]": the affected object is the ability source, not a chosen
  // target, so the instruction declares no TargetSpec.
  assert.equal(instruction.targets, undefined);
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

/** Real EventPipeline + ChainEngine harness (ogn/wraith-of-echoes shape). */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("ravenbloom", { owner: "A", controller: "A", might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .hand("spell", { owner: "A", types: ["spell"], energy: 0, power: null })
    .build();
  const decide = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "optional") return false;
    throw new Error(`Unexpected choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  engine.pipeline.registerTrigger({
    id: "ravenbloom-student",
    source: kernel.getObject("ravenbloom"),
    controller: "A",
    spec: ability.trigger,
    body: ability.body
  });
  return { engine, kernel };
}

function castSpell(engine, kernel) {
  // A real spell resolution ends with the chain emitting `card-played`
  // (chain/engine.ts, CR 383.4.a.1); the card's own subscription reacts to it.
  engine.execute({
    id: "cast-spell",
    controller: "A",
    source: kernel.getObject("spell"),
    kind: "spell",
    speed: "normal",
    body: [{ id: "noop", op: "effect.draw", args: { amount: { kind: "constant", value: 0 } } }],
    cost: { id: "spell:cost", cost: { energy: { kind: "constant", value: 0 } } }
  });
}

function settle(engine) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
}

const effectiveMight = (engine, kernel, id) => engine.layers.evaluate(kernel.ref(id)).might;

test("Ravenbloom Student golden: playing a spell gives the source +1 Might this turn", () => {
  const { engine, kernel } = fixture();
  castSpell(engine, kernel);
  settle(engine);

  // 383.4.a: the card-played timing point fires for the resolved spell and the
  // card's own subscription adds its ability to the chain.
  assert.equal(engine.pipeline.events.some(event => event.timingPoint === "card-played"), true);
  const entries = engine.layers.registry.snapshot();
  assert.equal(entries.length, 1);
  const [registration] = entries;
  // 478 / 478.1.a: arithmetic-layer Might modification with the end-of-turn
  // duration (317.1.a / 468.7.c), registered through ctx.addContinuous for
  // the ability source only.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.equal(registration.effect.filter.objectId, "ravenbloom");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(engine, kernel, "ravenbloom"), 3);
  // "give me" scopes the grant to the source: the enemy unit keeps its Might.
  assert.equal(effectiveMight(engine, kernel, "enemy"), 2);
});

test("Ravenbloom Student golden: the +1 Might expires in the end-of-turn cleanup", () => {
  const { engine, kernel } = fixture();
  castSpell(engine, kernel);
  settle(engine);
  assert.equal(effectiveMight(engine, kernel, "ravenbloom"), 3);

  assert.equal(engine.layers.expireAt("turn-end").length, 1);
  assert.equal(effectiveMight(engine, kernel, "ravenbloom"), 2);
});

test("Ravenbloom Student golden: an opponent's spell does not trigger the ability", () => {
  const { engine, kernel } = fixture();
  // The trigger is scoped to this ability's controller ("you play a spell",
  // filter.player: "self"). The chain's timing check admits only the turn
  // player's own cast in the main phase, so the opponent's card-played event
  // is published directly through the real pipeline: the subscription must
  // not react to an event whose player is not the registration controller.
  engine.pipeline.emit({
    timingPoint: "card-played",
    object: kernel.getObject("enemy"),
    player: "B"
  });

  assert.equal(engine.items.length, 0);
  assert.equal(engine.layers.registry.snapshot().length, 0);
  assert.equal(effectiveMight(engine, kernel, "ravenbloom"), 2);
});
