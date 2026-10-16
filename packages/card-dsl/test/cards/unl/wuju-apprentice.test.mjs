import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wuju-apprentice.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e074cc6d861492ad66a59dfbd4aee7f822557cbb0d0e6d32f02e2690c97a07a2";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "[Level 6][>] When you play me, draw 1. (While you have 6+ XP, get the effect.)";

const [hunt, dependentAbility] = program.abilities;
const [drawOne] = dependentAbility.body;

test("unl-040-219 Wuju Apprentice: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-040-219 Wuju Apprentice: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /823\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /PlayerSnapshot\.xp/);
  assert.match(program.judgeReason, /kw-level/);
});

test("unl-040-219 Wuju Apprentice: [Hunt] is a keyword declaration only", () => {
  assert.equal(program.abilities.length, 2);
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理。
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
  assert.equal(hunt.value, undefined);
});

test("unl-040-219 Wuju Apprentice: [Level 6][>]'s dependent ability is the printed play trigger with a 6+ XP gate", () => {
  // 824.1.b.2：[Text] 是 Dependent Ability；本卡的 [Text] 是 “When you play me, draw 1.”
  assert.equal(dependentAbility.kind, "triggered");
  assert.equal(dependentAbility.trigger.at, "card-played");
  assert.deepEqual(dependentAbility.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 824.1.c / 824.1.d：6+ XP 门控的保留形状（合并的 Condition 读不到 PlayerSnapshot.xp）。
  const condition = dependentAbility.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 6 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "controller-xp");
  assert.equal(dependentAbility.optional, false);
  assert.equal(dependentAbility.body.length, 1);
  assert.equal(drawOne.id, "wuju-apprentice.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-040-219 Wuju Apprentice golden: the printed 'draw 1' draws the top card (CR 414.1/414.3)", () => {
  const kernel = world().deck(["top-card", "deep-card"]).build();
  const outcome = resolveChainBody(dependentAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["wuju-apprentice.draw-1", "executed"]
  ]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["deep-card"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("unl-040-219 Wuju Apprentice golden: an empty deck draws as much as possible (CR 414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "unl-040-219 Wuju Apprentice: expand [Hunt] (CR 823.1.b/823.1.c.1, 823.2 summing) into conquer and hold " +
    "triggers gaining 1 XP — no hunt KeywordDef exists (ability-templates kw-hunt)"
);
test.todo(
  "unl-040-219 Wuju Apprentice: expand [Level 6][>] (CR 824.1.b.1: 'while you have 6 or more XP, this card " +
    "gains [Text]') with the dynamic Active/Inactive re-evaluation of 824.1.c.1/824.1.d — no kw-level " +
    "expansion and no readable XP expression path are merged (RIFT-89/90)"
);
test.todo(
  "unl-040-219 Wuju Apprentice: fire the card-played trigger from the real chain flow (CR 420.4.a) — " +
    "depends on RIFT-120 chain/event integration"
);
