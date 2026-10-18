import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/bottled-constellation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-497476b6bf664a9e54c9954d3fc830b826e1dac396852919e2a91beb9ae35129";
const SOURCE_TEXT =
  "At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point.";

const [triggered] = program.abilities;
const [optional] = triggered.body;
const [killCost, score] = optional.args.body.value;
const [sacrificeSpec] = killCost.picks;

const OPTIONAL_ID = "bottled-constellation.may-kill-opt/optional";

/** The program as the production registry sees it (status still judge-required). */
const executableView = { ...program, status: "executable", judgeReason: undefined };

/**
 * The reference kernel compares filter values literally, so the symbolic
 * "self" controller selector of 740.1.a is bound to the acting player for the
 * golden (the same convention as ven/protective-sands and ogn/master-yi-meditative).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** Bottled Constellation plus three other friendly permanents and one enemy unit. */
function fixtureWorld() {
  const base = world()
    .unit("bottled-constellation", {
      types: ["gear"],
      energy: 10,
      power: ["Mind"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("friendly-unit-1", { might: 2 })
    .unit("friendly-unit-2", { might: 2 })
    .unit("friendly-gear", { types: ["gear"], energy: 1 })
    .unit("enemy-unit", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  return base.clone({
    source: base.ref("bottled-constellation"),
    sourceSnapshot: base.getObject("bottled-constellation")
  });
}

/** The program body with the test kernel's literal controller binding applied. */
function bodyForKernel() {
  return [substituteController(optional, "A")];
}

test("ven-067-166 Bottled Constellation: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-067-166 Bottled Constellation: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /383\.3\.b\.1/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /main-start/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.match(program.judgeReason, /min 3 \/ max 3/);
  assert.match(program.judgeReason, /finalizeOrderedPickPlans/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-067-166 Bottled Constellation: a main-start trigger scoped to this controller's Main Phase", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  // 316.1 / 316.4: the start of the Main Phase, where start-of-phase effects
  // take place; the timing point is emitted by turn/ for the turn player.
  assert.equal(triggered.trigger.at, "main-start");
  assert.deepEqual(triggered.trigger.filter, { event: "main-start", player: "self" });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  // 383.3.a: the trigger itself goes on the chain; the printed "you may" is
  // decided through the choice.optional wrapper below.
  assert.equal(triggered.optional, false);
});

test("ven-067-166 Bottled Constellation: 'you may' wraps the chosen instructions (contract 3.9)", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(optional.id, "bottled-constellation.may-kill-opt");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.targets, undefined);
  assert.deepEqual(optional.args.body.value.map(instruction => [instruction.id, instruction.op]), [
    ["bottled-constellation.kill-cost", "effect.kill"],
    ["bottled-constellation.score", "effect.score"]
  ]);
});

test("ven-067-166 Bottled Constellation: the kill is a non-target cost within instructions with exactly 3 picks", () => {
  // 355.10.c.1 / 740.4.a: "[do X] to [do Y]" costs do not target.
  assert.equal(killCost.op, "effect.kill");
  assert.equal(killCost.targets, undefined);
  assert.deepEqual(killCost.args.picks, {
    kind: "constant",
    value: "bottled-constellation.sacrificed"
  });
  assert.equal(killCost.linkedTo, undefined);

  assert.equal(sacrificeSpec.id, "bottled-constellation.sacrificed");
  // "3 other friendly units and/or gear": exactly three permanents of either
  // type, controlled by this ability's controller, excluding the source itself.
  assert.deepEqual(sacrificeSpec.filter, {
    type: ["unit", "gear"],
    controller: "self",
    zone: "board",
    other: true
  });
  assert.equal(sacrificeSpec.min, 3);
  assert.equal(sacrificeSpec.max, 3);
  assert.equal(sacrificeSpec.selection, "any");

  // 194.1.c / 470.1-470.3: "to score 1 point" is Gaining Points and is linked
  // to the cost so an unpaid cost cannot award the point (359.3.e.14.a).
  assert.equal(score.op, "effect.score");
  assert.deepEqual(score.args.amount, { kind: "constant", value: 1 });
  assert.equal(score.linkedTo, "bottled-constellation.kill-cost");
  assert.equal(score.targets, undefined);
  assert.equal(score.picks, undefined);
});

test("ven-067-166 Bottled Constellation golden: accepting kills exactly the three chosen permanents and scores 1", () => {
  const kernel = fixtureWorld();
  kernel.setPicks("bottled-constellation.sacrificed", [
    kernel.ref("friendly-unit-1"),
    kernel.ref("friendly-gear"),
    kernel.ref("friendly-unit-2")
  ]);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(bodyForKernel(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["bottled-constellation.kill-cost", "executed"],
    ["bottled-constellation.score", "executed"],
    ["bottled-constellation.may-kill-opt", "executed"]
  ]);

  // 429.1: the three chosen permanents went to their owner's trash.
  assert.equal(kernel.getObject("friendly-unit-1").zone, "trash");
  assert.equal(kernel.getObject("friendly-unit-2").zone, "trash");
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  // The source, the unchosen permanent and the enemy unit are untouched, and
  // 194.1.c awards exactly one point to the controller.
  assert.equal(kernel.getObject("bottled-constellation").zone, "board");
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["kill", "kill", "kill", "score"]);
});

test("ven-067-166 Bottled Constellation golden: declining the choice neither kills nor scores", () => {
  const kernel = fixtureWorld();
  kernel.setPicks("bottled-constellation.sacrificed", [
    kernel.ref("friendly-unit-1"),
    kernel.ref("friendly-gear"),
    kernel.ref("friendly-unit-2")
  ]);
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(bodyForKernel(), kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["bottled-constellation.may-kill-opt", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-unit-1").zone, "board");
  assert.equal(kernel.player("A").score, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-067-166 Bottled Constellation golden: a non-target pick leaves the enemy unit and other permanents alone", () => {
  const kernel = fixtureWorld();
  kernel.setPicks("bottled-constellation.sacrificed", [
    kernel.ref("friendly-unit-1"),
    kernel.ref("friendly-unit-2"),
    kernel.ref("friendly-gear")
  ]);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(bodyForKernel(), kernel);

  // 355.10.c.1: the picked permanents are not Targets, so no "becomes a
  // target" emission accompanies the kills.
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    kernel.events.filter(event => event.action === "kill").length,
    3
  );
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
});

test("ven-067-166 Bottled Constellation boundary: the resolver does not enforce the exactly-3 pick bounds", () => {
  // 383.3.b requires exactly three permanents. The card declares min 3 / max 3 on
  // its PickSpec, but effect.kill resolves whatever refs ctx.picks supplies and
  // never re-checks those bounds: one supplied pick still executes. That is the
  // measured reason the card cannot be executable yet (judgeReason item 3).
  const kernel = world()
    .player("A")
    .unit("source", { types: ["gear"], might: null })
    .unit("friendly-1", { owner: "A", controller: "A" })
    .unit("friendly-2", { owner: "A", controller: "A" })
    .unit("friendly-3", { owner: "A", controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("source") });
  context.setPicks("bottled-constellation.sacrificed", [context.ref("friendly-1")]);

  const outcome = resolveChainBody(bodyForKernel().flatMap(node => node.args.body.value), context);

  // Only the single supplied permanent was killed; the other two survive, so the
  // short payment is silently accepted instead of failing the ability.
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["bottled-constellation.kill-cost", "executed"],
    ["bottled-constellation.score", "executed"]
  ]);
  assert.equal(context.getObject("friendly-1").zone, "trash");
  assert.equal(context.getObject("friendly-2").zone, "board");
  assert.equal(context.getObject("friendly-3").zone, "board");
});

test("ven-067-166 Bottled Constellation evidence: the authored main-start filter is rejected by the trigger vocabulary", () => {
  // 316.1/316.4: "your Main Phase" is the ability controller's turn. The
  // closed EVENT_PATTERN_TYPES list has no main-start discriminant, so the
  // production registration fails; an empty filter is not a substitute because
  // it would also subscribe to the opponent's Main Phase (measured below).
  const registry = new ProgramRegistry([executableView]);
  const { engine, kernel } = fixture({ cards: [{
    id: "bottled", cardId: CANONICAL, types: ["gear"], might: null, energy: 10, power: ["Mind"]
  }] });
  const registrations = triggerRegistrations(registry, kernel.getObject("bottled"));
  assert.deepEqual(registrations.map(registration => [registration.spec.at, registration.spec.filter]),
    [["main-start", { event: "main-start", player: "self" }]]);
  assert.throws(
    () => registerProgramTriggers(registry, engine, kernel.getObject("bottled")),
    (error) => error instanceof Error && /trigger\.filter\.event/.test(error.message)
  );
  // "player: self" cannot be expressed without an event discriminant, so the
  // fallback would also match the opponent's Main Phase.
  assert.equal(matchesTriggerEvent({}, { timingPoint: "main-start", player: "B" }, "A"), true);
});

test("ven-067-166 Bottled Constellation evidence: the trigger carries no leading cost and no pick lock", () => {
  // judgeReason items 2 and 3: the cost-within-instructions of 383.3.b would be
  // paid at Finalize, but the card's triggered shape has no cost field and the
  // program trigger adapter produces no cost / mayAtFinalize. The filter+min/max
  // pick spec is not locked or re-checked either.
  const registry = new ProgramRegistry([executableView]);
  const { kernel } = fixture({ cards: [{
    id: "bottled", cardId: CANONICAL, types: ["gear"], might: null, energy: 10, power: ["Mind"]
  }] });
  const registrations = triggerRegistrations(registry, kernel.getObject("bottled"));
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].cost, undefined);
  assert.equal(registrations[0].mayAtFinalize, undefined);
  assert.equal(Object.hasOwn(triggered, "cost"), false);
  assert.equal(instructionDefinitionsById.has("choice.optional"), false);

  const pickContext = kernel.clone({
    controller: "A",
    sourceSnapshot: kernel.getObject("bottled")
  });
  assert.deepEqual(finalizeOrderedPickPlans(pickContext, triggered.body), []);
});

test.todo(
  "ven-067-166 Bottled Constellation: the leading \"kill 3 ...\" must be paid as the triggered " +
    "ability's base cost at Finalize (383.3.b/383.3.b.1) - TriggeredAbility has no cost field and " +
    "programs/triggers.ts produces no cost / mayAtFinalize for it"
);

test.todo(
  "ven-067-166 Bottled Constellation: enforce the exactly-3 PickSpec bounds at resolution " +
    "(383.3.b) - effect.kill consumes whatever ctx.picks supplies and finalizeOrderedPickPlans " +
    "has no lock path for filter+min/max picks"
);

test.todo(
  "ven-067-166 Bottled Constellation: register the main-start subscription with the turn player " +
    "anchored - EVENT_PATTERN_TYPES has no main-start discriminant and an empty filter would " +
    "subscribe to the opponent's Main Phase too"
);

