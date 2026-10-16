import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/yordle-explorer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0bf2f78a39c15787c743ca80bf9a8a0faa2ab20b9e055830b9d7e280dd5469ed";
const SOURCE_TEXT =
  "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("sfd-100-221 Yordle Explorer: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-100-221 Yordle Explorer: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-100-221 Yordle Explorer: judgeReason names the printed-Power-cost predicate gap", () => {
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /Power cost/);
  assert.match(program.judgeReason, /206\.1/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("sfd-100-221 Yordle Explorer: a card-played trigger scoped to the controller's plays", () => {
  // 383.4.a / 420.4.a: "When you play a card" fires after any play the ability's
  // controller completes; 190.6.d makes "you" the ability controller.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.filter.event, "card-played");
  assert.equal(ability.trigger.filter.player, "self");
});

test("sfd-100-221 Yordle Explorer: the Power-cost ceiling is a declarative filter key, not a live predicate", () => {
  // 383.2.a.1 puts the "with Power cost … or more" clause on the trigger itself;
  // 135.2.e.5 / 206.1 fix its meaning (any-domain Power, printed cost). The
  // frozen Condition has no event-object printed-cost read, so the key records
  // the printed threshold without pretending to evaluate it.
  assert.deepEqual(ability.trigger.filter.filter, { powerCostGte: 2 });
  assert.equal(ability.trigger.filter.object, undefined);
  assert.equal(ability.trigger.filter.source, undefined);
});

test("sfd-100-221 Yordle Explorer: body is one unlinked effect.draw of exactly 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "yordle-explorer.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("sfd-100-221 Yordle Explorer golden: the body draws 1 for the ability controller", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["yordle-explorer.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawn"], 1);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawnTo"], "A");
});

test("sfd-100-221 Yordle Explorer golden: the draw follows the ability controller, not a fixed seat", () => {
  const kernel = world().deck(["top-card", "second-card"], { owner: "B" }).build();
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawnTo"], "B");
});

test("sfd-100-221 Yordle Explorer golden: an empty deck links the actual drawn count of 0 (414.4)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawn"], 0);
});

test.todo(
  "sfd-100-221 Yordle Explorer: evaluate 'with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more' at " +
    "trigger time (383.2.a.1) — the frozen Condition/Expr cannot read the played card's printed Power cost " +
    "(206.1, 135.2.e.5) and the card-played emission carries no cost payload, so the filter key stays " +
    "declarative (RIFT-120 follow-up: event-object cost predicate)"
);

test.todo(
  "sfd-100-221 Yordle Explorer: register the card-played subscription with its trigger condition through " +
    "the CardProgram -> trigger pipeline (383.2.a.1, 420.4.a) — RIFT-120 follow-up"
);
