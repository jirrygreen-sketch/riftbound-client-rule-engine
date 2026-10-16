import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jayce-man-of-progress.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0b7c7cbc35b5094b62d279e16731c4fea82f84054ddee4bfee7ba32cf3791d92";
const MAY_KILL_ID = "jayce.may-kill-friendly-gear";
const KILL_ID = "jayce.kill-friendly-gear";
const MAY_PLAY_ID = "jayce.may-play-gear-from-hand";
const PLAY_ID = "jayce.play-gear";
const TARGET_ID = "jayce.friendly-gear";

const [ability] = program.abilities;
const [mayKill] = ability.body;
const [killInstruction, mayPlay] = mayKill.args.body.value;
const [playInstruction] = mayPlay.args.body.value;

const resultFor = (outcome, id) => outcome.results.find((result) => result.id === id);

// "a friendly gear" resolves through the controller placeholder: the chain's
// Finalize/query wrapper normalizes `controller`/`owner` "self" to the item's
// controller (chain/engine.ts), and the production object matcher lives in
// layers/filter.ts. Bind both so the declared TargetSpec is legalized by the
// real pipeline instead of the reference kernel's value-only comparison.
const boundWorld = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "self" ? kernel.controller : value])),
    object
  ))
});

function resolveWith(kernel, { gearRef, acceptKill, acceptPlay = false }) {
  kernel.setTargets(TARGET_ID, gearRef === undefined ? [] : [gearRef]);
  kernel.setAnswers({
    [MAY_KILL_ID + "/optional"]: acceptKill,
    ...(acceptKill ? { [MAY_PLAY_ID + "/optional"]: acceptPlay } : {})
  });
  return resolveChainBody([mayKill], boundWorld(kernel));
}

test("sfd-084-221 Jayce, Man of Progress: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost " +
      "no more than :rb_energy_7: from hand this turn, ignoring its Energy cost. (You must still pay " +
      "its Power cost.)"
  );
});

test("sfd-084-221 Jayce, Man of Progress: judgeReason names the receipt, cost, window and filter gaps", () => {
  assert.match(program.judgeReason, /359\.3\.e\.14\.b/);
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /355\.5/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-084-221 Jayce, Man of Progress: the may-kill wraps the kill plus the may-play in one optional body", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });

  assert.deepEqual(ability.body.map((instruction) => instruction.id), [MAY_KILL_ID]);
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(mayKill.args.body.kind, "constant");
  assert.deepEqual(mayKill.args.body.value.map((instruction) => instruction.id), [
    KILL_ID,
    MAY_PLAY_ID
  ]);

  // 355.7 / 355.9.a.1 / 355.12 / 190.6.d: "a friendly gear" is one chosen Board
  // object controlled by this ability's controller, locked with the may-action.
  assert.equal(mayKill.targets.length, 1);
  const [target] = mayKill.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, { type: "gear", zone: "board", controller: "self" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");

  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, { target: { kind: "constant", value: TARGET_ID } });
  assert.equal(killInstruction.linkedTo, undefined);
});

test("sfd-084-221 Jayce, Man of Progress: the play half records the printed ceilings, the pick and the ignored-Energy plan", () => {
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, undefined);
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => instruction.id), [PLAY_ID]);

  assert.equal(playInstruction.op, "effect.play");
  // 420.3 / 420.3.c: a game effect that plays a card from hand; the object is
  // chosen at resolution from a hidden zone, so it is not a Board target.
  assert.deepEqual(playInstruction.args.pick, { kind: "constant", value: "jayce.gear-in-hand" });
  assert.equal(playInstruction.args.location, undefined);
  assert.equal(playInstruction.linkedTo, undefined);
  // "this turn" is a one-shot permission window; the frozen IR has no such
  // duration, so the play instruction is not gated by an invented condition.
  assert.equal(playInstruction.condition, undefined);

  // 356.1.b.2: "ignoring its Energy cost" sets only the base Energy to zero and
  // keeps the Power cost; the concrete numbers need the chosen card's printed
  // values, which only the cost pipeline can bind (unmerged).
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: ["printed"], xp: 0, ignoreEnergyOnly: true }
  });

  // 206: the Energy ceiling is a printed-cost comparison; the frozen ObjectFilter
  // has no cost predicate, so the key is descriptive only (see judgeReason).
  assert.equal(playInstruction.picks.length, 1);
  const [pick] = playInstruction.picks;
  assert.equal(pick.id, "jayce.gear-in-hand");
  assert.deepEqual(pick.filter, {
    zone: "hand",
    type: "gear",
    owner: "self",
    costEnergyLte: 7
  });
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
});

test("sfd-084-221 Jayce, Man of Progress golden: accepting the may-kill kills the locked friendly gear", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("friendly-gear", { types: ["gear"], owner: "A", controller: "A" })
    .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
    .build();
  const gearRef = kernel.ref("friendly-gear");
  // Isolate the merged kill half: the play half needs the unmerged cost plan and
  // permission window, so its own effect.play scenario is asserted separately.
  kernel.setTargets(TARGET_ID, [gearRef]);
  kernel.setAnswers({ [MAY_KILL_ID + "/optional"]: true });
  const outcome = resolveChainBody([{
    ...mayKill,
    args: {
      ...mayKill.args,
      body: { kind: "constant", value: [killInstruction] }
    }
  }], boundWorld(kernel));

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, KILL_ID).result.status, "executed");
  assert.deepEqual(kernel.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  // "a friendly gear": the opponent's gear was never a legal target.
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("sfd-084-221 Jayce, Man of Progress golden: declining leaves every gear on the Board", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("friendly-gear", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const outcome = resolveWith(kernel, {
    gearRef: kernel.ref("friendly-gear"),
    acceptKill: false
  });

  assert.deepEqual(outcome.results.map((entry) => entry.id), [MAY_KILL_ID]);
  assert.equal(resultFor(outcome, MAY_KILL_ID).result.status, "negated");
  assert.equal(resultFor(outcome, MAY_KILL_ID).result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.deepEqual(outcome.events, []);
});

test("sfd-084-221 Jayce, Man of Progress golden: a gear that left the Board makes the may node ignored (359.3.e)", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("fleeing-gear", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const stale = kernel.ref("fleeing-gear");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const outcome = resolveWith(kernel, { gearRef: stale, acceptKill: true });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(resultFor(outcome, MAY_KILL_ID).result, {
    status: "ignored",
    reason: "mistargeted"
  });
  // The ignored may node suppresses its children (contract 3.4).
  assert.equal(resultFor(outcome, KILL_ID), undefined);
  assert.equal(kernel.getObject("fleeing-gear").zone, "hand");
});

test("sfd-084-221 Jayce, Man of Progress golden: the merged play primitive plays the locked gear with a finalize-supplied plan", () => {
  const kernel = world().player("A").hand("steraks-gage", { types: ["gear"], owner: "A", controller: "A" }).build();
  const run = runInstruction(
    play,
    {
      pick: "jayce.gear-in-hand",
      cost: {
        kind: "constant",
        // 356.1.b.2: Energy ignored (0), Power still owed — the golden supplies
        // the finalized plan the cost pipeline must produce.
        value: { finalized: true, energy: 0, power: ["Mind"], xp: 0 }
      },
      linkKey: "played"
    },
    { world: kernel, picks: { "jayce.gear-in-hand": [kernel.ref("steraks-gage")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("steraks-gage").zone, "board");
});

test.todo(
  "sfd-084-221 Jayce, Man of Progress: gate the play on the kill receipt ('If you do', CR 359.3.e.14.b) " +
    "once the frozen IR has an action-result binding (condition.result; RIFT-89)"
);
test.todo(
  "sfd-084-221 Jayce, Man of Progress: enforce 'a gear with Energy cost no more than 7' as a working " +
    "printed-cost restriction (CR 206; the ObjectFilter has no cost predicate — RIFT-90)"
);
test.todo(
  "sfd-084-221 Jayce, Man of Progress: generate the ignore-Energy-only cost plan (356.1.b.2) for the chosen " +
    "hand card and provide the 'this turn' one-shot play permission window (355.5; RIFT-89 / RIFT-91 follow-up)"
);
