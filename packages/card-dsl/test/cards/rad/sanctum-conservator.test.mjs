// Golden test for Sanctum Conservator (rad-030-167).
//
// judge-required (see the program's judgeReason): the merged trigger vocabulary
// cannot test the played card's printed Energy cost, and IR has no selector for
// "the card in the triggering play event". The runnable evidence is the merged
// "ready me" primitive the trigger body uses (including 416.1.c).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/sanctum-conservator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";

const CANONICAL =
  "card.hash-6028fb37be26fd7565a2496f62a0ae6299311f364579011da70ce8cdbb0ddd08";
const SOURCE_TEXT =
  "When you play a card with Energy cost :rb_energy_7: or more, ready me.";

const [triggered] = program.abilities;
const [readyInstruction] = triggered.body;

test("rad-030-167 Sanctum Conservator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-030-167 Sanctum Conservator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the missing filter/payload vocabulary, the rule and the task.
  assert.match(program.judgeReason, /206\/206\.1/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /触发过滤词汇/);
  assert.match(program.judgeReason, /fail-closed/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-030-167 Sanctum Conservator: one card-played trigger filtered to the controller's plays", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  // CR 383.4.a / 383.4.a.4: this watches another card being played, not its own entry.
  assert.equal(triggered.trigger.at, "card-played");
  assert.equal(triggered.trigger.filter.event, "card-played");
  assert.equal(triggered.trigger.filter.filter.player, "self");
  // CR 206: "a card with Energy cost 7 or more" reads the printed Energy cost.
  assert.equal(triggered.trigger.filter.filter.playedCardEnergyCostAtLeast, 7);
  assert.equal(triggered.optional, false);
});

test("rad-030-167 Sanctum Conservator: the body is exactly 'ready me'", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(readyInstruction.id, "sanctum-conservator.ready-self");
  assert.equal(readyInstruction.op, "effect.ready");
  // "ready me": effect.ready defaults to the ability source (416.1), so no
  // objects/amount/linkKey arguments and no target specifications are needed.
  assert.deepEqual(readyInstruction.args, {});
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.picks, undefined);
  assert.equal(readyInstruction.linkedTo, undefined);
});

test("rad-030-167 Sanctum Conservator: 'ready me' really readies the exhausted source (416.1)", () => {
  const kernel = world().unit("conservator", { might: 5, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("conservator") });
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(scoped.getObject("conservator").exhausted, false);
});

test("rad-030-167 Sanctum Conservator: an already-ready source produces no extra event (416.1.c)", () => {
  const kernel = world().unit("conservator", { might: 5, exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("conservator") });
  const eventCount = scoped.events.length;
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  // Nothing additional happens: no ready action is submitted.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.equal(scoped.events.length, eventCount);
  assert.equal(scoped.getObject("conservator").exhausted, false);
});

test("rad-030-167 Sanctum Conservator: the printed cost gate is declared for review", () => {
  // The declaration keeps the intended field name and threshold so the review
  // can audit it; judgeReason names the missing trigger vocabulary and the
  // missing event-object selector that block an honest evaluation (206/206.1).
  assert.equal(triggered.trigger.filter.filter.player, "self");
  assert.equal(triggered.trigger.filter.filter.playedCardEnergyCostAtLeast, 7);
  assert.match(program.judgeReason, /playedCardEnergyCostAtLeast|该阈值谓词/);
});

test.todo(
  "Sanctum Conservator: the printed-Energy-cost threshold on the played card (CR 206/206.1) — blocked because the frozen " +
    "trigger filter vocabulary has no cost predicate and, decisively, IR's ObjectSelector cannot name the card in the triggering " +
    "play event (self/source/target/pick/linked all refer to the ability itself or an explicit choice); the declaration keeps the " +
    "intended field name (playedCardEnergyCostAtLeast) instead of approximating the check on the source"
);

test("rad-030-167 Sanctum Conservator: the trigger translator fail-closes on the unknown printed-cost key", () => {
  // The shipped program stays judge-required. The merged src/programs binding
  // accepts the trigger at the registry level but cannot translate its filter:
  // playedCardEnergyCostAtLeast (CR 206/206.1) is not in the trigger-spec
  // ObjectFilter vocabulary, so registering it throws instead of silently
  // registering a trigger that would fire on every play.
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const kernel = world()
    .card("conservator", { cardId: CANONICAL, types: ["unit"], energy: 2, power: [], zone: "hand" })
    .build();

  // Control evidence: the binding inspects the program without throwing, so
  // the failure below comes from the printed-cost filter key alone.
  binding.inspect({ cardId: CANONICAL, keywords: [] });
  assert.throws(
    () => triggerRegistrations(binding.registry, kernel.getObject("conservator")),
    (error) => error.code === "judge-required"
  );
});
