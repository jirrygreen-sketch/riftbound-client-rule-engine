import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/tomb-raider-barbara.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6ccd172775e91456e983a8fb755f02c8109a6e6dca539bb690585245e7e22176";
const SOURCE_TEXT =
  "When you play me, if you control 7 or more runes, choose an enemy gear. If it's [Empowered], disempower it. Otherwise, kill it.";

const GEAR = "tomb-raider-barbara.enemy-gear";
const [ability] = program.abilities;
const [disempower, kill] = ability.body;

/**
 * The printed branches are discriminated by the target's Empowered status, which
 * remains gated on the pending predicate (442.1.a / 442.2; see judgeReason), so each branch is
 * driven directly with the descriptive expression condition stripped — the same
 * treatment merged goldens give to descriptive condition data. Everything else is
 * the card's own IR (its TargetSpec id, its own args) executed for real.
 */
const branchBody = (instruction) => {
  const { condition: _condition, targets: _targets, ...rest } = instruction;
  return [rest];
};

const barbaraWorld = (gearEmpowered) => {
  const kernel = world()
    .unit("barbara", { might: 4, location: { type: "base", player: "A" } })
    .build();
  const gear = kernel.addObject({
    ...kernel.getObject("barbara"),
    ref: { id: "enemy-gear", zoneEntryId: 1 },
    cardId: "card:sfd-022-221",
    name: "Long Sword",
    types: ["gear"],
    tags: ["Equipment"],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    attachedTo: null
  }, "board");
  if (gearEmpowered) kernel.perform({ type: "empower", object: gear });
  kernel.setTargets(GEAR, [gear]);
  return kernel;
};

test("ven-037-166 Tomb-Raider Barbara: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-037-166 Tomb-Raider Barbara: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-037-166 Tomb-Raider Barbara: the play trigger carries the printed rune-count trigger condition", () => {
  // 383.4.a: "When you play me" is a Play Effect on the closed card-played point.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);

  // 383.2.a.1: "if you control 7 or more runes" immediately follows the trigger
  // condition, so it belongs to the Trigger Condition (CR's Sona example). Runes
  // the controller channeled sit in their rune zone (133.5.a.1 / 431.1).
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 7 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    controller: "self",
    zone: "rune-zone"
  });
});

test("ven-037-166 Tomb-Raider Barbara: 'choose an enemy gear' is one TargetSpec shared by both branches", () => {
  // 355.5 / 355.7 / 355.9.a.1 / 355.9.b: naming an enemy gear on the public Board
  // makes it a target, chosen once at Finalize and revalidated at resolve.
  assert.equal(ability.body.length, 2);
  for (const instruction of [disempower, kill]) {
    assert.deepEqual(instruction.targets, [
      {
        id: GEAR,
        filter: { type: "gear", zone: "board", controller: "opponent" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
  }
  assert.equal(disempower.id, "tomb-raider-barbara.disempower-empowered-gear");
  assert.equal(disempower.op, "effect.empower");
  assert.deepEqual(disempower.args.objects, {
    kind: "constant",
    value: { kind: "target", id: GEAR }
  });
  // 443.1 / 443.1.a: Disempower only affects an Empowered object.
  assert.deepEqual(disempower.args.mode, { kind: "constant", value: "disempower" });
  assert.equal(disempower.linkedTo, undefined);

  // 429.1 / 429.2.a: Kill moves a Board permanent to its owner's trash.
  assert.equal(kill.id, "tomb-raider-barbara.kill-otherwise");
  assert.equal(kill.op, "effect.kill");
  assert.deepEqual(kill.args.target, { kind: "constant", value: GEAR });
});

test("ven-037-166 Tomb-Raider Barbara: the two printed branches are mutually exclusive negations", () => {
  // "If it's [Empowered] … Otherwise …" reads one status before and after the same
  // negation, so exactly one branch executes even though the discriminator itself
  // remains descriptive until the Empowered predicate is wired (see judgeReason).
  assert.deepEqual(disempower.condition, {
    kind: "expression",
    value: { kind: "constant", value: "target-is-empowered" }
  });
  assert.deepEqual(kill.condition, {
    kind: "not",
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "target-is-empowered" }
    }
  });
});

test("ven-037-166 Tomb-Raider Barbara golden: disempowering an Empowered enemy gear removes its status (443.1.b)", () => {
  const kernel = barbaraWorld(true);
  // The reference kernel models the Empowered status as a counter (442.1.a);
  // 443.1.b removes one status.
  assert.equal(kernel.getObject("enemy-gear").empowered, 1);

  const outcome = runAbilityBody(branchBody(disempower), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["disempower"]);
  // The default link key follows the mode ("disempowered") and records the
  // objects the action actually completed for (effect.empower's contract).
  assert.deepEqual(outcome.linkedValues["tomb-raider-barbara.disempower-empowered-gear.disempowered"], {
    mode: "disempower",
    count: 1,
    objects: [kernel.ref("enemy-gear")]
  });
  assert.equal(kernel.getObject("enemy-gear").empowered, 0);
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("ven-037-166 Tomb-Raider Barbara golden: killing the otherwise enemy gear sends it to its owner's trash (429.1)", () => {
  const kernel = barbaraWorld(false);

  const outcome = runAbilityBody(branchBody(kill), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(kernel.objectsInZone("B", "trash").map(ref => ref.id), ["enemy-gear"]);
  // 429.5.b: the kill receipt names the objects that actually left the Board.
  // The receipt keeps the reference used for the action (pre-leave zone entry),
  // which is what later "if you do" checks read.
  assert.deepEqual(outcome.linkedValues["tomb-raider-barbara.kill-otherwise.killed"], [
    { id: "enemy-gear", zoneEntryId: 1 }
  ]);
  assert.equal(kernel.ref("enemy-gear").zoneEntryId, 2);
});

test("ven-037-166 Tomb-Raider Barbara golden: a gear that left the Board is ignored, not re-killed (359.3.e.7)", () => {
  const kernel = barbaraWorld(false);
  const stale = kernel.ref("enemy-gear");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(GEAR, [stale]);

  const outcome = runAbilityBody(branchBody(kill), kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("enemy-gear").zone, "hand");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "ven-037-166 Tomb-Raider Barbara: evaluate \"if it's [Empowered]\" (442.1.a / 442.2) so the two printed " +
    "branches discriminate on the chosen gear's status instead of descriptive condition data — wire the Empowered " +
    "status predicate into CardProgram conditions (RIFT-359)"
);
