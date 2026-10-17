import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/chemtech-enforcer.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-ed8cf6c764ed889b192049c35919693d1664dee6da3044cdb42dae8a561a5a59";

test("chemtech-enforcer: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("chemtech-enforcer: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The keyword and trigger bindings exist; the remaining gap is the
  // unevaluated designation/compare condition in the Assault expansion.
  assert.match(program.judgeReason, /KeywordDef\.expand/);
  assert.match(program.judgeReason, /CardProgram.*trigger/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /conditionMatches|compare/);
  assert.match(program.judgeReason, /807/);
  assert.equal(
    program.sourceText,
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\nWhen you play me, discard 1."
  );
});

test("chemtech-enforcer: Assault 2 is declared as a valued keyword, never rewritten as rules text", () => {
  const [keywordAbility, triggered] = program.abilities;
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keywordAbility, { kind: "keyword", keyword: "assault", value: 2 });
  assert.equal(triggered.kind, "triggered");
});

test("chemtech-enforcer: 'When you play me' is a mandatory card-played trigger filtered to the source (420.4.a)", () => {
  const triggered = program.abilities[1];
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
});

test("chemtech-enforcer: body is a single untargeted effect.discard 1 (423.1/423.4, non-target pick 355.10.c)", () => {
  const triggered = program.abilities[1];
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "chemtech-enforcer.discard");
  assert.equal(instruction.op, "effect.discard");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("chemtech-enforcer: the discard body discards exactly one card through the merged primitive", () => {
  const kernel = world()
    .hand("kept", { owner: "A" })
    .hand("discarded", { owner: "A" })
    .build();
  // The instruction's private hand choice is replayed by stable request id
  // (interpreter README: <instruction path>/<choice id>); the primitive's
  // default choice id is effect.discard:<player>.
  kernel.setAnswers({ "chemtech-enforcer.discard/effect.discard%3AA": [kernel.ref("discarded")] });
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["discarded"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["kept"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["discard"]);
  const [result] = outcome.results;
  assert.equal(result.op, "effect.discard");
  assert.equal(result.result.status, "executed");
  assert.equal(result.result.linkedValues.discarded.count, 1);
});

test("chemtech-enforcer: an empty hand negates the discard as impossible, still as much as possible (423.4)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "partial");
  const [result] = outcome.results;
  assert.equal(result.result.status, "negated");
  assert.equal(result.result.reason, "impossible");
  assert.deepEqual(kernel.events, []);
});

test("chemtech-enforcer: the discarded card is observable as turn history when the choice is replayed", () => {
  const kernel = world().hand("kept", { owner: "A" }).hand("discarded", { owner: "A" }).build();
  kernel.setAnswers({ "chemtech-enforcer.discard/effect.discard%3AA": [kernel.ref("discarded")] });
  resolveChainBody(program.abilities[1].body, kernel);
  const gate = runAbilityBody([{
    id: "gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], kernel);
  assert.equal(gate.linkedValues["gate.count"], 1);
  assert.equal(gate.linkedValues["gate.value"], true);
});

test.todo(
  "chemtech-enforcer: Assault 2 keyword expansion (+2 Might while the Attacker designation is held, CR 807) " +
    "needs the granted KeywordDef expansion to be consumed by layers plus the designation " +
    "characteristic and compare-condition evaluation in layers"
);
