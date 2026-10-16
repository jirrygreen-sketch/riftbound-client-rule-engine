import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/beast-below.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps the card's Expr arguments inside
// one literal envelope so each merged primitive validates and evaluates them
// itself. The golden runs use that same path instead of hand-decoding args.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e2b4fefd3d5809000d8c2e95e0323ac6e79155e7f3f1b924a7f1131f22459abb";
const SOURCE_TEXT = "When you play me, return another friendly unit and an enemy unit to their owners' hands.";

const [ability] = program.abilities;
const [returnFriendly, returnEnemy] = ability.body;

// The reference kernel compares filter values literally, so the friendly/enemy
// placeholders are bound as Finalize-locked targets (the production target
// pipeline resolves them at Finalize, RIFT-90). The TargetSpecs stay in the
// program and are asserted structurally; the body runs without re-declaring
// them, the challenge / one-two-punch convention.
const executableBody = ability.body.map(({ targets, ...rest }) => rest);

test("sfd-132-221 Beast Below: program validates, is registered and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-132-221 Beast Below: play-effect trigger scoped to this card (383.4.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.1/383.4.a.2: "When you play me" is the Play Effect, put on the
  // Chain as a Pending Item after the Permanent is played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-132-221 Beast Below: one other friendly unit and one enemy unit, each its own target", () => {
  assert.deepEqual(
    ability.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["beast-below.return-friendly-unit", "effect.zone"],
      ["beast-below.return-enemy-unit", "effect.zone"]
    ]
  );

  // 355.5/355.7/355.9.a.1: units on the Board are chosen specifically, so each
  // clause is a Target. "another" excludes the source itself via the contract
  // 3.6 exclude anchor; "friendly"/"enemy" are the controller selectors
  // (740.1.a/740.1.b).
  assert.deepEqual(returnFriendly.targets, [
    {
      id: "beast-below.other-friendly-unit",
      filter: { type: "unit", controller: "self", zone: "board", exclude: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(returnEnemy.targets, [
    {
      id: "beast-below.enemy-unit",
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(returnFriendly.picks, undefined);
  assert.equal(returnEnemy.picks, undefined);
});

test("sfd-132-221 Beast Below: both clauses are return-to-hand through effect.zone, unlinked", () => {
  for (const instruction of ability.body) {
    assert.deepEqual(instruction.args.target, {
      kind: "constant",
      value: instruction.id === "beast-below.return-friendly-unit"
        ? "beast-below.other-friendly-unit"
        : "beast-below.enemy-unit"
    });
    // 448.2: a return to hand is a zone change, not a Move; the closed
    // return-to-hand action routes each card to its owner's hand.
    assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // The two sentences do not read each other's result (359.3.e.14), so
    // neither is linked to the other.
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.condition, undefined);
  }
});

test("sfd-132-221 Beast Below golden: the other friendly unit and the enemy unit both return to their owners' hands", () => {
  const kernel = world()
    .unit("beast", { owner: "A", might: 8 })
    .unit("ally", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  kernel.setTargets("beast-below.other-friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("beast-below.enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["beast-below.return-friendly-unit", "executed"],
      ["beast-below.return-enemy-unit", "executed"]
    ]
  );
  // "to their owners' hands": each card goes to its own owner's hand and the
  // source unit stays on the Board ("another").
  assert.equal(kernel.getObject("ally").zone, "hand");
  assert.equal(kernel.getObject("enemy").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["ally"]);
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy"]);
  assert.equal(kernel.getObject("beast").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand", "return-to-hand"]);
});

test("sfd-132-221 Beast Below golden: a stale friendly target ignores only that clause (359.3.e.7)", () => {
  const kernel = world()
    .unit("beast", { owner: "A", might: 8 })
    .unit("ally", { owner: "A", might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("beast-below.other-friendly-unit", [stale]);
  kernel.setTargets("beast-below.enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.getObject("enemy").zone, "hand");
  assert.equal(kernel.getObject("ally").zone, "trash");
});

test("sfd-132-221 Beast Below golden: the merged effect.zone alone returns a locked Board unit to hand", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 3 }).build();
  const run = runInstruction(
    zone,
    { target: "beast-below.enemy-unit", to: { kind: "constant", value: "hand" } },
    { world: kernel, targets: { "beast-below.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.linked.destination, "hand");
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
});

test.todo(
  "sfd-132-221 Beast Below: the card-played subscription reaches this ability through the " +
    "trigger -> chain pipeline with the 383.4.a.2 Pending ordering and Finalize-time locking of both " +
    "Board targets (355.8/355.9) — CardProgram -> TriggerRegistration adapter, RIFT-120 follow-up"
);

test.todo(
  "sfd-132-221 Beast Below: Finalize resolves the exclude: \"self\" anchor against the ability source " +
    "(740.1.a \"another\") and rejects Beast Below itself as the friendly unit; the reference path used " +
    "above pre-locks the targets, so this wiring is unverified (RIFT-90 target plan)"
);
