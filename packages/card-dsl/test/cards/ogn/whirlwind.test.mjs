import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/whirlwind.js";
// Card bodies run through the chain's interpreter adapter, the production entry
// point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-c976afe00288482575b7680eb7b742f74eaeb3aac7fab39be31717e7986af99f";
const play = program.abilities[0];
const [optionalInstruction] = play.body;
const [returnInstruction] = optionalInstruction.args.body.value;
const [pickSpec] = returnInstruction.picks;

test("ogn-187-298 Whirlwind: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /picks/);
  assert.equal(
    program.sourceText,
    "Starting with the next player, each player may return a unit to its " +
      "owner's hand."
  );
});

test("ogn-187-298 Whirlwind: one optional wrapper carrying a non-target return", () => {
  // No speed keyword: the printing has no [Action]/[Reaction] line.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // "may" is choice.optional with the chosen instruction inside body. The
  // interpreter wraps the return instruction (contract 3.9), it is not a
  // pre-declared choice plus a linkedTo instruction.
  assert.equal(optionalInstruction.id, "whirlwind.each-player");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.linkedTo, undefined);
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.deepEqual(optionalInstruction.args.prompt, {
    kind: "constant",
    value: "Return a unit to its owner's hand?"
  });

  assert.equal(returnInstruction.id, "whirlwind.return-unit");
  assert.equal(returnInstruction.op, "effect.zone");
  // 355.10.e: the returned unit is chosen as the spell resolves, so it is a
  // pick, not a target.
  assert.equal(returnInstruction.targets, undefined);
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(pickSpec, {
    id: "whirlwind.unit",
    options: ["dynamic:one-unit-on-the-board"],
    min: 1,
    max: 1,
    selection: "one",
    filter: { type: "unit", zone: "board" }
  });
});

test("ogn-187-298 Whirlwind golden: accepting returns the chosen unit to its owner's hand", () => {
  const kernel = world()
    .object("whirlwind", { owner: "A", controller: "A", zone: "chain", types: ["spell"] })
    .unit("enemy-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setPicks(pickSpec.id, [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "whirlwind.each-player/optional": true });
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["whirlwind.return-unit", "executed"],
      ["whirlwind.each-player", "executed"]
    ]
  );
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand"]);
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["enemy-unit"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.equal(outcome.linkedValues["whirlwind.each-player.value"], true);
});

test("ogn-187-298 Whirlwind golden: declining skips the return and changes nothing", () => {
  const kernel = world()
    .object("whirlwind", { owner: "A", controller: "A", zone: "chain", types: ["spell"] })
    .unit("enemy-unit", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setPicks(pickSpec.id, [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "whirlwind.each-player/optional": false });
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  // Refusal is negated/skipped (contract 3.9) and the nested instruction never runs.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [["whirlwind.each-player", "negated", "skipped"]]
  );
  assert.equal(kernel.events.length, 0);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.deepEqual(kernel.objectsInZone("B", "hand"), []);
});

test.todo(
  "ogn-187-298 Whirlwind: 'Starting with the next player, each player' must ask each player in " +
    "turn order whether to return a unit of theirs — needs a player iteration / per-chooser pick " +
    "binding (target.player and pick chooser scoping are unmerged)"
);
