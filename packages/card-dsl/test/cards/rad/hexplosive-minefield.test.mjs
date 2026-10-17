import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hexplosive-minefield.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const [speed, play] = program.abilities;
const [killInstruction, delayedPlay] = play.body;
const targetId = killInstruction.targets[0].id;

/**
 * The chain Finalize wrapper resolves the contract's "self" controller
 * placeholder and asks layers/filter.ts (chain/engine.ts). Bind the same
 * production query so the card's own filter really matches.
 */
function productionQuery(kernel, controller = kernel.controller) {
  return (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      return matchesObjectFilter(resolved, object);
    });
  };
}

const bombKernel = () =>
  world()
    .player("A")
    .unit("bomb-1", { types: ["gear"], tags: ["Bomb"], isToken: true, owner: "A", controller: "A" })
    .unit("bomb-2", { types: ["gear"], tags: ["Bomb"], isToken: true, owner: "A", controller: "A" })
    .unit("plain-gear", { types: ["gear"], owner: "A", controller: "A" })
    .unit("enemy-bomb", { owner: "B", controller: "B", types: ["gear"], tags: ["Bomb"], isToken: true })
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

test("rad-142-167 Hexplosive Minefield: judgeReason names the delayed op, the destination and the Bomb definition gaps", () => {
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /390/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /RIFT-357/);
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
  assert.deepEqual(killInstruction.targets, [
    {
      id: targetId,
      filter: { type: "gear", tags: ["Bomb"], controller: "self" },
      min: 0,
      max: null,
      selection: "up-to"
    }
  ]);

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

test("rad-142-167 Hexplosive Minefield golden: the card's own kill instruction runs through the chain adapter", () => {
  // The card's own body, with only the Finalize-locked target binding supplied:
  // the merged production adapter executes the real effect.kill instruction and
  // the "controller: self" filter resolves through the chain's query wrapper.
  const kernel = bombKernel().clone({ sourceSnapshot: bombKernel().getObject("plain-gear") });
  kernel.setTargets(targetId, [kernel.ref("bomb-1"), kernel.ref("bomb-2")]);
  const context = bindResolveContext(kernel, { query: productionQuery(kernel, "A") });

  const outcome = resolveChainBody([killInstruction], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["hexplosive-minefield.kill-bombs", "executed"]
  ]);
  assert.equal(kernel.getObject("bomb-1").zone, "trash");
  assert.equal(kernel.getObject("bomb-2").zone, "trash");
  assert.equal(kernel.getObject("enemy-bomb").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "kill"]);
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

test.todo(
  "rad-142-167 Hexplosive Minefield: 'At end of turn, play that many Bomb tokens' needs the card-facing " +
    "delayed-ability binding (CR 390 / 391.2 / 393) that registers a turn-end trigger with the killed count; " +
    "a card-owned triggered ability would be wrong under 393"
);
test.todo(
  "rad-142-167 Hexplosive Minefield: playing NEW Bomb tokens to a single battlefield needs a " +
    "resolution-time battlefield destination (CR 440.2.c / 185.2.a / 350.2 / 354 / 355.9.a.4) and the " +
    "Bomb gear token definition with its Deploy + Deathknell abilities (CR 187.12) — RIFT-357"
);
