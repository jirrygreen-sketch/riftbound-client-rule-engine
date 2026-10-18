import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gloomist.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-d4c1740a3cac0cbe0b049d4705dd1cf67e9d7b241433c1fcfd3afc3288bd7084";
const SOURCE_TEXT = "When you or an ally hold, you may exhaust me to draw 1.";

const [ability] = program.abilities;
const [may] = ability.body;
const [exhaustSelf, drawOne] = may.args.body.value;

// The two merged calling conventions (interpreter evaluates args; the chain
// adapter preserves raw Exprs) do not overlap for every primitive, exactly as
// the merged goldens record (ogn/monastery-of-hirana, ogn/grove-of-the-god-willow).
// effect.exhaust accepts evaluated args, so the optional wrapper is executed
// with the exhaust half; effect.draw still requires a raw Expr and is executed
// through runInstruction with the program's own arguments.
const exhaustOnly = [{
  ...may,
  args: {
    ...may.args,
    body: { kind: "constant", value: [exhaustSelf] }
  }
}];

test("unl-193-219 Gloomist: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-193-219 Gloomist: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /ally/);
  assert.match(program.judgeReason, /491\.8/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /107\.4/);
  // Third-sweep refresh: the reason now names the registration failure and the
  // object-less hold payload instead of only the missing cost adapter.
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /没有 object/);
});

test("unl-193-219 Gloomist: hold trigger with the leading may as choice.optional (contract 3.9)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d.2.b: a Hold Effect that references the player holding.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", player: "self" });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a / 403.1: the leading "you may" is the trigger's own Finalize decision.
  assert.equal(ability.optional, true);

  // Contract 3.9: the chosen instructions live inside the choice body.
  assert.equal(may.op, "choice.optional");
  assert.equal(may.linkedTo, undefined);
  assert.deepEqual(may.args.body.value.map(instruction => instruction.id), [
    "gloomist.exhaust-self",
    "gloomist.draw"
  ]);
  assert.deepEqual(may.args.prompt, {
    kind: "constant",
    value: "Exhaust me to draw 1?"
  });
});

test("unl-193-219 Gloomist: 'exhaust me' is a non-target source selection and 'draw 1' is linked to it", () => {
  // 383.3.b / 355.10.c.1: the cost inside the instruction does not target anything;
  // the source is named through a non-target choose filter.
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "gloomist.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);

  // "to draw 1": the draw follows the exhaust (359.3.e.14 linking).
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.linkedTo, "gloomist.exhaust-self");
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
});

test("unl-193-219 Gloomist golden: accepting the may exhausts the legend", () => {
  const kernel = world()
    .unit("gloomist", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .deck(["top-card", "bottom-card"])
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("gloomist")) });
  ctx.setAnswers({ "gloomist.may/optional": true });
  const outcome = runAbilityBody(exhaustOnly, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["gloomist.exhaust-self", "executed"],
    ["gloomist.may", "executed"]
  ]);
  assert.equal(ctx.object(ctx.ref("gloomist")).exhausted, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["exhaust"]);
  // Links written inside a choice body are path-qualified by the interpreter.
  assert.equal(
    outcome.linkedValues["gloomist.may/gloomist.exhaust-self.exhausted.count"],
    1
  );
});

test("unl-193-219 Gloomist golden: declining the may leaves the legend ready and draws nothing", () => {
  const kernel = world()
    .unit("gloomist", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .deck("untouched")
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("gloomist")) });
  ctx.setAnswers({ "gloomist.may/optional": false });
  const outcome = runAbilityBody(ability.body, ctx);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["gloomist.may", "negated", "skipped"]
  ]);
  assert.equal(ctx.object(ctx.ref("gloomist")).exhausted, false);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), []);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["untouched"]);
  assert.deepEqual(outcome.events, []);
});

test("unl-193-219 Gloomist golden: an already-exhausted legend cannot be exhausted again (CR 415.1.b/c)", () => {
  const bound = world()
    .unit("gloomist", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: true
    })
    .build();
  const ctx = bound.clone({ sourceSnapshot: bound.object(bound.ref("gloomist")) });
  const run = runInstruction(
    exhaust,
    { choose: { id: "gloomist.exhaust-self", filter: { object: "self" } } },
    { world: ctx }
  );
  // 415.1.c: exhausting an already exhausted object performs no additional action;
  // the printed instruction still resolves with nothing newly exhausted.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.exhausted.count, 0);
  assert.equal(run.linked.exhausted.alreadyExhausted, 1);
  assert.deepEqual(run.events, []);
});

test("unl-193-219 Gloomist golden: draw 1 takes the printed amount on the merged primitive", () => {
  const kernel = world().deck(["alpha", "beta"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["alpha"]);
});

test.todo(
  "unl-193-219 Gloomist: 2v2 teammate/ally hold condition (CR 491.8 / 491.8.e) — the merged TriggerSpec " +
    "PlayerSelector only offers self/opponent/any/{playerId} and no engine concept of a teammate exists"
);
test.todo(
  "unl-193-219 Gloomist: pay the leading 'exhaust me' as the trigger's base cost at Finalize " +
    "(CR 383.3.b / 204.3 / 415.4-415.5) — bind the trigger base cost through the Finalize cost field"
);
test.todo(
  "unl-193-219 Gloomist: represent the Legend itself as an exhaust-cost object — the frozen ZoneId has no " +
    "legend-zone and cost/payment.ts only accepts board / rune-zone payers (CR 107.4.a/107.4.c)"
);

test("unl-193-219 Gloomist boundary: the authored hold filter cannot be registered (CR 383.4.d.2.b/823.2)", () => {
  // Third-sweep evidence: the filter spells the event "hold", but the closed
  // EventPattern vocabulary only accepts "held"/"conquered"/"scored", so the
  // production registration path throws before any subscription exists.
  assert.deepEqual(ability.trigger.filter, { event: "hold", player: "self" });
  const board = fixture({
    cards: [{ id: "gloomist", cardId: program.canonicalCardId, types: ["legend"], energy: null, power: null, controller: "A" }]
  });
  board.engine.commit({ type: "move-zone", object: board.kernel.ref("gloomist"), to: "board" });
  const source = board.kernel.getObject("gloomist");
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => registerProgramTriggers(registry, board.engine, source),
    error => error.name === "TriggerSpecValidationError" && error.issues.some(issue => issue.code === "invalid-event-type")
  );
  assert.equal(board.engine.pipeline.triggers.size, 0);
});

test("unl-193-219 Gloomist boundary: a correctly-spelled hold subscription still cannot identify the holding unit (CR 383.4.d.2.b)", () => {
  // Third-sweep evidence for the second half of the gap: the real hold emission
  // carries no object/source, so a "held" subscription can only gate on the
  // registered source's controller. That covers the printed "you" but not "or an
  // ally" (491.8.e), and it cannot identify which unit held.
  const board = fixture({ cards: [] });
  board.engine.pipeline.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "bf-1" } });
  const event = board.engine.pipeline.log.find(entry => entry.timingPoint === "hold");
  assert.equal(event.object, undefined);
  assert.equal(event.source, undefined);
  assert.deepEqual(event.details, { battlefieldId: "bf-1" });
  assert.deepEqual(translateTriggerFilter({ event: "held", player: "self" }, "gloomist", "hold"),
    { event: "held", player: "self" });

  // The corrected spelling really does gate on the registration's controller:
  // the host's own hold fires, the opponent's does not.
  const trigger = fixture({ cards: [{ id: "gloomist", cardId: program.canonicalCardId, types: ["legend"], energy: null, power: null, controller: "A" }] });
  trigger.engine.commit({ type: "move-zone", object: trigger.kernel.ref("gloomist"), to: "board" });
  const source = trigger.kernel.getObject("gloomist");
  for (const [id, player, expected] of [["own", "A", 1], ["opponent", "B", 0]]) {
    trigger.engine.pipeline.registerTrigger({
      id, source, controller: "A",
      spec: { at: "hold", filter: { event: "held", player: "self" } },
      body: [], optional: false, activeZones: ["board"], boundToIncarnation: true
    });
    const fired = [];
    trigger.engine.pipeline.onTrigger = snapshot => fired.push(snapshot.event.player);
    trigger.engine.pipeline.emit({ timingPoint: "hold", player });
    assert.equal(fired.length, expected, `${id} hold attribution`);
    trigger.engine.pipeline.unregisterTrigger(id);
  }
});
