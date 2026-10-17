import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/not-so-fast.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-33c64673bc887d04d061bcae6dce39ed0eb58011d8102f4f2426e9d43b6a8bdc";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter an enemy spell or ability that chooses a friendly unit or gear.";

const [reaction, play] = program.abilities;
const [counterInstruction] = play.body;
const targetSpec = counterInstruction.targets[0];
// The authored filter carries the descriptive chosen-target restriction
// (choosesFriendly), which no merged matcher evaluates. Golden execution
// therefore locks the finalized Chain target (the defy / wind-wall convention)
// instead of re-deriving candidates; the card's own TargetSpec is asserted
// structurally below and the missing predicate is recorded as a TODO.
const executableBody = play.body.map(({ targets, ...rest }) => rest);

/** A finalized Chain item controlled by an opponent, as the kernel models it. */
const chainSpell = (id, owner = "B") => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id
});

test("sfd-045-221 Not So Fast: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-045-221 Not So Fast: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-045-221 Not So Fast: judgeReason names the chosen-target restriction gap", () => {
  assert.match(program.judgeReason, /754/);
  assert.match(program.judgeReason, /355\.9\.a\.2/);
  // The counter body itself is merged; the reason must stay about the real gap:
  // reading the chain item's finalized target plan (355.9.a.2 / CR 754).
  assert.match(program.judgeReason, /Finalize 目标计划/);
});

test("sfd-045-221 Not So Fast: [Reaction] keyword plus the printed 2 energy + 1 Calm power cost", () => {
  assert.equal(program.abilities.length, 2);
  // 813: permissive speed keyword (the registry owns the Closed State grant).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
});

test("sfd-045-221 Not So Fast: one counter instruction targeting an enemy Chain item", () => {
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "not-so-fast.counter-chosen-item");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.equal(counterInstruction.linkedTo, undefined);
  assert.equal(counterInstruction.condition, undefined);
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "not-so-fast.enemy-item" }
  });

  // "a spell or ability" = finalized Chain items (355.9.a.2); the enemy
  // relationship is 740.1.b. choosesFriendly is the descriptive part of the
  // printed restriction (754), which no merged predicate evaluates yet.
  assert.deepEqual(targetSpec, {
    id: "not-so-fast.enemy-item",
    filter: {
      type: ["spell", "ability"],
      zone: "chain",
      controller: "opponent",
      choosesFriendly: ["unit", "gear"]
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(instructionDefinitionsById.get("effect.counter"), counter);
});

test("sfd-045-221 Not So Fast golden: the countered spell is cleared from the Chain (426.1-426.3)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const target = kernel.ref("enemy-spell");
  kernel.setTargets("not-so-fast.enemy-item", [target]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.countered, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.counteredObjects, [
    { id: "enemy-spell", zoneEntryId: 1 }
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
  // 426.2: the countered item does nothing and leaves the Chain; its costs are
  // not refunded (426.3).
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.equal(kernel.object(target), null);
});

test("sfd-045-221 Not So Fast golden: a Chain item that already left is ignored (359.3.e.6)", () => {
  const kernel = world().object("enemy-spell", chainSpell("enemy-spell", "B")).build();
  const stale = kernel.ref("enemy-spell");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  kernel.setTargets("not-so-fast.enemy-item", [stale]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
});

test("sfd-045-221 Not So Fast golden: a Board permanent is never a legal Chain target (355.9.a.2)", () => {
  const kernel = world().unit("board-unit", { owner: "B", controller: "B" }).build();
  kernel.setTargets("not-so-fast.enemy-item", [kernel.ref("board-unit")]);

  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("board-unit").zone, "board");
});

test.todo(
  "sfd-045-221 Not So Fast: 'that chooses a friendly unit or gear' needs the target system to expose a Chain " +
    "item's chosen targets (the became-target record of CR 754) so the restriction can be evaluated at Finalize " +
    "and rechecked at resolution (RIFT-90); the restriction is declared, not dropped."
);
