import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/green-father.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /Replace/);
  assert.match(program.judgeReason, /439\./);
  assert.match(program.judgeReason, /187\.8/);
  assert.match(program.judgeReason, /107\.4/);
});

test("unl-195-219 Green Father: 'conquer or hold' is two named triggers, not one custom timing point", () => {
  assert.equal(program.abilities.length, 2);
  // 383.4.c.2.b: a Conquer Effect that references the player conquering.
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquer", player: "self" });
  assert.equal(conquer.optional, true);
  // 383.4.d.2.b: a Hold Effect that references the player holding.
  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  assert.deepEqual(hold.trigger.filter, { event: "hold", player: "self" });
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

test.todo(
  "unl-195-219 Green Father: execute the CR 439.3 Replace action — the closed GameAction set has no replace " +
    "and no effect.replace instruction file is merged (contract change request)"
);
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
    "(CR 383.3.b / 204.3 / 415.4-415.5) — TriggeredAbility has no cost slot (RIFT-89)"
);
test.todo(
  "unl-195-219 Green Father: represent the Legend itself as an exhaust-cost object — the frozen ZoneId has no " +
    "legend-zone and cost/payment.ts only accepts board / rune-zone payers (CR 107.4.a/107.4.c)"
);
