import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/loyal-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-189fb540b58840dbea672bf530705d9fc1548c9fb015ca1b98912e7e4bff7fc1";
const SOURCE_TEXT =
  "[Deathknell][>] If I didn't die alone, draw 1. (When I die, get the effect. " +
  "I wasn't alone if there were other friendly units here.)";

const [deathknellKeyword, diesTrigger] = program.abilities;
const [drawInstruction] = diesTrigger.body;

test("unl-156-219 Loyal Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-156-219 Loyal Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /808\.1\.c\.2/);
  assert.match(program.judgeReason, /RIFT-82/);
});

test("unl-156-219 Loyal Poro: [Deathknell] is declared, not re-implemented (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknellKeyword.value, undefined);
  const registered = keywordDefinitionsById.get("Deathknell");
  assert.ok(registered, "effects/keywords/Deathknell.ts must be in the generated registry");
  assert.equal(deathknellKeyword.keyword, registered.keyword.toLowerCase());
  // 808.2 / 808.2.a：同一永久物上的每个 Deathknell 实例各自独立触发。
  assert.equal(registered.stacking, "separate");
});

test("unl-156-219 Loyal Poro: the printed [Effect] rides an object-killed trigger (CR 808.1.c)", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, { self: true });
  assert.equal(diesTrigger.optional, false);
  assert.equal(diesTrigger.trigger.once, undefined);
});

test("unl-156-219 Loyal Poro: \"didn't die alone\" is a pre-chain condition on the source's location", () => {
  // 808.1.c.2：过去式 Effect 指触发进链那一刻的状态，因此检查是触发条件，不是效果的一部分；
  // 740.2.a：同一位置上有其他友方单位时不是 alone（本卡是它的否定形）。
  const condition = diesTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "source",
    exclude: "source"
  });
});

test("unl-156-219 Loyal Poro: the effect body draws exactly 1 with a single unlinked instruction", () => {
  assert.equal(diesTrigger.body.length, 1);
  assert.equal(drawInstruction.id, "loyal-poro.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-156-219 Loyal Poro golden: the printed draw body draws the top card of the deck", () => {
  const kernel = world().deck(["top-card", "deep-card"]).build();
  const outcome = resolveChainBody(diesTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["loyal-poro.draw-1", "executed"]]
  );
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["deep-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("unl-156-219 Loyal Poro golden: an empty deck draws as much as possible (CR 414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "unl-156-219 Loyal Poro: expand [Deathknell] (subscribe object-killed, removal from the chain when " +
    "the death is replaced per 808.1.d.1, last-known information recorded pre-chain per 808.1.d.3) — " +
    "the KeywordDef only references the unmerged trigger.leave op and card triggers are not registered " +
    "into the event pipeline (RIFT-82 / RIFT-257)"
);
test.todo(
  "unl-156-219 Loyal Poro: evaluate \"didn't die alone\" against the source's last-known location before " +
    "the trigger is queued (CR 740.2.a, 808.1.c.2, 808.1.d.3) — the event pipeline does not evaluate a " +
    "CardProgram trigger condition yet and the 'controller' placeholder is not normalized outside the " +
    "chain query (RIFT-257 / RIFT-120)"
);
