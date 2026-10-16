import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/solari-shieldbearer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-8c930fbf9acbe41ff1f082ade2f82f6957381af2cbf72e31fed54304747e581b";
const SOURCE_TEXT =
  "When you play me, stun a unit. (It doesn't deal combat damage this turn.)";

const triggered = program.abilities[0];
const stunInstruction = triggered.body[0];

/** Run the card's real instruction body against the reference kernel. */
function stunWithLockedTarget(kernel) {
  return runAbilityBody(triggered.body, kernel);
}

test("ogn-051-298 Solari Shieldbearer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.ok ? result.issues : [], []);
});

test("ogn-051-298 Solari Shieldbearer: identity, ruleset, status and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-051-298 Solari Shieldbearer: play trigger at card-played filtered to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
});

test("ogn-051-298 Solari Shieldbearer: one board-unit target for effect.stun", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(stunInstruction.id, "solari-shieldbearer.stun-a-unit");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "solari-shieldbearer.unit" }
  });
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.condition, undefined);

  // 355.5/355.10: "stun a unit" is a Choice of one specific game object, so it
  // is a single TargetSpec; 424.1 limits the candidates to Units on the Board.
  assert.equal(stunInstruction.targets.length, 1);
  assert.deepEqual(stunInstruction.targets[0], {
    id: "solari-shieldbearer.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-051-298 Solari Shieldbearer golden: the chosen unit becomes Stunned", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets("solari-shieldbearer.unit", [kernel.ref("enemy")]);

  const outcome = stunWithLockedTarget(kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  // outcome.events are the primitive's own action events (the stun action).
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.stunned.objects, [
    { id: "enemy", zoneEntryId: 1 }
  ]);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 0);
});

test("ogn-051-298 Solari Shieldbearer golden: a friendly unit is a legal choice too", () => {
  // "a unit" is not restricted to enemy units (355.9.b has no enemy clause
  // here), so a friendly unit is a legal target for the printed text.
  const kernel = world().unit("friendly", { owner: "A", might: 2 }).build();
  kernel.setTargets("solari-shieldbearer.unit", [kernel.ref("friendly")]);

  const outcome = stunWithLockedTarget(kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("friendly").stunned, true);
});

test("ogn-051-298 Solari Shieldbearer golden: an already-Stunned unit is legal and does nothing (CR 424.1.a.1)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5, stunned: true }).build();
  kernel.setTargets("solari-shieldbearer.unit", [kernel.ref("enemy")]);

  const outcome = stunWithLockedTarget(kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 0);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 1);
  assert.deepEqual(outcome.events, []);
});

test("ogn-051-298 Solari Shieldbearer golden: a target that left its zone makes the instruction ignored (CR 359.3.e.7)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5 }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets("solari-shieldbearer.unit", [stale]);

  const outcome = stunWithLockedTarget(kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("enemy").stunned, false);
  assert.equal(kernel.getObject("enemy").zone, "hand");
});

test("ogn-051-298 Solari Shieldbearer golden: no legal target at all is ignored, not an error", () => {
  const kernel = world().build();
  kernel.setTargets("solari-shieldbearer.unit", []);

  const outcome = stunWithLockedTarget(kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

// ---------------------------------------------------------------------------
// Not executable in the merged production path — TODO items with real causes.
// ---------------------------------------------------------------------------

test.todo(
  "ogn-051-298 Solari Shieldbearer: the full chain route (Play Effect placed on the chain " +
    "after the unit enters the board, 383.4.a.2; Finalize target locking and the became-target " +
    "event, 754) needs the engine card-program adapter that turns this program into a chain item " +
    "(P0 contract 7.2 batch 5 / RIFT-120 chain wiring)"
);

test.todo(
  "ogn-051-298 Solari Shieldbearer: the production chain adapter passes effect.stun's target as an " +
    "Expr (chain/interpreter-adapter.ts LITERAL_FIELDS does not list effect.stun), so the primitive " +
    "schema rejects it on the production path; covered here through the interpreter registry and " +
    "reported as a contract change request"
);
