import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hexplosive-minefield.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const [killInstruction, delayedPlay] = play.body;
const targetId = killInstruction.targets[0].id;
const bodyWithoutTargets = play.body.map(({ targets, ...rest }) => rest);

const bombKernel = () =>
  world()
    .player("A")
    .unit("bomb-1", { types: ["gear"], tags: ["Bomb"], isToken: true })
    .unit("bomb-2", { types: ["gear"], tags: ["Bomb"], isToken: true })
    .unit("plain-gear", { types: ["gear"] })
    .unit("enemy-bomb", { owner: "B", types: ["gear"], tags: ["Bomb"], isToken: true })
    .build();

test("rad-142-167 Hexplosive Minefield: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill any number of friendly Bomb tokens. At end of turn, play that many Bomb tokens to a single battlefield."
  );
});

test("rad-142-167 Hexplosive Minefield: judgeReason names the delayed trigger, destination and Bomb definition gaps", () => {
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /390/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /187\.12/);
});

test("rad-142-167 Hexplosive Minefield: structure — Action keyword, any-number kill, delayed token play", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "hexplosive-minefield.kill-bombs",
    "hexplosive-minefield.delayed-play"
  ]);

  // "Kill any number of friendly Bomb tokens": one target spec, up-to, zero
  // allowed (355.13), Bomb gear tokens controlled by the ability controller.
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: targetId });
  assert.equal(killInstruction.targets.length, 1);
  assert.deepEqual(killInstruction.targets[0].filter, {
    type: "gear",
    tags: ["Bomb"],
    controller: "self"
  });
  assert.equal(killInstruction.targets[0].min, 0);
  assert.equal(killInstruction.targets[0].max, null);
  assert.equal(killInstruction.targets[0].selection, "up-to");

  // "At end of turn, play that many Bomb tokens to a single battlefield." — a
  // delayed ability created by this spell (390 / 391.2): window this turn
  // (317.2.c), resolution at turn-end, count = what the kill instruction killed.
  assert.equal(delayedPlay.op, "trigger.delayed");
  assert.equal(delayedPlay.linkedTo, "hexplosive-minefield.kill-bombs");
  assert.deepEqual(delayedPlay.args.at, { kind: "constant", value: "turn-end" });
  assert.deepEqual(delayedPlay.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(delayedPlay.args.count, {
    kind: "linked-value",
    instructionId: "hexplosive-minefield.kill-bombs",
    key: "killed"
  });
  assert.equal(delayedPlay.args.body.kind, "constant");
  const [playBombs] = delayedPlay.args.body.value;
  assert.equal(playBombs.id, "hexplosive-minefield.play-bombs");
  assert.equal(playBombs.op, "effect.token");
  assert.deepEqual(playBombs.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBombs.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBombs.args.locations, {
    kind: "constant",
    value: [{ type: "battlefield", id: "hexplosive-minefield.chosen-battlefield" }]
  });
  assert.deepEqual(playBombs.args.choiceId, {
    kind: "constant",
    value: "hexplosive-minefield.battlefield"
  });
});

test("rad-142-167 Hexplosive Minefield: 'Kill any number of friendly Bomb tokens' kills the chosen Bomb tokens", () => {
  const kernel = bombKernel();
  const run = runInstruction(kill, { target: targetId }, {
    world: kernel,
    targets: { [targetId]: [kernel.ref("bomb-1"), kernel.ref("bomb-2")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["kill", "kill"]);
  assert.equal(kernel.getObject("bomb-1").zone, "trash");
  assert.equal(kernel.getObject("bomb-2").zone, "trash");
  // Only Bomb tokens controlled by the ability controller are affected.
  assert.equal(kernel.getObject("plain-gear").zone, "board");
  assert.equal(kernel.getObject("enemy-bomb").zone, "board");
  assert.deepEqual(
    run.linked.killed.map(ref => ref.id).sort(),
    ["bomb-1", "bomb-2"]
  );
});

test("rad-142-167 Hexplosive Minefield: choosing zero Bomb tokens is legal and kills nothing (355.13)", () => {
  const kernel = bombKernel();
  const run = runInstruction(kill, { target: targetId }, {
    world: kernel,
    targets: { [targetId]: [] }
  });
  // CR 355.13: an "any number" choice may be zero, and the spell is playable
  // with no targets. The reference kernel reports the empty selection as
  // ignored because no still-legal target remains, but nothing was killed.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("bomb-1").zone, "board");
  assert.deepEqual(run.events, []);
});

test("rad-142-167 Hexplosive Minefield: the delayed half has no merged op, so it cannot silently succeed", () => {
  // The card's own body reaches the delayed instruction only after the kill
  // instruction executed; the merged registry has no trigger.delayed op, so a
  // resolution that got that far fails loudly instead of silently claiming the
  // delayed play happened.
  const kernel = bombKernel();
  kernel.setTargets(targetId, [kernel.ref("bomb-1"), kernel.ref("bomb-2")]);
  assert.throws(
    () => runAbilityBody(bodyWithoutTargets, kernel),
    /Unregistered instruction opcode: trigger\.delayed/
  );
  // The kill half really did run before the unresolved delayed instruction.
  assert.equal(kernel.getObject("bomb-1").zone, "trash");
  assert.equal(kernel.getObject("bomb-2").zone, "trash");
  // No merged code path registered the turn-end delayed play.
  assert.deepEqual(kernel.delayedTriggers, []);
  assert.equal(instructionRegistry.has("trigger.delayed"), false);
});

const instructionRegistry = await import(
  "../../../../engine-core/dist/effects/instructions/registry.generated.js"
).then(module => module.instructionDefinitionsById);

test.todo(
  "rad-142-167 Hexplosive Minefield: 'At end of turn, play that many Bomb tokens' needs the card-facing " +
    "delayed-ability op (CR 390 / 391.2 / 393) that registers a turn-end trigger with the killed count " +
    "(RIFT-9 trigger.delayed); a card-owned triggered ability would be wrong under 393"
);

test.todo(
  "rad-142-167 Hexplosive Minefield: playing NEW Bomb tokens to a single battlefield needs chain creation " +
    "plus a resolution-time battlefield destination (CR 440.2.c / 185.2.a / 350.2 / 354), and the Bomb gear " +
    "token definition with its Deploy + Deathknell abilities (CR 187.12); effect.token blocks the play path " +
    "and has no bomb definition (RIFT-62 / RIFT-90)"
);
