import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/realm-of-death.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const [play] = program.abilities;
const [debuff, buff, enemyDeals, friendlyDeals] = play.body;

const ENEMY_ID = "realm-of-death.enemy-unit";
const FRIENDLY_ID = "realm-of-death.friendly-unit";

const constant = (value) => ({ kind: "constant", value });

/** Drive the card's own body through the real ChainEngine (Finalize + Resolve). */
function playCard({ allyMight = 2, enemyMight = 3 } = {}) {
  const kernel = world()
    .player("A", { energy: 6, power: ["Order"] })
    .player("B", { energy: 6, power: [] })
    .unit("realm-of-death", {
      types: ["spell"], might: null, energy: 2, power: ["Order"], zone: "hand"
    })
    .unit("ally", { might: allyMight, zone: "board" })
    .unit("enemy", { owner: "B", controller: "B", might: enemyMight, zone: "board" })
    .build();
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
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  engine.execute({
    id: "realm-of-death:play", controller: "A", source: kernel.getObject("realm-of-death"),
    kind: "spell", speed: "normal", body: play.body
  });
  let passes = 0;
  while (engine.items.length) {
    if (++passes > 20) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
  return { kernel, engine };
}

test("rad-144-167 Realm of Death: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-2d0655c3e2e7d9b1f55085edecfe69718e6edf9224340e2b87500e7770483b3d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "Give an enemy unit -2 :rb_might: this turn and a friendly unit +2 :rb_might: this turn. " +
      "They deal damage equal to their Mights to each other."
  );
});

test("rad-144-167 Realm of Death: structure — two Might changes then two Deal actions", () => {
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "realm-of-death.debuff-enemy",
    "realm-of-death.buff-friendly",
    "realm-of-death.enemy-deals",
    "realm-of-death.friendly-deals"
  ]);

  // "Give an enemy unit -2 Might this turn": merged arithmetic-layer
  // continuous.might (RIFT-258) with an end-of-turn duration (317.2.c). Its
  // `objects` descriptor hands the Finalize-locked TargetSpec to the interpreter.
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(debuff.args.objects, {
    kind: "constant",
    value: { kind: "target", id: ENEMY_ID }
  });
  assert.equal(debuff.args.target, undefined);
  assert.deepEqual(debuff.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.equal(debuff.targets[0].min, 1);
  assert.equal(debuff.targets[0].max, 1);
  assert.equal(debuff.targets[0].selection, "one");

  // "and a friendly unit +2 Might this turn": the second layers effect.
  assert.equal(buff.op, "continuous.might");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(buff.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(buff.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(buff.args.objects, {
    kind: "constant",
    value: { kind: "target", id: FRIENDLY_ID }
  });
  assert.deepEqual(buff.targets[0].filter, { type: "unit", controller: "self" });

  // "They deal damage equal to their Mights to each other." — each Deal action
  // reads its own unit's Might and names that unit as the source (418.6.b.3).
  for (const instruction of [enemyDeals, friendlyDeals]) {
    assert.equal(instruction.op, "effect.damage");
    assert.equal(instruction.args.amount.kind, "object-property");
    assert.equal(instruction.args.amount.property, "might");
    assert.equal(instruction.args.source.kind, "object-property");
    assert.equal(instruction.args.source.property, "ref");
    assert.deepEqual(
      instruction.targets.map(target => target.id),
      [ENEMY_ID, FRIENDLY_ID]
    );
    for (const target of instruction.targets) {
      assert.equal(target.min, 1);
      assert.equal(target.max, 1);
      assert.equal(target.selection, "one");
    }
  }
  assert.deepEqual(enemyDeals.targets.map(target => target.filter.controller), ["opponent", "self"]);
  assert.deepEqual(friendlyDeals.targets.map(target => target.filter.controller), ["opponent", "self"]);
  assert.deepEqual(enemyDeals.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.deepEqual(friendlyDeals.targets[1].filter, { type: "unit", controller: "self" });

  // The enemy unit deals to the friendly unit and vice versa.
  assert.deepEqual(enemyDeals.args.target, { kind: "constant", value: FRIENDLY_ID });
  assert.deepEqual(friendlyDeals.args.target, { kind: "constant", value: ENEMY_ID });
});

test("rad-144-167 Realm of Death: each unit deals damage equal to its own Might (418.6.b.3)", () => {
  const kernel = world()
    .player("A")
    .unit("ally", { might: 4 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const allyRef = kernel.ref("ally");
  const enemyRef = kernel.ref("enemy");

  const enemyRun = runInstruction(
    damage,
    {
      amount: enemyDeals.args.amount,
      source: enemyDeals.args.source,
      target: FRIENDLY_ID
    },
    { world: kernel, targets: { [ENEMY_ID]: [enemyRef], [FRIENDLY_ID]: [allyRef] } }
  );
  assert.equal(enemyRun.result.status, "executed");
  assert.equal(enemyRun.result.linkedValues.dealt, 3);
  assert.equal(kernel.getObject("ally").damage, 3);

  const friendlyRun = runInstruction(
    damage,
    {
      amount: friendlyDeals.args.amount,
      source: friendlyDeals.args.source,
      target: ENEMY_ID
    },
    { world: kernel, targets: { [ENEMY_ID]: [enemyRef], [FRIENDLY_ID]: [allyRef] } }
  );
  assert.equal(friendlyRun.result.status, "executed");
  assert.equal(friendlyRun.result.linkedValues.dealt, 4);
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.deepEqual(friendlyRun.events.map(event => event.action), ["damage"]);
});

test("rad-144-167 Realm of Death: a unit that left the board is not dealt damage (359.3.e.7)", () => {
  const kernel = world()
    .player("A")
    .unit("ally", { might: 4 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const enemyRef = kernel.ref("enemy");
  const staleAlly = kernel.ref("ally");
  kernel.perform({ type: "kill", object: staleAlly });
  // The enemy unit deals its Might to the friendly unit (the stale reference):
  // the amount and source resolve from the still-legal enemy unit, while the
  // friendly target has left the board, so the instruction is ignored.
  const run = runInstruction(
    damage,
    {
      amount: enemyDeals.args.amount,
      source: enemyDeals.args.source,
      target: FRIENDLY_ID
    },
    { world: kernel, targets: { [ENEMY_ID]: [enemyRef], [FRIENDLY_ID]: [staleAlly] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("ally").zone, "trash");
});

test.todo(
  "rad-144-167 Realm of Death: the card-played/chain wiring that plays this spell from a real hand and " +
    "delivers its Finalize targets through the production play pipeline (CardProgram -> describePlay, " +
    "RIFT-120); the golden drives the card's own body through the real ChainEngine above"
);

test("rad-144-167 Realm of Death golden: the layered Mights decide the two Deal amounts", () => {
  const { kernel, engine } = playCard({ allyMight: 2, enemyMight: 3 });

  // 143.2.a / 478: -2 and +2 land in the arithmetic layer; the Effective Mights
  // are 1 (enemy) and 4 (ally) while the effects are alive.
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy")).might, 1);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 4);

  // 418.6.b.3: each chosen unit deals its own (modified) Might to the other.
  assert.equal(kernel.getObject("ally").damage, 1);
  assert.equal(kernel.getObject("enemy").damage, 4);
});

test("rad-144-167 Realm of Death golden: the temporary Might changes expire at turn-end (317.2.c)", () => {
  const { kernel, engine } = playCard({ allyMight: 2, enemyMight: 3 });
  engine.emit({ timingPoint: "turn-end" });
  engine.layers.setObjects(kernel.objects);

  assert.equal(engine.layers.evaluate(kernel.ref("enemy")).might, 3);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
});

test("rad-144-167 Realm of Death golden: a Might modification reading the wrong unit is impossible", () => {
  // The card authors the modifiers as separate instructions (055/359.3.e.11), so
  // neither can silently borrow the other's amount; running the debuff alone
  // still registers exactly one layer entry for the enemy unit.
  const kernel = world().unit("ally", { might: 2 }).unit("enemy", { owner: "B", controller: "B", might: 3 }).build();
  const run = runInstruction(might, debuff.args, {
    world: kernel,
    targets: { [ENEMY_ID]: [kernel.ref("enemy")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, -2);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.deepEqual(run.linked.affected.objects.map((ref) => ref.id), ["enemy"]);
});
