import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/tactical-retreat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead. " +
  "(Send it to base. This isn't a move.)";

const [speed, play] = program.abilities;
const [replacement] = play.body;
const [healInstruction, exhaustInstruction, recallInstruction] = replacement.args.instead.value;
// The replacement body is executed with the card's own instructions; the
// kernel owns the locked target set, so the TargetSpecs are removed before the
// run (the soraka-wanderer / highlander-yi convention).
const executableInstead = replacement.args.instead.value.map(({ targets, ...rest }) => rest);

test("unl-175-219 Tactical Retreat: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /457/);
  assert.match(program.judgeReason, /next time/);
});

test("unl-175-219 Tactical Retreat: [Reaction] plus the printed 2 energy cost", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("unl-175-219 Tactical Retreat: the chosen friendly unit is a target, not part of the replacement", () => {
  // 355.10.c's own example: "Choose a friendly unit. The next time it would
  // die this turn, return it to your hand instead" targets the friendly unit
  // because the choice is not part of the replacement effect.
  assert.equal(play.body.length, 1);
  assert.equal(replacement.id, "tactical-retreat.register-death-replacement");
  assert.equal(replacement.op, "replacement.event");
  assert.deepEqual(replacement.args.event, { kind: "constant", value: "object-killed" });
  // The printed "the next time ... this turn" one-occurrence window has no
  // merged representation (TriggerSpec.once has no next-time scope).
  assert.deepEqual(replacement.args.window, { kind: "constant", value: "next-time-this-turn" });
  assert.deepEqual(replacement.args.object, {
    kind: "constant",
    value: "tactical-retreat.chosen-unit"
  });
  assert.deepEqual(replacement.targets, [
    {
      id: "tactical-retreat.chosen-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-175-219 Tactical Retreat: the instead-body heals, exhausts, then recalls the same unit", () => {
  // "it" in all three clauses refers to the chosen unit (355.10.c), so every
  // instruction names the same declared TargetSpec.
  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "tactical-retreat.chosen-unit" }
  });
  assert.equal(healInstruction.linkedTo, undefined);

  // 415.1: the exhaustion is part of the replaced outcome.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.equal(exhaustInstruction.linkedTo, "tactical-retreat.heal");
  assert.deepEqual(exhaustInstruction.args.target, {
    kind: "constant",
    value: "tactical-retreat.chosen-unit"
  });

  // 457 / 458: a Recall is not a Move; the merged primitive refuses to
  // substitute move-location and reports blockedReason instead.
  assert.equal(recallInstruction.op, "effect.move");
  assert.equal(recallInstruction.linkedTo, "tactical-retreat.exhaust");
  assert.deepEqual(recallInstruction.args.objects, {
    kind: "constant",
    value: { target: "tactical-retreat.chosen-unit" }
  });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
});

test("unl-175-219 Tactical Retreat golden: the heal and exhaust halves clear the damage and exhaust the unit", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, damage: 2, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets("tactical-retreat.chosen-unit", [kernel.ref("ally")]);
  const outcome = resolveChainBody(executableInstead, kernel);

  // Heal and exhaust execute against the real kernel; the Recall half is
  // covered by a TODO below, so its own result is not asserted here.
  const resultFor = (id) => outcome.results.find((entry) => entry.id === id).result;
  assert.equal(resultFor("tactical-retreat.heal").status, "executed");
  assert.equal(resultFor("tactical-retreat.exhaust").status, "executed");
  // 419.1-419.3.a: all marked damage is cleared.
  assert.equal(kernel.getObject("ally").damage, 0);
  assert.deepEqual(outcome.linkedValues["tactical-retreat.heal.healed"], {
    amount: 2,
    count: 1,
    objects: [{ id: "ally", zoneEntryId: 1 }]
  });
  // 415.1: the unit is exhausted.
  assert.equal(kernel.getObject("ally").exhausted, true);
  // Only the merged halves are asserted; the Recall step's own events stay
  // unspecified so the golden does not depend on its merge state.
  const actions = outcome.events.map((event) => event.action);
  assert.equal(actions.includes("heal"), true);
  assert.equal(actions.includes("exhaust"), true);
});

test("unl-175-219 Tactical Retreat golden: the merged recall mode refuses to approximate a Move (457-460.1)", () => {
  // 458: a Recall is not a Move and cannot be approximated by one. This case
  // only asserts that the recall step performs no ordinary move-location (a
  // silently substituted Move would relocate the unit), which stays true once
  // a real Recall action lands.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("tactical-retreat.chosen-unit", [kernel.ref("ally")]);
  resolveChainBody(executableInstead, kernel);

  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
  assert.equal(kernel.events.some((event) => event.action === "move-location"), false);
});

test("unl-175-219 Tactical Retreat golden: a unit that already left the Board ignores the instead-body (359.3.e.7)", () => {
  const kernel = world().unit("ally", { owner: "A", might: 3, damage: 1 }).build();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("tactical-retreat.chosen-unit", [stale]);
  const outcome = resolveChainBody(executableInstead, kernel);

  const resultFor = (id) => outcome.results.find((entry) => entry.id === id).result;
  assert.deepEqual(resultFor("tactical-retreat.heal"), { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(resultFor("tactical-retreat.exhaust"), { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.getObject("ally").zone, "trash");
});

test.todo(
  "unl-175-219 Tactical Retreat: register the card's death replacement so the chosen unit's death is intercepted, " +
    "with the printed one-occurrence 'the next time ... this turn' window and its end-of-turn expiry " +
    "(CR 368.1/369.1/370.1.a.1) — needs the card-program replacement registration (RIFT-120) and a next-time " +
    "scope (TriggerSpec.once offers per-turn/per-combat/per-chain/per-game only)"
);

test.todo(
  "unl-175-219 Tactical Retreat: bind the replaced event's unit into the replacement body so 'it' stays the " +
    "intercepted unit instead of a new choice (CR 355.10.c) — needs a selector for the replaced event object, " +
    "which the frozen ObjectSelector set does not provide"
);

test.todo(
  "unl-175-219 Tactical Retreat: perform the Recall (CR 457-460: relocates to Base without being a Move, fires no " +
    "Move triggers, cannot be blocked by movement restrictions, keeps statuses) once a Recall action distinct from " +
    "move-location is merged (RIFT-109 follow-up); a plain Move is not an acceptable substitute"
);

