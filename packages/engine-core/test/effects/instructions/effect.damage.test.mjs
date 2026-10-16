import test from "node:test";
import assert from "node:assert/strict";

import effectDamage from "../../../src/effects/instructions/effect.damage.ts";
import {
  AwaitChoice,
  runInstruction,
  world
} from "../../../src/effects/testing/index.ts";

const constant = (value) => ({ kind: "constant", value });
const mightOf = (ref) => ({ kind: "object-property", object: ref, property: "might" });
const refValue = (ref) => ({ kind: "constant", value: ref });

const enemyAtBattlefield = (id, values = {}) =>
  world().unit(id, {
    owner: "B",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    ...values
  });

test("ogn-024-298 Void Seeker: Deal 4 to a unit at a battlefield", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  const enemy = kernel.ref("enemy");
  const run = runInstruction(
    effectDamage,
    { amount: constant(4), target: "t1" },
    { world: kernel, targets: { t1: [enemy] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.dealt, 4);
  assert.equal(run.result.linkedValues.dealtCount, 1);
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.equal(run.linked.dealt, 4);
  // CR 418.6.a: no explicit source, so the ability's source object deals it.
  assert.equal(run.events[0].action, "damage");
});

test("ogn-105-298 Singularity: Deal 6 to each of up to two units, simultaneously", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  const targets = [kernel.ref("u1"), kernel.ref("u2")];
  const run = runInstruction(
    effectDamage,
    { amount: constant(6), target: "t1" },
    { world: kernel, targets: { t1: targets } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.dealt, 12);
  assert.equal(run.result.linkedValues.dealtCount, 2);
  assert.equal(kernel.getObject("u1").damage, 6);
  assert.equal(kernel.getObject("u2").damage, 6);
  // CR 418.1.c: damage is marked on each unit separately (one action per target).
  assert.equal(run.events.filter((event) => event.action === "damage").length, 2);
});

test("rad-181-167 Yone, Blademaster: dynamic amount equal to my Might", () => {
  const kernel = enemyAtBattlefield("enemy")
    .unit("yone", { might: 4, owner: "A" })
    .build();
  const enemy = kernel.ref("enemy");
  const yone = kernel.ref("yone");
  const run = runInstruction(
    effectDamage,
    { amount: mightOf(yone), target: "t1", source: "self" },
    { world: kernel, source: undefined, targets: { t1: [enemy] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
});

test("sfd-107-221 Strike Down: chosen friendly unit is the source and deals its Might", () => {
  const kernel = enemyAtBattlefield("enemy")
    .unit("ally", { might: 5, owner: "A" })
    .build();
  const enemy = kernel.ref("enemy");
  const ally = kernel.ref("ally");
  const actions = [];
  kernel.addReplacement((action) => {
    if (action.type === "damage") actions.push(action);
    return null;
  });
  const run = runInstruction(
    effectDamage,
    { amount: mightOf(ally), target: "t1", source: refValue(ally) },
    { world: kernel, targets: { t1: [enemy] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 5);
  // CR 418.6.b.3: the chosen unit, not the spell, is the source of the damage.
  assert.equal(actions.length, 1);
  assert.equal(actions[0].source.id, "ally");
  assert.equal(actions[0].combat, false);
});

test("ogn-149-298 Carnivorous Snapvine: bonus damage applies to each target separately (CR 715.2)", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  const targets = [kernel.ref("u1"), kernel.ref("u2")];
  const run = runInstruction(
    effectDamage,
    { amount: constant(6), bonus: constant(1), target: "t1" },
    { world: kernel, targets: { t1: targets } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").damage, 7);
  assert.equal(kernel.getObject("u2").damage, 7);
  assert.equal(run.result.linkedValues.dealt, 14);
});

test("replacement hook replacing the damage negates the instruction", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  kernel.addReplacement((action) => (action.type === "damage" ? "replaced" : null));
  const run = runInstruction(
    effectDamage,
    { amount: constant(4), target: "t1" },
    { world: kernel, targets: { t1: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(run.result.linkedValues, undefined);
  assert.equal(run.linked.dealt, undefined);
});

test("prevention of one target negates the instruction while other damage stands", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  kernel.addReplacement((action) =>
    action.type === "damage" && action.target.id === "u2" ? "prevented" : null
  );
  const run = runInstruction(
    effectDamage,
    { amount: constant(3), target: "t1" },
    { world: kernel, targets: { t1: [kernel.ref("u1"), kernel.ref("u2")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // The non-prevented damage action was still committed (v1.5: do as much as possible).
  assert.equal(kernel.getObject("u1").damage, 3);
  assert.equal(kernel.getObject("u2").damage, 0);
});

test("stale target reference (object left its zone) is ignored", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(
    effectDamage,
    { amount: constant(4), target: "t1" },
    { world: kernel, targets: { t1: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test("missing target set is ignored", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  const run = runInstruction(effectDamage, { amount: constant(4), target: "t1" }, { world: kernel });
  assert.equal(run.result.status, "ignored");
});

test("amount 0 performs no action and negates (CR 418.1.e.1: only valid damage is dealt)", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  const run = runInstruction(
    effectDamage,
    { amount: constant(0), target: "t1" },
    { world: kernel, targets: { t1: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(kernel.history({ action: "damage" }), 0);
});

test("negative bonus is clamped away (CR 714.2)", () => {
  const kernel = enemyAtBattlefield("enemy").build();
  const run = runInstruction(
    effectDamage,
    { amount: constant(2), bonus: constant(-5), target: "t1" },
    { world: kernel, targets: { t1: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 2);
});

test("divide mode suspends with a number choice and leaves the world untouched", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  const run = runInstruction(
    effectDamage,
    { amount: constant(5), divide: true, target: "t1" },
    { world: kernel, targets: { t1: [kernel.ref("u1"), kernel.ref("u2")] } }
  );
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.asked.request.type, "number");
  assert.equal(run.asked.request.id, "effect.damage:divide:0");
  assert.equal(run.asked.request.min, 1);
  assert.equal(run.asked.request.max, 4);
  assert.equal(run.result, null);
  assert.equal(kernel.getObject("u1").damage, 0);
  assert.equal(kernel.getObject("u2").damage, 0);
});

test("divide mode replays with answers and commits the split (CR 355.14.e/f/g)", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  const run = runInstruction(
    effectDamage,
    { amount: constant(5), divide: true, target: "t1" },
    {
      world: kernel,
      targets: { t1: [kernel.ref("u1"), kernel.ref("u2")] },
      answers: { "effect.damage:divide:0": 2, "effect.damage:divide:1": 3 }
    }
  );
  assert.equal(run.asked, null);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").damage, 2);
  assert.equal(kernel.getObject("u2").damage, 3);
  assert.equal(run.result.linkedValues.dealt, 5);
  assert.equal(run.result.linkedValues.dealtCount, 2);
  assert.deepEqual(
    run.result.linkedValues.dealtTo.map((entry) => entry.amount),
    [2, 3]
  );
});

test("divide mode rejects an over-allocation answer as impossible", () => {
  const kernel = enemyAtBattlefield("u1").unit("u2", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } }).build();
  const run = runInstruction(
    effectDamage,
    { amount: constant(5), divide: true, target: "t1" },
    {
      world: kernel,
      targets: { t1: [kernel.ref("u1"), kernel.ref("u2")] },
      answers: { "effect.damage:divide:0": 5 }
    }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("u1").damage, 0);
  assert.equal(kernel.getObject("u2").damage, 0);
});

test("args schema rejects malformed input", () => {
  assert.throws(() => effectDamage.argsSchema.parse({ target: "t1" }));
  assert.throws(() => effectDamage.argsSchema.parse({ amount: constant(1), target: 7 }));
  assert.throws(() => effectDamage.argsSchema.parse({ amount: constant(1), target: "t1", divide: false }));
  const parsed = effectDamage.argsSchema.parse({ amount: constant(1), target: "t1", combat: true });
  assert.equal(parsed.combat, true);
});
