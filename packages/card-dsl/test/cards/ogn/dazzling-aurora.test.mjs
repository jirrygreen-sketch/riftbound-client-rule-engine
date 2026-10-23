import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/dazzling-aurora.js";
// Real execution paths for the measured gaps: the interpreter's instruction
// registry (which decides whether the card's ops exist) and the merged
// effect.reveal / effect.play primitives the card would have to build on.
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-ec34157eb04ae011d9a79dacfd64f6303e1d79eb376db6975abef7998e893318";
const SOURCE_TEXT =
  "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit. " +
  "Play it, ignoring its cost, and recycle the rest.";
const c = value => ({ kind: "constant", value });
const forged = { ...program, status: "executable", judgeReason: undefined };

const [ability] = program.abilities;
const [, playInstruction] = ability.body;

test("ogn-160-298 Dazzling Aurora: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-160-298 Dazzling Aurora: identity, version and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason names the three measured gaps instead of a closed dependency task.
  assert.match(program.judgeReason, /effect\.reveal-until/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /finalized/);
  assert.doesNotMatch(program.judgeReason, /RIFT-358/);
});

test("ogn-160-298 Dazzling Aurora: turn-end trigger with reveal/play/recycle body shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "turn-end");
  assert.equal(ability.trigger.filter.event, "turn-end");
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.optional, false);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "dazzling-aurora.reveal-until-unit",
    "dazzling-aurora.play-unit",
    "dazzling-aurora.recycle-rest"
  ]);
  const [revealInstruction, playInstruction, recycleInstruction] = ability.body;
  assert.equal(revealInstruction.op, "effect.reveal-until");
  assert.equal(revealInstruction.linkedTo, undefined);
  assert.deepEqual(revealInstruction.args.from, c("deck-top"));
  assert.deepEqual(revealInstruction.args.until, c({ type: "unit" }));

  assert.equal(playInstruction.op, "effect.play");
  assert.equal(playInstruction.linkedTo, "dazzling-aurora.reveal-until-unit");
  assert.equal(playInstruction.args.object.instructionId, "dazzling-aurora.reveal-until-unit");
  assert.equal(playInstruction.args.object.key, "revealedUnit");
  assert.deepEqual(playInstruction.args.ignoreCost, c("printed"));

  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, "dazzling-aurora.reveal-until-unit");
  assert.equal(recycleInstruction.args.objects.instructionId, "dazzling-aurora.reveal-until-unit");
  assert.equal(recycleInstruction.args.objects.key, "revealedRest");
});

test("Dazzling Aurora golden: the chain adapter executes the ordered reveal-until prefix", () => {
  const kernel = world()
    .deck("rest", { types: ["spell"] })
    .deck("unit", { types: ["unit"] })
    .deck("spell", { types: ["spell"] })
    .build();
  const outcome = resolveChainBody([ability.body[0]], kernel);
  const result = outcome.results[0].result;
  assert.equal(result.status, "executed");
  assert.deepEqual(result.linkedValues.revealed.map(ref => ref.id), ["spell", "unit"]);
  assert.deepEqual(result.linkedValues.revealedMatch, kernel.ref("unit"));
  assert.deepEqual(result.linkedValues.revealedRest.map(ref => ref.id), ["spell"]);
});

test("Dazzling Aurora current gap 1b: effect.reveal cannot stand in — a Main Deck subset is rejected", () => {
  // 425.3 "reveal until you reveal a unit" needs an ordered, stop-driven reveal.
  // The merged primitive refuses a Main Deck subset outright, so a fixed count
  // cannot approximate the clause: query order is not deck order.
  const kernel = world().deck(["top-card", "unit-card", "bottom-card"]).build();
  assert.throws(
    () => runInstruction(reveal, { zone: c("deck"), count: c(2) }, { world: kernel }),
    /a subset of this zone requires upstream ordered picks/
  );
  // Control: reading the whole zone is allowed, and the result is a set whose
  // order is only stable-sorted by id — it is not the deck's top-to-bottom order.
  const whole = runInstruction(reveal, { zone: c("deck") }, { world: world().deck(["top-card", "unit-card", "bottom-card"]).build() });
  assert.equal(whole.result.status, "executed");
  assert.deepEqual(
    whole.result.linkedValues.revealed.map(ref => ref.id),
    ["bottom-card", "unit-card", "top-card"]
  );
});

test("Dazzling Aurora golden: the turn-end trigger registers through the production binder", () => {
  const translated = translateTriggerFilter(ability.trigger.filter, "probe", "turn-end");
  assert.deepEqual(translated, { event: "turn-end", player: "self" });
  assert.doesNotThrow(() => assertTriggerSpec({ at: "turn-end", filter: translated }));

  const state = fixture({ cards: [{ id: "aurora", cardId: CANONICAL, types: ["gear"] }] });
  const errors = [];
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, error => errors.push(String(error && error.message)));
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("aurora"), to: "board", location: { type: "base", player: "A" } });
  assert.deepEqual(errors, []);
  let registered = 0;
  for (const key of ["triggers", "registrations"]) if (state.engine.pipeline[key] instanceof Map) registered += state.engine.pipeline[key].size;
  assert.equal(registered, 1);
});

test("Dazzling Aurora golden: play consumes a finalized zero cost and reveal-until links the revealed unit", () => {
  // "Play it, ignoring its cost" (420.3 / 356.1.b.1) must receive a finalized
  // plan built from the revealed object's printed cost. An unfinalized
  // placeholder must never become a free Play.
  const kernel = world()
    .object("revealed-unit", { owner: "A", controller: "A", zone: "hand", types: ["unit"], location: null })
    .build();
  const ref = kernel.ref("revealed-unit");
  assert.throws(
    () => runInstruction(
      play,
      { object: c(ref), cost: c({ finalized: false }) },
      { world: kernel }
    ),
    error => error.name === "CostPlanError" && /Unrecognized unfinalized play cost descriptor/.test(String(error.message))
  );

  // The primitive performs the Play once the card-specific zero-cost plan is
  // finalized; deriving that plan from the reveal result remains the gap.
  const plan = { finalized: true, energy: 0, power: [], xp: 0 };
  const accepted = runInstruction(
    play,
    { object: c(ref), cost: c(plan) },
    { world: world().object("revealed-unit", { owner: "A", controller: "A", zone: "hand", types: ["unit"], location: null }).build() }
  );
  assert.equal(accepted.result.status, "executed");

  const revealed = world()
    .deck("rest", { types: ["spell"] })
    .deck("unit", { types: ["unit"] })
    .deck("spell", { types: ["spell"] })
    .build();
  const revealOutcome = resolveChainBody([ability.body[0]], revealed);
  const revealResult = revealOutcome.results[0].result;
  assert.equal(revealResult.status, "executed");
  assert.deepEqual(revealResult.linkedValues.revealedUnit, revealed.ref("unit"));
  assert.deepEqual(revealResult.linkedValues.revealedRest.map(entry => entry.id), ["spell"]);

});

test.todo(
  "Dazzling Aurora: execute the complete turn-end trigger, including the ordered reveal-until, from the real " +
    "production lifecycle rather than the chain adapter's single-instruction golden"
);
test.todo(
  "Dazzling Aurora: derive a zeroed finalized cost plan from the revealed unit before effect.play " +
    "(CR 420.3, 356.1.b.1)"
);
test.todo(
  "Dazzling Aurora: recycle the non-unit cards revealed before the unit from the reveal-until result set " +
    "(CR 417.1)"
);
