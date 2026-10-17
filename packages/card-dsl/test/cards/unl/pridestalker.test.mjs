import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/pridestalker.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0498072c7fa1411e598b868d1675b34cf40890cde5ab313bf5598e1fcf1f08eb";
const SOURCE_TEXT = "When you play a unit, give a unit +1 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;
const targetSpec = grantMight.targets[0];

test("unl-183-219 Pridestalker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-183-219 Pridestalker: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason names the remaining Legend lifecycle gap.
  assert.match(program.judgeReason, /Legend/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+|没有 continuous\.might/);
});

test("unl-183-219 Pridestalker: mandatory card-played trigger on a friendly unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4: an ability that triggers when another object is played is not a
  // Play Effect, so the timing point is the card-played event with a unit
  // object filter controlled by the ability's controller.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // No printed "may": the trigger is mandatory (383.3.a).
  assert.equal(ability.optional, false);
});

test("unl-183-219 Pridestalker: 'give a unit +1 Might this turn' is one chosen target plus a duration-bounded modifier", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantMight.id, "pridestalker.grant-might");
  // The merged continuous.might primitive registers the arithmetic
  // layer effect; the card must not approximate it with effect.buff
  // (702 Buff counters are a different thing).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  // 315.4 / 468.7.c: "this turn" is the alias the layers duration map resolves
  // to the end-of-turn expiry.
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  // The merged primitive selects through the contract 3.6 objects descriptor;
  // the Finalize-locked TargetSpec is read by id (355.10).
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "pridestalker.unit" }
  });
  // 355.9 / 355.10: "a unit" is a single chosen target, not a pick.
  assert.deepEqual(targetSpec, {
    id: "pridestalker.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

const UNIT = "synthetic-played-unit";

/**
 * Real EventPipeline + ChainEngine harness (engine-core/test/chain/helpers.mjs shape).
 *
 * The trigger subscription is installed with the merged card-program translation
 * helpers (programs/filters.ts) rather than through createProgramBinding: the
 * registry refuses judge-required programs outright (programs/registry.ts), and
 * this card stays judge-required for the Legend-zone gap documented above. The
 * registration mirrors programs/triggers.ts exactly, so the card's own
 * TriggerSpec spelling and body run unchanged through the production translation
 * and the production trigger/chain/layer machinery.
 */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("pridestalker", { cardId: CANONICAL_ID, types: ["legend"], might: null, energy: null, power: null })
    .base("ally", { cardId: UNIT, types: ["unit"], might: 2 })
    .hand("enemy-unit", { cardId: UNIT, types: ["unit"], owner: "B", controller: "B", might: 3 })
    .hand("own-unit", { cardId: UNIT, types: ["unit"], might: 4 })
    .build();

  const decide = request => {
    if (request.type === "select-objects") return request.options.slice(0, request.min);
    if (request.type === "optional") return true;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });

  // The played unit is a synthetic board-card: "play" needs a draft adapter, and
  // the card under test contributes nothing to that resolved body (383.4.a.4:
  // "when you play a unit" is not a Play Effect of the played card).
  const describePlay = (action, source) => ({
    id: `play:${source.ref.id}:${source.ref.zoneEntryId}:${action.player}`,
    controller: action.player,
    source,
    kind: "unit",
    speed: "normal",
    // The synthetic unit costs no resources; the card under test only observes
    // the resulting card-played event.
    cost: { id: `cost:${source.ref.id}`, cost: { kind: "explicit" } },
    body: []
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false, describePlay });

  // The legend starts on the Board (CR 107/107.4: the Legend Zone is part of
  // The Board). programs/triggers.ts derives activeZones ['board'] for a
  // permanent, which is the spelling mirrored here.
  engine.commit({ type: "move-zone", object: kernel.ref("pridestalker"), to: "board", location: { type: "base", player: "A" } });
  engine.pipeline.registerTrigger({
    id: `program:${kernel.ref("pridestalker").id}:${kernel.ref("pridestalker").zoneEntryId}:0`,
    source: kernel.getObject("pridestalker"),
    controller: "A",
    spec: {
      at: ability.trigger.at,
      filter: translateTriggerFilter(ability.trigger.filter, kernel.ref("pridestalker").id, ability.trigger.at)
    },
    body: translateInstructionTargets(ability.body),
    optional: ability.optional,
    activeZones: ["board"],
    boundToIncarnation: true
  });

  const drain = () => {
    engine.advance();
    let guard = 0;
    while (engine.items.length) {
      if (++guard > 40) throw new Error("Nonterminating test chain");
      engine.pass(engine.priority);
    }
  };
  return { kernel, engine, drain };
}

test("unl-183-219 Pridestalker golden: the card-played subscription uses the merged trigger translation", () => {
  const { kernel, engine } = fixture();
  assert.deepEqual([...engine.pipeline.triggers.keys()].length, 1);
  const [registration] = [...engine.pipeline.triggers.values()];
  assert.equal(registration.spec.at, "card-played");
  // programs/filters.ts normalizes the card's own ObjectFilter: the event object
  // is the just-played unit and "controller: self" is resolved relative to the
  // ability's controller (383.4.a.4).
  assert.equal(registration.spec.filter.event, "card-played");
  assert.deepEqual(registration.spec.filter.object, { type: "unit", controller: "self" });
  assert.equal(registration.boundToIncarnation, true);
  // The printed TargetSpec survives the translation unchanged (355.10).
  assert.deepEqual(registration.body[0].targets, [targetSpec]);
  assert.equal(kernel.getObject("pridestalker").zone, "board");
});

test("unl-183-219 Pridestalker golden: the trigger registers +1 Might in the arithmetic layer for the locked unit", () => {
  const { kernel, engine, drain } = fixture();

  // An opponent's unit does not satisfy "you play a unit".
  engine.commit({ type: "play", object: kernel.ref("enemy-unit"), player: "B" });
  drain();
  assert.equal(engine.layers.registry.snapshot().length, 0);

  // The controller's own unit does.
  engine.commit({ type: "play", object: kernel.ref("own-unit"), player: "A" });
  drain();
  engine.layers.setObjects(kernel.objects);
  const [registration] = engine.layers.registry.snapshot();
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  // 355.10: the Finalize-locked unit is the registered target.
  assert.equal(registration.effect.filter.objectId, "ally");
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 3);
});

test("unl-183-219 Pridestalker golden: the +1 expires at end of turn (CR 315.4 / 468.7.c)", () => {
  const { kernel, engine, drain } = fixture();
  engine.commit({ type: "play", object: kernel.ref("own-unit"), player: "A" });
  drain();
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 3);

  assert.equal(engine.layers.expireAt("turn-end").length, 1);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
});

test("unl-183-219 Pridestalker golden: a unit that left the Board is ignored, not redirected (359.3.e.6)", () => {
  const { kernel, engine, drain } = fixture();
  const stale = kernel.ref("ally");
  engine.commit({ type: "kill", object: stale });
  drain();

  engine.commit({ type: "play", object: kernel.ref("own-unit"), player: "A" });
  drain();
  // The trigger still fired, but the only legal choice is the newly played unit;
  // the dead ally must not receive a Might modification.
  assert.equal(engine.layers.registry.snapshot().every(entry => entry.effect.filter.objectId !== "ally"), true);
});

test.todo(
  "unl-183-219 Pridestalker: keep a Legend's card-played subscription active in a real match (CR 107.4) by " +
    "modeling its Legend Zone lifecycle and deriving the correct active zone"
);
