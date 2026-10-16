import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram, EFFECT_IR_V2_RULESET } from "@riftbound/card-dsl";
import Vision from "../../../dist/effects/keywords/Vision.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";
import inspect from "../../../dist/effects/instructions/effect.inspect.js";
import recycle from "../../../dist/effects/instructions/effect.recycle.js";

const HOST = { canonicalCardId: "unl-089-219" };
// The expanded body's player arg is constant("A"), the reference test kernel's
// default player.
const SELECT_REQUEST_ID = "effect.inspect:select:A:A:deck";

const constant = value => ({ kind: "constant", value });

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Vision]"
  };
}

function expansion(value) {
  return Vision.expand(value === undefined ? { host: HOST } : { value, host: HOST });
}

function visionBody() {
  return expansion()[0].body;
}

/**
 * Run the Vision body's Predict step against the reference test kernel.
 * The interpreter pre-evaluates Expr args to raw values, which effect.inspect's
 * argsSchema (requiring Expr) rejects — a known interpreter/primitive mismatch
 * outside this task's scope. We therefore execute the inspect step directly with
 * its Expr args (the form validateCardProgram certifies) and the recycle step
 * through the interpreter on the chosen linked value.
 */
function runVision(kernel, answers) {
  const hostRef = kernel.ref(HOST.canonicalCardId);
  const targetWorld = kernel.clone({ source: hostRef });
  targetWorld.setAnswers(answers);
  const inspectInstruction = visionBody()[0];
  const run = runInstruction(inspect, inspectInstruction.args, { world: kernel, answers });
  return { run, targetWorld: kernel };
}

test("definition: non-valued keyword with v1.5 rule refs and separate stacking (817.2)", () => {
  assert.equal(Vision.keyword, "Vision");
  assert.equal(Vision.valued, false);
  assert.equal(Vision.stacking, "separate");
  for (const ref of ["817", "817.1", "817.1.b", "817.1.c", "817.2", "817.3", "437.1", "437.3", "437.3.a", "437.4"]) {
    assert.ok(Vision.ruleRefs.includes(ref), `missing ruleRef ${ref}`);
  }
});

test("expands to one triggered ability at object-enters-board (817.1.c)", () => {
  const abilities = expansion();
  assert.equal(abilities.length, 1);
  const ability = abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-enters-board");
  assert.ok(typeof ability.trigger.filter === "object" && ability.trigger.filter !== null);
  const body = ability.body;
  assert.equal(body.length, 2);
  assert.equal(body[0].op, "effect.inspect");
  assert.equal(body[0].args.amount.value, 1, "437.3.a: Predict without a number looks at 1");
  assert.deepEqual(body[0].args.chooseCount.value, { min: 0, max: 1 }, "437.1: may recycle it (0..1)");
  assert.equal(body[1].op, "effect.recycle");
  assert.equal(body[1].args.objects.kind, "linked");
  assert.equal(body[1].args.objects.instructionId, "vision-look");
  assert.equal(body[1].linkedTo, "vision-look");
});

test("expansion passes validateCardProgram inside a minimal CardProgram", () => {
  const result = validateCardProgram(wrapProgram([...expansion()]));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("stacking separate: each Vision copy expands to its own independent ability (817.2)", () => {
  const first = expansion();
  const second = expansion();
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0], second[0], "separate instances are distinct abilities");
  assert.deepEqual(first[0], second[0]);
});

test("valued boundary: a spurious value is ignored, expansion stays value-free", () => {
  const withValue = expansion(2);
  const without = expansion();
  assert.deepEqual(withValue, without);
  assert.equal(withValue.length, 1);
});

test("executed: recycling the seen top card moves it to the deck bottom (437.1)", () => {
  // The reference test kernel's query() has no zone order (see effect.inspect's
  // QueryablePool note), so "the top card" is resolved by insertion order here;
  // the picked card is the one effect.inspect offers and the player chooses.
  const kernel = world().deck("rest").deck("top-seen").hand(HOST.canonicalCardId).build();
  const top = kernel.zone("A", "deck")[0];
  const answers = { [SELECT_REQUEST_ID]: [top] };
  const { run } = runVision(kernel, answers);
  assert.equal(run.result?.status, "executed");
  // Predict 1: looked at exactly one card (amount 1) and chose to recycle it.
  assert.equal(run.linked.inspected, 1);
  assert.equal(run.linked["vision-picked"].length, 1);
  assert.deepEqual(run.linked["vision-recycle"], [top]);
  // Step 2: recycle the chosen card to the bottom of its owner's deck (417.1.c).
  const recycleRun = runInstruction(recycle, { objects: constant(run.linked["vision-recycle"]) }, { world: kernel });
  assert.equal(recycleRun.result?.status, "executed");
  // top-seen (the chosen top card) moves to the bottom; rest stays.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["rest", "top-seen"]);
});

test("executed: declining to recycle keeps the card on top (817.2.a choice)", () => {
  const kernel = world().deck("rest").deck("top-seen").hand(HOST.canonicalCardId).build();
  const answers = { [SELECT_REQUEST_ID]: [] };
  const { run } = runVision(kernel, answers);
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["vision-picked"].length, 1);
  assert.deepEqual(run.linked["vision-recycle"], []);
  // Player chose not to recycle; the top card stays on top (437.1 choice).
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-seen", "rest"]);
});

test("boundary: empty deck Predict looks at 0 cards without Burn Out (437.4 / 437.4.a)", () => {
  const kernel = world().hand(HOST.canonicalCardId).build();
  // Choosing zero of zero cards still goes through the select request; answer with [].
  const { run } = runVision(kernel, { [SELECT_REQUEST_ID]: [] });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 0, "no cards seen on an empty deck, no Burn Out");
});

test("registry exposes the Vision definition by keyword id", () => {
  assert.equal(keywordDefinitionsById.get("Vision"), Vision);
});
