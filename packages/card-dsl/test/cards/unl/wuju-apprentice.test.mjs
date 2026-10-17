import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wuju-apprentice.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
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
  assert.match(program.judgeReason, /RIFT-268/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
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

test("unl-040-219 Wuju Apprentice golden: the merged [Hunt] expansion really gains 1 XP on conquer and hold", () => {
  // RIFT-265's Hunt definition expands this card's declaration into the two
  // printed triggers (823.1.b / 823.1.c.1) with the omitted value read as 1
  // (823.1.c.2); effect.xp really increases the controller's XP.
  const hunt = keywordDefinitionsById.get("Hunt");
  assert.equal(typeof hunt, "object");
  assert.equal(hunt.valued, true);
  assert.equal(hunt.stacking, "sum");
  const expansion = hunt.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map((ability) => ability.trigger.at), ["conquer", "hold"]);
  for (const ability of expansion) {
    assert.equal(ability.body[0].op, "effect.xp");
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 1 });
  }

  const kernel = world().player("A", { xp: 0 }).unit("apprentice", { owner: "A", controller: "A" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("apprentice") });
  for (const ability of expansion) {
    const outcome = resolveChainBody(ability.body, context);
    assert.equal(outcome.status, "executed");
  }
  assert.equal(context.player("A").xp, 2);
  assert.equal(context.events.filter((event) => event.action === "gain-xp").length, 2);
});

test("unl-040-219 Wuju Apprentice: the [Level 6] dependent ability passes the closed trigger vocabulary", () => {
  // The dependent ability is a card-played trigger; translateTriggerFilter turns
  // its declared event spelling into the closed EventPattern vocabulary.
  const translated = translateTriggerFilter(dependentAbility.trigger.filter, "apprentice", "card-played");
  assert.equal(validateTriggerSpec({ at: "card-played", filter: translated }).ok, true);
});

test.todo(
  "unl-040-219 Wuju Apprentice: register the merged [Hunt] expansion with the event pipeline — Hunt.ts declares " +
    "event \"conquer\"/\"hold\" while the closed EVENT_PATTERN_TYPES only accepts \"conquered\"/\"held\", so " +
    "validateTriggerSpec rejects the registration; scoring also does not produce the corresponding events"
);
test.todo(
  "unl-040-219 Wuju Apprentice: bind the [Level 6][>] dependent ability (CR 824.1.b.1 / 824.1.c.1 / 824.1.d) — " +
    "keywords/Level.ts publishes only the condition.predicate declaration and no compiler attaches it to this " +
    "card's dependent text, and the merged Condition cannot read the controller's XP (RIFT-268 follow-up)"
);
test.todo(
  "unl-040-219 Wuju Apprentice: evaluate the 6+ XP gate on the dependent ability — the retained compare shape " +
    "counts queried objects (PlayerSnapshot.xp has no Expr path), so it must not be bound as-is (CR 824.1.c)"
);
