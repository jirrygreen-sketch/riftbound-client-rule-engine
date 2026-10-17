import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/gentlemens-duel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-2837500ae259cc6b529efd728cf65b05c957555d4e133c0d55310df08cf1b7d7";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a friendly unit +3 :rb_might: this turn. Then choose an enemy unit. They deal damage equal to their Mights to each other.";

const [speed, play] = program.abilities;
const [mightGrant, friendlyStrikes, enemyStrikes] = play.body;
const friendlySpec = mightGrant.targets[0];
const enemySpec = friendlyStrikes.targets[0];

test("ogs-008-024 Gentlemen's Duel: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.judgeReason, undefined);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-008-024 Gentlemen's Duel: [Action] keyword plus the printed 6 energy + 1 Body power cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 1 }
  });
});

test("ogs-008-024 Gentlemen's Duel: both units are chosen at Finalize, not re-chosen later", () => {
  // 355.5 / 355.7: "Then choose an enemy unit" is not the 388.1 reflexive "do
  // this" marker, so both objects are targeting choices of this spell.
  assert.equal(mightGrant.targets.length, 1);
  assert.equal(friendlySpec.id, "gentlemens-duel.friendly-unit");
  assert.deepEqual(friendlySpec.filter, { type: "unit", controller: "self" });
  assert.equal(friendlySpec.selection, "one");

  assert.equal(friendlyStrikes.targets.length, 1);
  assert.equal(enemySpec.id, "gentlemens-duel.enemy-unit");
  assert.deepEqual(enemySpec.filter, { type: "unit", controller: "opponent" });
  assert.equal(enemySpec.selection, "one");
  // The second Deal re-uses the same TargetSpecs instead of declaring new ones.
  assert.equal(enemyStrikes.targets, undefined);
});

test("ogs-008-024 Gentlemen's Duel: the +3 Might half uses the merged continuous.might primitive", () => {
  // "Give a friendly unit +3 [M] this turn": temporary Might, not a Buff (702).
  assert.equal(mightGrant.id, "gentlemens-duel.give-plus-3-might");
  assert.equal(mightGrant.op, "continuous.might");
  assert.deepEqual(mightGrant.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightGrant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(mightGrant.args.minimum, undefined);
  // The locked unit is read through the target selector the primitive
  // evaluates itself (355.10.g); a bare spec-id "target" argument is not
  // consumed by the merged primitive.
  assert.deepEqual(mightGrant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "gentlemens-duel.friendly-unit" }
  });
  assert.equal(mightGrant.args.target, undefined);
});

test("ogs-008-024 Gentlemen's Duel: both Deals use the unit as source and read its Might", () => {
  // 418.6.b.3: the unit is the damage source; 359.3.f.2: the amount is read on
  // execution of the instruction.
  assert.equal(friendlyStrikes.op, "effect.damage");
  assert.deepEqual(friendlyStrikes.args.amount, {
    kind: "object-property",
    object: { target: "gentlemens-duel.friendly-unit" },
    property: "might"
  });
  assert.deepEqual(friendlyStrikes.args.source, {
    kind: "object-property",
    object: { target: "gentlemens-duel.friendly-unit" },
    property: "ref"
  });
  assert.deepEqual(friendlyStrikes.args.target, { kind: "constant", value: "gentlemens-duel.enemy-unit" });
  // The +3 Might grant and the first Deal are separate instructions executed in
  // printed order (359.3.d) with no reference between them, so they are not
  // linked; 359.3.e.14 requires an actual reference for a link.
  assert.equal(friendlyStrikes.linkedTo, undefined);

  assert.equal(enemyStrikes.op, "effect.damage");
  assert.deepEqual(enemyStrikes.args.amount, {
    kind: "object-property",
    object: { target: "gentlemens-duel.enemy-unit" },
    property: "might"
  });
  assert.deepEqual(enemyStrikes.args.source, {
    kind: "object-property",
    object: { target: "gentlemens-duel.enemy-unit" },
    property: "ref"
  });
  assert.deepEqual(enemyStrikes.args.target, { kind: "constant", value: "gentlemens-duel.friendly-unit" });
  assert.equal(enemyStrikes.linkedTo, "gentlemens-duel.friendly-unit-strikes");
});

test("ogs-008-024 Gentlemen's Duel golden: the two Deals read each unit's Might as the source", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  const targets = {
    "gentlemens-duel.friendly-unit": [friendlyRef],
    "gentlemens-duel.enemy-unit": [enemyRef]
  };

  const first = runInstruction(
    damage,
    { amount: friendlyStrikes.args.amount, source: friendlyStrikes.args.source, target: "gentlemens-duel.enemy-unit" },
    { world: kernel, targets }
  );
  assert.equal(first.result.status, "executed");
  assert.equal(first.linked.dealt, 3);
  assert.equal(kernel.getObject("enemy").damage, 3);

  const second = runInstruction(
    damage,
    { amount: enemyStrikes.args.amount, source: enemyStrikes.args.source, target: "gentlemens-duel.friendly-unit" },
    { world: kernel, targets }
  );
  assert.equal(second.result.status, "executed");
  assert.equal(second.linked.dealt, 4);
  assert.equal(kernel.getObject("friendly").damage, 4);
  // Both Deals happen even though the first was already lethal (418.1.d; the
  // cleanup that would kill the unit runs after the spell finishes, 323.4).
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.equal(kernel.getObject("friendly").zone, "board");
});

test("ogs-008-024 Gentlemen's Duel golden: a source that left the Board is impossible, never a fixed amount", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  const targets = {
    "gentlemens-duel.friendly-unit": [friendlyRef],
    "gentlemens-duel.enemy-unit": [enemyRef]
  };

  // The friendly unit left the Board before resolution (359.3.e.12), so the
  // source selector no longer names a live object. effect.damage refuses a
  // non-ObjectRef source and negates the instruction instead of substituting the
  // spell as the source or the printed 3 as the amount.
  assert.equal(kernel.perform({ type: "return-to-hand", object: friendlyRef }).status, "done");
  const first = runInstruction(
    damage,
    { amount: friendlyStrikes.args.amount, source: friendlyStrikes.args.source, target: "gentlemens-duel.enemy-unit" },
    { world: kernel, targets }
  );
  assert.equal(first.result.status, "negated");
  assert.equal(first.result.reason, "impossible");
  assert.deepEqual(first.events, []);
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test("ogs-008-024 Gentlemen's Duel golden: the linked second Deal is ignored when the first is ignored", () => {
  // 359.3.e.14.a in the real interpreter: the second Deal is linked to the
  // first, so an ignored first Deal keeps the second from executing. The first
  // instruction is ignored before its op is dispatched, so this evidence does
  // not depend on the unmerged Might grant.
  const kernel = world()
    .unit("friendly", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "return-to-hand", object: friendlyRef }).status, "done");
  kernel.setTargets("gentlemens-duel.friendly-unit", [friendlyRef]);
  kernel.setTargets("gentlemens-duel.enemy-unit", [enemyRef]);
  const outcome = runAbilityBody(play.body, kernel);
  const first = outcome.results.find((result) => result.id === "gentlemens-duel.friendly-unit-strikes");
  const second = outcome.results.find((result) => result.id === "gentlemens-duel.enemy-unit-strikes");
  assert.deepEqual(first.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(second.result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.getObject("enemy").damage, 0);
});

/**
 * Drive the card's own body through the production chain adapter: Finalize
 * locks the two targets, Resolve registers the +3 Might and performs both
 * Deals with the units' post-grant Mights.
 */
const runChain = ({ mights = { friendly: 3, enemy: 4 } } = {}) => {
  const kernel = world()
    .player("A", { energy: 20, power: ["Body"] })
    .player("B", { energy: 20 })
    .hand("gd", { name: "gentlemens-duel", types: ["spell"], energy: 6, power: ["Body"] })
    .unit("friendly", { owner: "A", controller: "A", might: mights.friendly, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: mights.enemy, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("gd");
  const requests = [];
  const decide = (request) => {
    if (request.id.startsWith("target:")) return [...request.options];
    requests.push(request);
    if (request.type === "select-objects") return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  engine.execute({
    id: "gd",
    controller: "A",
    source,
    kind: "spell",
    speed: "action",
    body: play.body,
    cost: { id: "gd:cost", cost: { kind: "printed" } }
  });
  while (engine.items.length) engine.pass(engine.priority);
  return { kernel, engine, requests };
};

test("ogs-008-024 Gentlemen's Duel golden: the +3 Might registers in the arithmetic layer and the Deals read the post-grant Mights", () => {
  const { kernel, engine } = runChain();

  // The real chain charged the printed 6 energy. (The reference kernel's pay
  // action models energy/XP only; the Finalize plan for this cast still
  // requires the printed 1 Body power.)
  assert.equal(kernel.player("A").energy, 14);

  // 478 / 478.1.a: the +3 Might is an arithmetic-layer registration on the
  // locked friendly unit with the end-of-turn duration (317.1.a / 468.7.c).
  const registrations = engine.layers.registry.list();
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.equal(registration.effect.filter.objectId, "friendly");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 359.3.f.2: the Deal amounts are read when each instruction executes, so
  // the friendly unit deals its 3 + 3 = 6 and the enemy unit its printed 4.
  assert.equal(kernel.getObject("enemy").damage, 6);
  assert.equal(kernel.getObject("friendly").damage, 4);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("friendly")).might, 6);
  // 418.1.d / 323.4: both Deals happen; the cleanup that would kill either
  // unit runs after the spell finishes, so both stay on the Board here.
  assert.equal(kernel.getObject("friendly").zone, "board");
  assert.equal(kernel.getObject("enemy").zone, "board");
  // The resolved spell left the Chain for its owner's trash (157).
  assert.equal(kernel.getObject("gd").zone, "trash");
});

test("ogs-008-024 Gentlemen's Duel golden: the +3 expires at the end of the turn (317.1.a)", () => {
  const { kernel, engine } = runChain({ mights: { friendly: 3, enemy: 9 } });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("friendly")).might, 6);

  const expired = engine.layers.advance({ id: "turn-end", player: "A" });
  assert.equal(expired.length, 1);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("friendly")).might, 3);
});

test("ogs-008-024 Gentlemen's Duel golden: the two Deals stay separate actions and the +3 is never a Buff counter", () => {
  const { kernel, engine } = runChain();
  // The Might change is a layer effect, never a Buff counter (CR 702).
  assert.equal(kernel.getObject("friendly").buffs, 0);
  assert.equal(engine.layers.registry.list().length, 1);
  // Two Deal actions with the units themselves as sources (418.6.b.3); the
  // linked second Deal follows the first (359.3.e.14.a).
  assert.equal(friendlyStrikes.linkedTo, undefined);
  assert.equal(enemyStrikes.linkedTo, "gentlemens-duel.friendly-unit-strikes");
});

test("ogs-008-024 Gentlemen's Duel: a target that left the Board before resolution is ignored", () => {
  // 359.3.e.6: a stale locked target makes the reading instruction ignored and,
  // through the link, the second Deal too; no substitute source or amount is
  // invented. The reference kernel evaluates the body directly with the
  // Finalize lock the chain would have supplied.
  const kernel = world()
    .unit("friendly", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const friendlyRef = kernel.ref("friendly");
  const enemyRef = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "return-to-hand", object: friendlyRef }).status, "done");
  kernel.setTargets("gentlemens-duel.friendly-unit", [friendlyRef]);
  kernel.setTargets("gentlemens-duel.enemy-unit", [enemyRef]);
  const outcome = runAbilityBody(play.body, kernel);
  const first = outcome.results.find((result) => result.id === "gentlemens-duel.friendly-unit-strikes");
  const second = outcome.results.find((result) => result.id === "gentlemens-duel.enemy-unit-strikes");
  assert.deepEqual(first.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(second.result, { status: "ignored", reason: "linked-ignored" });
  // The +3 Might grant reads the same stale locked target: the instruction is
  // ignored and registers nothing, so no layer effect is invented for a unit
  // that is no longer on the Board.
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("enemy").damage, 0);
});
