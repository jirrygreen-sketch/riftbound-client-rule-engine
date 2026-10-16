import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wildclaw-shaman.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: buff } = await import(new URL("effects/instructions/effect.buff.js", engineCore));
const { default: ready } = await import(new URL("effects/instructions/effect.ready.js", engineCore));
const { AwaitChoice, runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const CANONICAL = "card.hash-050d713d056c980eaa282af3d9145bdcc7e5f630b1b27d672aad1c0fcced6a31";
const [playedTrigger] = program.abilities;
const maySpend = playedTrigger.body[0];
const [spendBuff, buffSelf, readySelf] = maySpend.args.body.value;

test("Wildclaw Shaman program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /spend/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.equal(
    program.sourceText,
    "When you play me, you may spend a buff to buff me and ready me. (If I don't have a buff, I get a +1 :rb_might: buff.)"
  );
});

test("structure: optional played trigger wrapping the may-spend cost and its results", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // CR 383.3.a: "you may" opens the trigger effect, so the controller decides
  // at finalization whether to perform the ability.
  assert.equal(playedTrigger.optional, true);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(maySpend.id, "wildclaw.may-spend");
  assert.equal(maySpend.op, "choice.optional");
  // Contract 3.9: "may" is always choice.optional with the chosen instructions
  // inside body (never choice + linkedTo).
  assert.equal(maySpend.args.body.kind, "constant");
  assert.deepEqual(
    maySpend.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["wildclaw.spend-buff", "effect.buff"],
      ["wildclaw.buff-self", "effect.buff"],
      ["wildclaw.ready-self", "effect.ready"]
    ]
  );
  assert.deepEqual(maySpend.args.prompt, {
    kind: "constant",
    value: "Spend a buff to buff and ready Wildclaw Shaman?"
  });

  assert.deepEqual(spendBuff.args, {
    mode: { kind: "constant", value: "spend" },
    target: { kind: "constant", value: "self" }
  });
  assert.equal(spendBuff.linkedTo, undefined);
  // "to buff me" — the buff is the result of the spent buff, so it waits for it
  // (CR 359.3.e.14/359.3.e.14.b).
  assert.equal(buffSelf.linkedTo, "wildclaw.spend-buff");
  assert.equal(buffSelf.targets, undefined);
  assert.deepEqual(buffSelf.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "self" }
  });
  // The Finalize-time cost gate and the linkage from the spent buff are part of
  // the missing host-selector / in-instruction-cost work (see judgeReason and
  // the todos below), so the ready instruction carries its own source selector.
  assert.equal(readySelf.linkedTo, undefined);
  assert.deepEqual(readySelf.args, { objects: { kind: "constant", value: { kind: "source" } } });
});

test("golden: spending the buff clears it (CR 702.2.b) and readies the exhausted host (CR 416.1)", () => {
  const kernel = world().unit("shaman", { exhausted: true, buffs: 1 }).build();
  const shamanRef = kernel.ref("shaman");
  // "me" is the host, not a chosen target (CR 355.10.d), so the finalized host
  // reference is supplied to the kernel directly instead of via a TargetSpec.
  const spent = runInstruction(buff, { mode: "spend", target: "self" }, {
    world: kernel,
    targets: { self: [shamanRef] }
  });
  assert.equal(spent.result.status, "executed");
  assert.equal(kernel.getObject("shaman").buffs, 0);
  assert.deepEqual(spent.events.map(event => event.action), ["spend-buff"]);

  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("shaman") });
  const readied = runInstruction(ready, readySelf.args, { world: scoped });
  assert.equal(readied.result.status, "executed");
  assert.equal(scoped.getObject("shaman").exhausted, false);
});

test("golden: without a buff the spend cannot happen (CR 702.2.b.1)", () => {
  const kernel = world().unit("shaman", { buffs: 0 }).build();
  const run = runInstruction(buff, { mode: "spend", target: "self" }, {
    world: kernel,
    targets: { self: [kernel.ref("shaman")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("shaman").buffs, 0);
  assert.deepEqual(run.linked.spentCount, 0);
});

test("golden: declining the may-choice skips the body through the interpreter (contract 3.9)", () => {
  const kernel = world().unit("shaman", { exhausted: true, buffs: 1 }).build();
  kernel.setAnswers({ "wildclaw.may-spend/optional": false });
  const outcome = runAbilityBody(playedTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["wildclaw.may-spend"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  // Nothing inside the optional body ran: the buff is intact and the host still
  // exhausted.
  assert.equal(kernel.getObject("shaman").buffs, 1);
  assert.equal(kernel.getObject("shaman").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("golden: accepting the may-choice keeps the body and readies the exhausted host", () => {
  const kernel = world().unit("shaman", { exhausted: true, buffs: 1 }).build();
  // "me" is the ability host; the reference kernel's default source is a
  // synthetic object, so bind the host explicitly (never a TargetSpec, CR 355.10.d).
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("shaman") });
  scoped.setAnswers({ "wildclaw.may-spend/optional": true });
  const outcome = runAbilityBody(playedTrigger.body, scoped);
  assert.deepEqual(
    outcome.results.map(result => result.id),
    ["wildclaw.spend-buff", "wildclaw.buff-self", "wildclaw.ready-self", "wildclaw.may-spend"]
  );
  // The chosen container ran (contract 3.9 links value: true on acceptance).
  const container = outcome.results.find(result => result.id === "wildclaw.may-spend");
  assert.equal(container.result.status, "executed");
  assert.deepEqual(container.result.linkedValues, { value: true });
  // "and ready me": the host-selector form of effect.ready resolves the source
  // object and readies it (CR 416.1).
  const readyResult = outcome.results.find(result => result.id === "wildclaw.ready-self");
  assert.equal(readyResult.result.status, "executed");
  assert.equal(scoped.getObject("shaman").exhausted, false);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);
});

test.todo(
  "Wildclaw Shaman: the trigger's in-instruction cost — 'spend a buff' must be paid while finalizing " +
    "the triggered ability (CR 740.4.a/355.10.c.1/383.3.b/383.3.b.1), deciding whether the trigger is " +
    "placed on the chain; TriggerRegistration.cost does not consume the spend-buff inside the " +
    "choice.optional body yet (RIFT-89/90)"
);
test.todo(
  "Wildclaw Shaman: 'me' needs a host-selector form for effect.buff/effect.ready that is not a " +
    "TargetSpec (CR 355.10.d) — filed as a contract change request"
);
test.todo(
  "Wildclaw Shaman: the played trigger only becomes reachable once the card-played timing emitted by " +
    "chain/engine.ts is wired through the server-facing runtime (engine batch 4)"
);
