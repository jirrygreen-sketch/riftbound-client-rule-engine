import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/realm-of-death.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [play] = program.abilities;
const [debuff, buff, enemyDeals, friendlyDeals] = play.body;

const ENEMY_ID = "realm-of-death.enemy-unit";
const FRIENDLY_ID = "realm-of-death.friendly-unit";

test("rad-144-167 Realm of Death: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-2d0655c3e2e7d9b1f55085edecfe69718e6edf9224340e2b87500e7770483b3d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Give an enemy unit -2 :rb_might: this turn and a friendly unit +2 :rb_might: this turn. " +
      "They deal damage equal to their Mights to each other."
  );
});

test("rad-144-167 Realm of Death: judgeReason names the missing Might-modification instruction", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /Buff/);
});

test("rad-144-167 Realm of Death: structure — two Might changes then two Deal actions", () => {
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "realm-of-death.debuff-enemy",
    "realm-of-death.buff-friendly",
    "realm-of-death.enemy-deals",
    "realm-of-death.friendly-deals"
  ]);

  // "Give an enemy unit -2 Might this turn": layers arithmetic effect with an
  // end-of-turn duration (317.2.c); no merged op creates it (see judgeReason).
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(debuff.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.equal(debuff.targets[0].min, 1);
  assert.equal(debuff.targets[0].max, 1);
  assert.equal(debuff.targets[0].selection, "one");

  // "and a friendly unit +2 Might this turn": the second layers effect.
  assert.equal(buff.op, "continuous.might");
  assert.deepEqual(buff.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(buff.args.duration, { kind: "constant", value: "end-of-turn" });
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
  "rad-144-167 Realm of Death: the -2 / +2 Might changes need a card-facing continuous.might " +
    "instruction with an end-of-turn duration (CR 317.2.c); layers/engine.ts evaluates such effects and " +
    "ResolveContext.addContinuous exists, but effects/instructions/ registers no creating op (RIFT-91)"
);
