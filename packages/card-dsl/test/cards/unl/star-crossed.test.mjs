import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/star-crossed.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c237d595f64a88ab3cacf2dfa2935f94ed51b2fff1a6628f33719e23e2161eb1";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Return a friendly unit and an enemy unit to their owners' hands.";

const [reactionKeyword, play] = program.abilities;
const [returnFriendly, returnEnemy] = play.body;
const friendlySpec = returnFriendly.targets[0];
const enemySpec = returnEnemy.targets[0];

// TargetSpec placeholders are resolved at Finalize in production; the golden
// binds them through setTargets and executes the body without re-declaring
// them (the one-two-punch / challenge convention).
const executableBody = play.body.map(({ targets, ...rest }) => rest);

test("unl-128-219 Star-Crossed: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-128-219 Star-Crossed: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-128-219 Star-Crossed: [Reaction], printed 3 energy + 1 power and two Return instructions", () => {
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["star-crossed.return-friendly-unit", "effect.zone"],
      ["star-crossed.return-enemy-unit", "effect.zone"]
    ]
  );
});

test("unl-128-219 Star-Crossed: one friendly and one enemy unit are targeted, and each Return routes to Hand", () => {
  // 355.5 / 355.7 / 355.9.b: two specific Board units, one per controller.
  assert.deepEqual(friendlySpec, {
    id: "star-crossed.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(enemySpec, {
    id: "star-crossed.enemy-unit",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "to their owners' hands": effect.zone submits the return-to-hand action
  // (056.1), which the action layer routes to the card's owner.
  assert.deepEqual(returnFriendly.args, {
    target: { kind: "constant", value: "star-crossed.friendly-unit" },
    to: { kind: "constant", value: "hand" }
  });
  assert.deepEqual(returnEnemy.args, {
    target: { kind: "constant", value: "star-crossed.enemy-unit" },
    to: { kind: "constant", value: "hand" }
  });
  // Independent sentences: neither Return references the other's result, so
  // neither is linked (359.3.e.14) and one failing does not suppress the other.
  assert.equal(returnFriendly.linkedTo, undefined);
  assert.equal(returnEnemy.linkedTo, undefined);
  assert.equal(returnFriendly.condition, undefined);
  assert.equal(returnEnemy.condition, undefined);
});

test("unl-128-219 Star-Crossed golden: both chosen units return to their owners' hands", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  kernel.setTargets(friendlySpec.id, [kernel.ref("friendly")]);
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy")]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["star-crossed.return-friendly-unit", "executed"],
      ["star-crossed.return-enemy-unit", "executed"]
    ]
  );
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["friendly"]);
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy"]);
  // 124: entering a Non-Board zone creates a new object identity, so the old
  // zone-bound references are invalid.
  assert.equal(kernel.getObject("friendly").zone, "hand");
  assert.equal(kernel.getObject("friendly").ref.zoneEntryId, 2);
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand", "return-to-hand"]);
});

test("unl-128-219 Star-Crossed golden: a unit returns to its owner's hand, not its controller's (056.1)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A" })
    // A stolen enemy unit is controlled by A but owned by B.
    .unit("stolen", { owner: "B", controller: "A" })
    .build();
  kernel.setTargets(friendlySpec.id, [kernel.ref("friendly")]);
  kernel.setTargets(enemySpec.id, [kernel.ref("stolen")]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["friendly"]);
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["stolen"]);
});

test("unl-128-219 Star-Crossed golden: a stale friendly target ignores only its own Return (359.3.e.7)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .build();
  const stale = kernel.ref("friendly");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(friendlySpec.id, [stale]);
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy")]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy"]);
});

test.todo(
  "Star-Crossed: [Reaction] admission during a Closed State on any player's turn (CR 813.1.b/813.1.c, " +
    "159.2.b) belongs to the keyword registry expansion plus the chain's canAct check (contract 3.5 / RIFT-85 / RIFT-120)"
);

test.todo(
  "Star-Crossed: Finalize-time locking of both units plus their became-target events (355.8, 754) and the base " +
    "cost payment (3 energy + 1 Chaos power) belong to the target system and cost plan (RIFT-90 / RIFT-89)"
);
