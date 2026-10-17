import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/adaptatron.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-efa44994f07966ad8095ddd1f56f9c20b1246888b3f037a54a196793f2cb0f4b";
const SOURCE_TEXT =
  "When I conquer, you may kill a gear. If you do, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)";

const triggered = program.abilities[0];
const optional = triggered.body[0];
const [killInstruction, buffInstruction] = optional.args.body.value;

/** Build a world with a host unit, one gear, and the locked targets. */
function buildWorld({ gear = true, hostBuffs = 0 } = {}) {
  const builder = world().unit("adaptatron", { owner: "A", might: 3, buffs: hostBuffs });
  if (gear) builder.unit("gear-1", { owner: "A", types: ["gear"], zone: "board" });
  const kernel = builder.build();
  kernel.setTargets("adaptatron.gear", gear ? [kernel.ref("gear-1")] : []);
  kernel.setTargets("adaptatron.me", [kernel.ref("adaptatron")]);
  return kernel;
}

function runWith(answer, options = {}) {
  const kernel = buildWorld(options);
  kernel.setAnswers({ "adaptatron.may-kill-gear/optional": answer });
  const outcome = runAbilityBody(triggered.body, kernel, undefined, {
    host: kernel.ref("adaptatron")
  });
  return { kernel, outcome };
}

test("ogn-056-298 Adaptatron: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-056-298 Adaptatron: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-056-298 Adaptatron: conquer trigger filtered to self, mandatory trigger", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
});

test("ogn-056-298 Adaptatron: structure — optional wrapper containing kill then gated buff", () => {
  // Contract 3.9: "you may" wraps the instructions it selects; it is NOT a bare
  // choice with a linked follow-up. The optional wrapper owns the gate.
  assert.equal(triggered.body.length, 1);
  assert.equal(optional.id, "adaptatron.may-kill-gear");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.args.prompt.value, "Kill a gear to buff Adaptatron?");

  // 355.5/355.10: "kill a gear" chooses a specific Game Object, so it is a
  // TargetSpec on the merged effect.kill primitive.
  assert.equal(killInstruction.id, "adaptatron.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    target: { kind: "constant", value: "adaptatron.gear" }
  });
  assert.deepEqual(killInstruction.targets, [
    {
      id: "adaptatron.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "If you do, buff me": linked to the kill and gated on its receipt
  // (359.3.e.14.b), so a replaced or impossible kill leaves the buff unexecuted.
  assert.equal(buffInstruction.id, "adaptatron.buff-me");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.equal(buffInstruction.linkedTo, "adaptatron.kill-gear");
  assert.deepEqual(buffInstruction.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "adaptatron.kill-gear",
      key: "killed"
    },
    operator: "ne",
    right: { kind: "constant", value: [] }
  });
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "adaptatron.me" }
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "adaptatron.me",
      filter: { object: "self", type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-056-298 Adaptatron golden: accepting kills the gear and buffs Adaptatron", () => {
  const { kernel, outcome } = runWith(true);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("gear-1").zone, "trash");
  assert.equal(kernel.getObject("adaptatron").buffs, 1);
  const killResult = outcome.results.find((entry) => entry.id === "adaptatron.kill-gear");
  assert.equal(killResult.result.status, "executed");
  assert.equal(killResult.result.linkedValues.killed.length, 1);
  const buffResult = outcome.results.find((entry) => entry.id === "adaptatron.buff-me");
  assert.equal(buffResult.result.status, "executed");
});

test("ogn-056-298 Adaptatron golden: declining skips the kill and the buff (contract 3.9 refusal)", () => {
  const { kernel, outcome } = runWith(false);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["adaptatron.may-kill-gear"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("gear-1").zone, "board");
  assert.equal(kernel.getObject("adaptatron").buffs, 0);
});

test("ogn-056-298 Adaptatron golden: a replaced kill cancels the buff but leaves the gear (CR 359.3.e.14.b)", () => {
  const replacedWorld = buildWorld();
  replacedWorld.setAnswers({ "adaptatron.may-kill-gear/optional": true });
  replacedWorld.addReplacement(() => "replaced");
  const replacedOutcome = runAbilityBody(triggered.body, replacedWorld, undefined, {
    host: replacedWorld.ref("adaptatron")
  });
  const killResult = replacedOutcome.results.find((entry) => entry.id === "adaptatron.kill-gear");
  assert.equal(killResult.result.status, "negated");
  assert.equal(killResult.result.reason, "replaced");
  assert.equal(replacedWorld.getObject("gear-1").zone, "board");
  assert.equal(replacedWorld.getObject("adaptatron").buffs, 0);
});

test("ogn-056-298 Adaptatron golden: an already-buffed Adaptatron keeps exactly one Buff (CR 702.3.a)", () => {
  const { kernel, outcome } = runWith(true, { hostBuffs: 1 });
  assert.equal(kernel.getObject("adaptatron").buffs, 1);
  const buffResult = outcome.results.find((entry) => entry.id === "adaptatron.buff-me");
  assert.equal(buffResult.result.status, "negated");
  assert.equal(buffResult.result.reason, "skipped");
});

test("ogn-056-298 Adaptatron golden: with no gear the kill is ignored and the buff does not run", () => {
  const { kernel, outcome } = runWith(true, { gear: false });
  const killResult = outcome.results.find((entry) => entry.id === "adaptatron.kill-gear");
  assert.equal(killResult.result.status, "ignored");
  assert.equal(killResult.result.reason, "mistargeted");
  assert.equal(kernel.getObject("adaptatron").buffs, 0);
});

// ---------------------------------------------------------------------------
// Not executable — TODO item with a real cause (see judgeReason).
// ---------------------------------------------------------------------------

test.todo(
  "ogn-056-298 Adaptatron: the conquer trigger still cannot register: the card's nested " +
    "{ event, filter } spelling is rejected by events/trigger-spec.ts and no merged consumer " +
    "binds a CardProgram's triggered ability into a TriggerRegistration (RIFT-257)."
);
