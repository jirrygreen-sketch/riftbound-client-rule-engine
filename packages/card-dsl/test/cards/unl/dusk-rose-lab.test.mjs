import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/dusk-rose-lab.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// effect.kill/effect.draw declare Expr-typed arguments, so the ability body
// runs through the production chain adapter, which preserves the Expr nodes
// for each primitive's own schema validation (engine-core/src/chain/
// interpreter-adapter.ts).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// The program binding is the production registration path for this card's
// beginning-start trigger; the golden below records where it still stops.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL = "card.hash-979c0c88664ea7abe8ba5d613868eeb8569d56983d9d9b734d3ef2d55ca0e6c6";
const SOURCE_TEXT =
  "At the start of your Beginning Phase, you may kill a unit you control here to draw 1. " +
  "(This happens before scoring.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [killInstruction, drawInstruction] = optional.args.body.value;
const [pickSpec] = killInstruction.picks;

function worldFor({ hostDeck = ["top-card", "bottom-card"] } = {}) {
  const kernel = world()
    .unit("lab", { types: ["battlefield"], location: { type: "battlefield", id: "bf-1" } })
    .unit("lab-unit", { location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .unit("other-unit", { location: { type: "base", player: "A" }, might: 2 })
    .deck(hostDeck)
    .build();
  kernel.setPicks("dusk-rose-lab.unit-here", [kernel.ref("lab-unit")]);
  return kernel;
}

test("unl-209-219 Dusk Rose Lab: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-209-219 Dusk Rose Lab: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.3\.b/);
  // The cost-within-instruction gap is the cost.sacrifice/finalize path; the
  // trigger-registration gap is the closed EventPattern vocabulary plus the
  // 190.6.d battlefield-controller binding, not a missing adapter.
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /190\.6/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-90|RIFT-91|RIFT-120|RIFT-257/);
});

test("unl-209-219 Dusk Rose Lab: Beginning Phase start trigger with an optional kill-to-draw", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 315.2.a.1: the Beginning Step, before the 315.2.b Scoring Step the printed
  // parenthetical contrasts with.
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.condition, undefined);
  // 383.3.b: "you may" as the first part of the effect is the finalize
  // decision.
  assert.equal(ability.optional, true);

  assert.equal(ability.body.length, 1);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.body.value.map(entry => entry.id), [
    "dusk-rose-lab.sacrifice",
    "dusk-rose-lab.draw"
  ]);
});

test("unl-209-219 Dusk Rose Lab: the kill is a non-target pick of a unit you control here", () => {
  assert.equal(killInstruction.op, "effect.kill");
  // 355.10.c.1/355.7: "kill a unit … to draw 1" is a cost inside the
  // instruction, so no TargetSpec is involved.
  assert.equal(killInstruction.targets, undefined);
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "dusk-rose-lab.unit-here" }
  });
  assert.equal(killInstruction.picks.length, 1);
  assert.equal(pickSpec.id, "dusk-rose-lab.unit-here");
  assert.deepEqual(pickSpec.options, ["unit-you-control-here"]);
  // 190.6.d: "you control" is the ability's controller; 053.3: "here" is this
  // Battlefield.
  assert.deepEqual(pickSpec.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: "self"
  });
  assert.equal(pickSpec.min, 1);
  assert.equal(pickSpec.max, 1);
  assert.equal(pickSpec.selection, "one");
});

test("unl-209-219 Dusk Rose Lab: the draw is linked to the kill action (359.3.e.14.b)", () => {
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, "dusk-rose-lab.sacrifice");
  assert.equal(drawInstruction.condition.kind, "compare");
  assert.equal(drawInstruction.condition.left.kind, "linked-value");
  assert.equal(drawInstruction.condition.left.instructionId, "dusk-rose-lab.sacrifice");
  assert.equal(drawInstruction.condition.left.key, "killed");
  assert.equal(drawInstruction.condition.operator, "ne");
  assert.deepEqual(drawInstruction.condition.right, { kind: "constant", value: [] });
});

test("unl-209-219 Dusk Rose Lab: accepting kills the locked unit and draws 1", () => {
  const kernel = worldFor();
  kernel.setAnswers({ "dusk-rose-lab.opt-in/optional": true });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lab") });

  const outcome = resolveChainBody(ability.body, scoped);
  assert.equal(outcome.status, "executed");
  const killResult = outcome.results.find(entry => entry.id === "dusk-rose-lab.sacrifice");
  assert.equal(killResult.result.status, "executed");
  assert.equal(scoped.getObject("lab-unit").zone, "trash");
  assert.equal(scoped.getObject("other-unit").zone, "board");
  assert.equal(scoped.player("A").handSize, 1);
  assert.deepEqual(scoped.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "draw"]);
});

test("unl-209-219 Dusk Rose Lab: declining kills nothing and draws nothing", () => {
  const kernel = worldFor();
  kernel.setAnswers({ "dusk-rose-lab.opt-in/optional": false });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lab") });

  const outcome = resolveChainBody(ability.body, scoped);
  const declined = outcome.results.find(entry => entry.id === "dusk-rose-lab.opt-in");
  assert.equal(declined.result.status, "negated");
  assert.equal(declined.result.reason, "skipped");
  assert.equal(scoped.getObject("lab-unit").zone, "board");
  assert.equal(scoped.player("A").handSize, 0);
  assert.deepEqual(scoped.events, []);
});

test("unl-209-219 Dusk Rose Lab: a replaced kill pays nothing and the linked draw does not happen", () => {
  const kernel = worldFor();
  kernel.setAnswers({ "dusk-rose-lab.opt-in/optional": true });
  // Contract 3.4 / 359.3.e.14.b: a replacement that prevents the kill turns
  // the instruction into negated and leaves the receipt empty; the draw must
  // not happen for a cost that was never paid.
  kernel.addReplacement(action => (action.type === "kill" ? "replaced" : null));
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lab") });

  const outcome = resolveChainBody(ability.body, scoped);
  const killResult = outcome.results.find(entry => entry.id === "dusk-rose-lab.sacrifice");
  assert.equal(killResult.result.status, "negated");
  assert.equal(killResult.result.reason, "replaced");
  assert.equal(scoped.getObject("lab-unit").zone, "board");
  assert.equal(scoped.player("A").handSize, 0);
  // The linked draw reads the kill's own receipt (359.3.e.14.b). The merged
  // interpreter reports the missing receipt through its ignored path; what the
  // rules require is asserted directly: nothing is drawn and no new event is
  // created for a cost that was never paid.
  const drawResult = outcome.results.find(entry => entry.id === "dusk-rose-lab.draw");
  assert.notEqual(drawResult.result.status, "executed");
  assert.equal(scoped.player("A").handSize, 0);
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["top-card", "bottom-card"]);
  // The only event is the attempted (replaced) kill: no draw action happened.
  assert.deepEqual(scoped.events.map(event => event.action), ["kill"]);
  assert.equal(scoped.events[0].outcome, "replaced");
});

test.todo(
  "unl-209-219 Dusk Rose Lab: charge the kill as the triggered ability's base cost at Finalize " +
    "(CR 383.3.b/383.3.b.1, RIFT-261 cost-within-instruction / cost.sacrifice), so the draw really " +
    "depends on a cost paid before resolution"
);

test("unl-209-219 Dusk Rose Lab: beginning-start is a closed timing point that the turn flow really emits", () => {
  // beginning-start is a first-class timing point emitted from turn/flow.ts,
  // and the CardProgram -> TriggerRegistration adapter is present. The golden
  // asserts the declared trigger against the closed timing-point set rather
  // than restating the body.
  const executable = {
    canonicalCardId: program.canonicalCardId,
    rulesetVersion: program.rulesetVersion,
    status: "executable",
    abilities: program.abilities,
    sourceText: program.sourceText
  };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const board = fixture({});
  const source = {
    ref: { id: "lab", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Dusk Rose Lab",
    types: ["battlefield"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: true
  };
  assert.equal(binding.registry.has(source.cardId), true);
  const [ability] = program.abilities;
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  const timingPoint = getTimingPoint("beginning-start");
  assert.equal(timingPoint.id, "beginning-start");
  // The timing point is turn-owned and cites the Beginning Step rule the card's
  // parenthetical contrasts with (315.2.a.1 vs the 315.2.b Scoring Step).
  assert.equal(timingPoint.emittedBy, "turn");
  assert.deepEqual([...timingPoint.ruleRefs], ["315.2.a.1"]);
  assert.deepEqual([...getTimingPoint("score").ruleRefs], ["470.1", "470.3", "471", "473.2"]);
  assert.equal(board.engine.pipeline.turnPlayer, "A");
});
