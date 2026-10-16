import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cull-the-weak.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-3f533cd1f26b1998b23e4537e0fd7e5c386685bf6abffe0e6e211b3f43845744";
const [play] = program.abilities;
const [killInstruction] = play.body;
const pickSpec = killInstruction.picks[0];

test("Cull the Weak program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Cull the Weak identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("355.10.e"), true);
  assert.equal(program.judgeReason.includes("RIFT-9"), true);
  assert.equal(program.judgeReason.includes("RIFT-257"), true);
  assert.equal(program.judgeReason.includes("RIFT-261"), true);
  assert.equal(program.sourceText, "Each player kills one of their units.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Cull the Weak structure: one non-targeted kill over each seat's own units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  // 355.10.e / 355.18: "Each player kills a unit they control" does not target,
  // so the choice is a pick, never a TargetSpec (355.7, contract 3.4).
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.targets, undefined);
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "cull-the-weak.units" }
  });
  assert.equal(killInstruction.picks.length, 1);
  assert.equal(pickSpec.id, "cull-the-weak.units");
  assert.deepEqual(pickSpec.options, ["one-unit-per-player"]);
  assert.deepEqual(pickSpec.filter, { types: "unit", owner: "controller" });
  assert.equal(pickSpec.selection, "any");
});

test("Cull the Weak golden: the picked units are killed through the merged primitive", () => {
  // The per-seat choice itself (one unit for every player) needs the unmerged
  // roster-wide selection (see judgeReason), so the merged half is executed
  // with the resolution-time picks locked, exactly as effect.kill reads them.
  const kernel = world()
    .unit("a-unit", { owner: "A", controller: "A" })
    .unit("a-other", { owner: "A", controller: "A" })
    .unit("b-unit", { owner: "B", controller: "B" })
    .build();
  const picks = [kernel.ref("a-unit"), kernel.ref("b-unit")];
  const run = runInstruction(kill, { picks: killInstruction.args.picks.value }, {
    world: kernel,
    picks: { "cull-the-weak.units": picks }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("a-unit").zone, "trash");
  assert.equal(kernel.getObject("b-unit").zone, "trash");
  // "do as much as you can" (055): units nobody chose stay on the board.
  assert.equal(kernel.getObject("a-other").zone, "board");
  assert.deepEqual(run.events.map(event => event.action), ["kill", "kill"]);
  assert.deepEqual(run.linked.killed, picks);
});

test("Cull the Weak golden: a seat with no units simply kills none (055)", () => {
  const kernel = world().unit("a-unit", { owner: "A", controller: "A" }).build();
  const run = runInstruction(kill, { picks: killInstruction.args.picks.value }, {
    world: kernel,
    picks: { "cull-the-weak.units": [kernel.ref("a-unit")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("a-unit").zone, "trash");
  // The link keeps the pre-kill reference; the kill itself moved the object on
  // to a new zone incarnation (124).
  assert.equal(run.linked.killed.length, 1);
  assert.equal(run.linked.killed[0].id, "a-unit");
});

test("Cull the Weak golden: an empty pick list leaves the board untouched", () => {
  const kernel = world().unit("a-unit", { owner: "A", controller: "A" }).build();
  const run = runInstruction(kill, { picks: killInstruction.args.picks.value }, {
    world: kernel,
    picks: { "cull-the-weak.units": [] }
  });

  // No pick was made, so nothing was resolved. effect.kill reports an empty
  // kill set as ignored/mistargeted for that path (contract 3.3), and no unit
  // is killed; the card never invents a target to fill the slot.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("a-unit").zone, "board");
});

test.todo(
  "Cull the Weak: the per-seat choice — every player (including the caster) chooses one of " +
    "their own units on resolution and each choice is killed — needs the roster-wide player " +
    "selection/repetition primitive (RIFT-9 target.player) and its resolution-time choice " +
    "handling."
);

test.todo(
  "Cull the Weak: Finalize/Resolve timing for the table-wide pick and 355.18's " +
    "resolution-time choices belong to the target/pick system (RIFT-90)."
);
