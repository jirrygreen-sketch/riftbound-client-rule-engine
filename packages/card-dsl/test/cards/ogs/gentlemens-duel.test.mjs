import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/gentlemens-duel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
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

test("ogs-008-024 Gentlemen's Duel: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing primitive and the dependent task.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
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

test("ogs-008-024 Gentlemen's Duel: the +3 Might half is the unmerged continuous effect", () => {
  // "Give a friendly unit +3 [M] this turn": temporary Might, not a Buff (702).
  assert.equal(mightGrant.id, "gentlemens-duel.give-plus-3-might");
  assert.equal(mightGrant.op, "continuous.might");
  assert.deepEqual(mightGrant.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightGrant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(mightGrant.args.minimum, undefined);
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

test.todo(
  "Gentlemen's Duel: applying 'Give a friendly unit +3 [M] this turn' and expiring it end of turn needs the " +
    "continuous.might instruction primitive (RIFT-91)"
);

test.todo(
  "Gentlemen's Duel full resolution: the mutual damage must read the post-+3 Mights (359.3.f.2) and the linked " +
    "second Deal must be ignored when the first is ignored (359.3.e.14.a) " +
    "(依赖 continuous.might 原语与 RIFT-81 解释器链接语义)"
);
