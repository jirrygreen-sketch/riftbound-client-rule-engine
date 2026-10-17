// Scenario evidence: ../templates/keyword-play-effect-kill-682.test.mjs.
// Main-phase admission only; the per-player effect remains blocked below.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/acceptable-losses.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-b3827545fbd7637410bd870c5f9e3d7996c213e335b7df3d7fe6460e05c58891";
const play = program.abilities.find((ability) => ability.kind === "play");
const [killInstruction] = play.body;
const [pickSpec] = killInstruction.picks;

test("ogn-179-298 Acceptable Losses: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /412\.1/);
  assert.match(program.judgeReason, /chooser\/controller/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Each player kills one of their gear."
  );
});

test("ogn-179-298 Acceptable Losses: one non-target kill pick, never a target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "acceptable-losses.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  // "Each player kills one of their gear" does not target (355.10.e), so the
  // instruction must not declare a TargetSpec.
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.deepEqual(killInstruction.args.picks, {
    kind: "constant",
    value: "acceptable-losses.gear"
  });
  assert.deepEqual(killInstruction.args.count, { kind: "constant", value: 1 });

  assert.equal(killInstruction.picks.length, 1);
  assert.deepEqual(pickSpec, {
    id: "acceptable-losses.gear",
    options: ["dynamic:one-gear-the-choosing-player-controls"],
    min: 1,
    max: 1,
    selection: "one",
    filter: { type: "gear", zone: "board", controller: "self" }
  });
});

test("ogn-179-298 Acceptable Losses golden: the chosen gear is killed into its owner's trash (429.2)", () => {
  const kernel = world()
    .object("owned-gear", { owner: "B", controller: "B", zone: "board", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value, count: killInstruction.args.count },
    { world: kernel, picks: { [pickSpec.id]: [kernel.ref("owned-gear")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("owned-gear").zone, "trash");
  assert.deepEqual(kernel.objectsInZone("B", "trash").map((ref) => ref.id), ["owned-gear"]);
  assert.deepEqual(run.linked.killed, [{ id: "owned-gear", zoneEntryId: 1 }]);
});

test("ogn-179-298 Acceptable Losses golden: a stale pick leaves the board untouched (429.2.a)", () => {
  const kernel = world()
    .object("returned-gear", { owner: "B", zone: "board", types: ["gear"], location: { type: "base", player: "B" } })
    .build();
  const stale = kernel.ref("returned-gear");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value },
    { world: kernel, picks: { [pickSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("returned-gear").zone, "hand");
});

test("ogn-179-298 Acceptable Losses: the original body consumes a supplied non-target pick and publishes its kill receipt", () => {
  const kernel = world()
    .object("chosen-gear", { owner: "A", types: ["gear"], zone: "board" })
    .object("other-gear", { owner: "B", types: ["gear"], zone: "board" })
    .build();
  kernel.setPicks(pickSpec.id, [kernel.ref("chosen-gear")]);
  // This proves the supported one-player sub-effect, not the missing loop.
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.killed, [{ id: "chosen-gear", zoneEntryId: 1 }]);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
  assert.equal(kernel.getObject("chosen-gear").zone, "trash");
  assert.equal(kernel.getObject("other-gear").zone, "board");
});

test.todo(
  "ogn-179-298 Acceptable Losses: per-player iteration must bind each chooser's own gear and kill responsibility at resolution (CR 355.10.e/412.1); ordered zoneSlice/linked sources do not supply that scope."
);
