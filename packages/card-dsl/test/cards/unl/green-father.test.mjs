import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/green-father.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-cbd7d8a764f8a0a4bf62c8365cd14d5dd5deb06823365bffea237f2d3dd757a6";
const SOURCE_TEXT =
  "When you conquer or hold, you may exhaust me to replace that battlefield with a Brush battlefield token. " +
  "(Bird, Cat, Dog, Poro, and Ivern units have +1 :rb_might: in Brush. It can be swapped back when scored.)";

const [conquer, hold] = program.abilities;
const [conquerMay] = conquer.body;
const [conquerExhaust, conquerReplace] = conquerMay.args.body.value;
const [holdMay] = hold.body;
const [holdExhaust, holdReplace] = holdMay.args.body.value;

// effect.exhaust accepts evaluated args, so the optional wrapper around it runs
// through the interpreter with the program's own data; effect.replace is not a
// registered opcode (see judgeReason) and stays structural.
const exhaustOnly = (may, instruction) => [{
  ...may,
  args: {
    ...may.args,
    body: { kind: "constant", value: [instruction] }
  }
}];

test("unl-195-219 Green Father: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-195-219 Green Father: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the live gaps: the Replace action / Brush token, the
  // battlefield payload selector, the trigger base-cost binding and the Legend
  // Zone ownership. Merged vocabulary spellings are recorded as executable.
  assert.match(program.judgeReason, /effect\.replace/);
  assert.match(program.judgeReason, /439\.1/);
  assert.match(program.judgeReason, /439\.7/);
  assert.match(program.judgeReason, /187\.8/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /359\.3\.f\.1/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.match(program.judgeReason, /legendZone|legend-zone/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-195-219 Green Father: 'conquer or hold' is two named triggers, not one custom timing point", () => {
  assert.equal(program.abilities.length, 2);
  // 383.4.c.2.b: a Conquer Effect that references the player conquering.
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  // 383.4.c.2.b: the event spelling uses the closed vocabulary `conquered`
  // (pipeline-match.ts maps it to the runtime `conquer` timing point).
  assert.deepEqual(conquer.trigger.filter, { event: "conquered", player: "self" });
  assert.equal(conquer.optional, true);
  // 383.4.d.2.b: a Hold Effect that references the player holding.
  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  assert.deepEqual(hold.trigger.filter, { event: "held", player: "self" });
  assert.equal(hold.optional, true);
});

test("unl-195-219 Green Father: both printed 'you may …' clauses use the §3.9 body wrapper", () => {
  for (const [may, ids] of [
    [conquerMay, ["green-father.conquer-exhaust-self", "green-father.conquer-replace"]],
    [holdMay, ["green-father.hold-exhaust-self", "green-father.hold-replace"]]
  ]) {
    assert.equal(may.op, "choice.optional");
    assert.equal(may.linkedTo, undefined);
    assert.equal(may.args.body.kind, "constant");
    assert.deepEqual(may.args.body.value.map(instruction => instruction.id), ids);
  }
});

test("unl-195-219 Green Father: 'exhaust me' is a non-target source selection and the Replace is linked to it", () => {
  for (const [exhaustSelf, replace, suffix] of [
    [conquerExhaust, conquerReplace, "green-father.conquer"],
    [holdExhaust, holdReplace, "green-father.hold"]
  ]) {
    // 383.3.b / 355.10.c.1: the cost inside the instruction does not target
    // anything; the source is named through a non-target choose filter.
    assert.equal(exhaustSelf.op, "effect.exhaust");
    assert.deepEqual(exhaustSelf.args, {
      choose: {
        kind: "constant",
        value: { id: suffix + "-exhaust-self", filter: { object: "self" } }
      }
    });
    assert.equal(exhaustSelf.targets, undefined);
    assert.equal(exhaustSelf.picks, undefined);

    // 439.3: "Replace [X] with [Y]" is a Replace action; the opcode is not
    // registered (see judgeReason), so the shape is recorded, not executed.
    assert.equal(replace.op, "effect.replace");
    assert.equal(replace.linkedTo, suffix + "-exhaust-self");
    assert.deepEqual(replace.args.battlefield, {
      kind: "constant",
      value: { type: "battlefield", id: "that-battlefield" }
    });
    // 439.3.b.1: [Y] always names the token to create; 187.8's brush definition
    // is not in the frozen token table.
    assert.deepEqual(replace.args.withToken, { kind: "constant", value: "brush" });
    assert.equal(replace.targets, undefined);
  }
});

test("unl-195-219 Green Father golden: the accepted conquer half exhausts the legend", () => {
  const kernel = world()
    .unit("green-father", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .build();
  const ctx = kernel.clone({
    sourceSnapshot: kernel.object(kernel.ref("green-father"))
  });
  ctx.setAnswers({ "green-father.conquer-may/optional": true });
  const outcome = runAbilityBody(exhaustOnly(conquerMay, conquerExhaust), ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["green-father.conquer-exhaust-self", "executed"],
      ["green-father.conquer-may", "executed"]
    ]
  );
  assert.equal(ctx.object(ctx.ref("green-father")).exhausted, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["exhaust"]);
  assert.equal(
    outcome.linkedValues[
      "green-father.conquer-may/green-father.conquer-exhaust-self.exhausted.count"
    ],
    1
  );
});

test("unl-195-219 Green Father golden: declining a may leaves the legend ready", () => {
  const kernel = world()
    .unit("green-father", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .build();
  const ctx = kernel.clone({
    sourceSnapshot: kernel.object(kernel.ref("green-father"))
  });
  ctx.setAnswers({ "green-father.hold-may/optional": false });
  const outcome = runAbilityBody(exhaustOnly(holdMay, holdExhaust), ctx);
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["green-father.hold-may", "negated", "skipped"]]
  );
  assert.equal(ctx.object(ctx.ref("green-father")).exhausted, false);
  assert.deepEqual(outcome.events, []);
});

test("unl-195-219 Green Father golden: an already-exhausted legend cannot be exhausted again (CR 415.1.b/c)", () => {
  const bound = world()
    .unit("green-father", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: true
    })
    .build();
  const ctx = bound.clone({
    sourceSnapshot: bound.object(bound.ref("green-father"))
  });
  const run = runInstruction(
    exhaust,
    { choose: { id: "green-father.conquer-exhaust-self", filter: { object: "self" } } },
    { world: ctx }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.exhausted.count, 0);
  assert.equal(run.linked.exhausted.alreadyExhausted, 1);
  assert.deepEqual(run.events, []);
});

test("unl-195-219 Green Father: both closed-vocabulary triggers register and the production Score wave hits them", () => {
  // events/trigger-spec.ts accepts conquered/held; pipeline-match.ts maps them to
  // the runtime conquer/hold timing points emitted by turn/flow.ts's Score wave.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const f = fixture({
    cards: [{ id: "green-father", cardId: CANONICAL_ID, types: ["legend"], might: null }],
    // CR 383.3.a: the printed "you may" is the trigger's own optional decision.
    choose: request => request.type === "optional" ? true : undefined
  });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("green-father"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = f.kernel.getObject("green-father");
  const registrations = triggerRegistrations(binding.registry, source);
  assert.deepEqual(registrations.map(entry => [entry.spec.at, entry.spec.filter]), [
    ["conquer", { event: "conquered", player: "self" }],
    ["hold", { event: "held", player: "self" }]
  ]);
  const ids = registerProgramTriggers(binding.registry, f.engine, source);
  assert.deepEqual(ids, ["program:green-father:2:0", "program:green-father:2:1"]);

  // The opponent's conquer is not this controller's trigger.
  f.engine.emit({ timingPoint: "conquer", player: "B", details: { battlefieldId: "battlefield-1" } });
  assert.equal(f.engine.items.length, 0);
  // The controller's hold emission enqueues the hold half's body.
  f.engine.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.deepEqual(f.engine.items.map(item => item.body[0].id), ["green-father.hold-exhaust-self"]);

  // The fresh engine's controller conquer enqueues the conquer half instead.
  const g = fixture({
    cards: [{ id: "green-father", cardId: CANONICAL_ID, types: ["legend"], might: null }],
    choose: request => request.type === "optional" ? true : undefined
  });
  g.engine.commit({ type: "move-zone", object: g.kernel.ref("green-father"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  registerProgramTriggers(binding.registry, g.engine, g.kernel.getObject("green-father"));
  g.engine.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.deepEqual(g.engine.items.map(item => item.body[0].id), ["green-father.conquer-exhaust-self"]);
});

test("unl-195-219 Green Father: effect.replace is registered", async () => {
  // CR 439.1/439.3: the instruction is registered. The missing battlefield
  // payload remains a separate production boundary.
  const kernel = world()
    .unit("green-father", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("green-father") });
  ctx.setAnswers({ "green-father.conquer-may/optional": true });
  assert.equal(typeof runAbilityBody, "function");
  const { instructionDefinitionsById } = await import("../../../../engine-core/dist/effects/instructions/registry.generated.js");
  assert.equal(instructionDefinitionsById.has("effect.replace"), true);
});
test.todo(
  "unl-195-219 Green Father: add the CR 187.8 Brush battlefield token definition (its own +1 [M] ability and the " +
    "CR 439.7 Swap Back) to the frozen effect.token table"
);
test.todo(
  "unl-195-219 Green Father: bind 'that battlefield' from the conquer / hold payload — the sealed timing points " +
    "declare no payloadFields and the IR has no event-object battlefield selector"
);
test.todo(
  "unl-195-219 Green Father: pay the leading 'exhaust me' as the trigger's base cost at Finalize " +
    "(CR 383.3.b / 204.3 / 415.4-415.5) — bind the trigger base cost through the Finalize cost field"
);
test.todo(
  "unl-195-219 Green Father: represent the Legend itself as an exhaust-cost object — the frozen ZoneId has no " +
    "legend-zone and cost/payment.ts only accepts board / rune-zone payers (CR 107.4.a/107.4.c)"
);
