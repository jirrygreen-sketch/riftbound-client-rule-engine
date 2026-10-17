import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/yasuo-windrider.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-03848f0e530587876003913478c758509f6b05e8b89b33575cb4fd9da70f9cf1";
const SOURCE_TEXT =
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "The third time I move in a turn, you score 1 point.";
const literal = value => ({ kind: "constant", value });

const [keyword, triggered] = program.abilities;
const [scoreInstruction] = triggered.body;

/** Yasuo on battlefield bf-1; effect.move actions relocating him are real Moves. */
function yasuoWorld() {
  const kernel = world().unit("yasuo", { location: { type: "battlefield", id: "bf-1" } }).build();
  return kernel.clone({
    source: kernel.ref("yasuo"),
    sourceSnapshot: kernel.getObject("yasuo")
  });
}

function moveYasuo(kernel, destination) {
  return runInstruction(
    move,
    { objects: literal({ target: "yasuo" }), to: literal({ type: "battlefield", id: destination }) },
    { world: kernel, targets: { yasuo: [kernel.ref("yasuo")] } }
  );
}

test("ogn-205-298 Yasuo, Windrider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /470\.2/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /第 N 次/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-205-298 Yasuo, Windrider: Ganking keyword plus a third-move trigger that scores 1 point", () => {
  assert.equal(program.abilities.length, 2);
  // CR 810: Ganking is a passive ability keyword; the card only names it
  // (contract §5), the expansion lives in effects/keywords/Ganking.ts.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  // CR 383.1.b / 383.2.a: "the [Nth] time" is the trigger condition; 449.1
  // defines the Move that the object-moved timing point reports.
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, { event: "object-moved", source: "self" });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  // "The third time I move in a turn": count this object's Moves this turn.
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, literal(3));
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "self-moves-this-turn");
  assert.deepEqual(condition.left.filter, {
    object: "self",
    action: "move-location",
    scope: "turn"
  });

  assert.equal(triggered.body.length, 1);
  // CR 470.2: card text "score X points" means Gaining Points, not the
  // battlefield Scoring process.
  assert.equal(scoreInstruction.id, "yasuo-windrider.score-1");
  assert.equal(scoreInstruction.op, "effect.score");
  assert.deepEqual(scoreInstruction.args.amount, literal(1));
  assert.equal(scoreInstruction.targets, undefined);
  assert.equal(scoreInstruction.picks, undefined);
  assert.equal(scoreInstruction.linkedTo, undefined);
  assert.equal(scoreInstruction.condition, undefined);
});

test("ogn-205-298 Yasuo, Windrider: the granted Ganking id matches the registered definition", () => {
  const definition = keywordDefinitionsById.get("Ganking");
  assert.ok(definition);
  assert.equal(definition, ganking);
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(definition.stacking, "single");
  const [staticAbility] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(staticAbility.effect, {
    kind: "continuous.movement",
    permission: "battlefield-to-battlefield",
    source: "battlefield",
    destination: "battlefield",
    move: "standard",
    addsPermission: true
  });
});

test("ogn-205-298 Yasuo, Windrider golden: 'you score 1 point' really gains 1 point (CR 470.2)", () => {
  const kernel = yasuoWorld();
  const outcome = runAbilityBody([scoreInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
});

test("ogn-205-298 Yasuo, Windrider golden: the merged history query counts this unit's real Moves", () => {
  // The printed count ("the third time I move this turn") needs this unit's
  // move history. The merged condition.history instruction executes exactly
  // that query; the golden feeds it real effect.move actions (449 moves) and
  // reads the count.
  const kernel = yasuoWorld();
  const history = (operator, right) => ({
    id: "yasuo-windrider.count-moves",
    op: "condition.history",
    args: {
      query: literal({
        action: "move-location",
        object: kernel.ref("yasuo"),
        scope: "turn"
      }),
      ...(operator === undefined ? {} : { operator: literal(operator) }),
      ...(right === undefined ? {} : { right: literal(right) })
    }
  });

  assert.equal(moveYasuo(kernel, "bf-2").result.status, "executed");
  const afterOne = runAbilityBody([history(undefined, undefined)], kernel);
  assert.equal(afterOne.results[0].result.linkedValues.count, 1);

  assert.equal(moveYasuo(kernel, "bf-1").result.status, "executed");
  const afterTwo = runAbilityBody([history("eq", 3)], kernel);
  assert.equal(afterTwo.results[0].result.linkedValues.count, 2);
  assert.equal(afterTwo.results[0].result.linkedValues.value, false);

  assert.equal(moveYasuo(kernel, "bf-2").result.status, "executed");
  const afterThree = runAbilityBody([history("eq", 3)], kernel);
  assert.equal(afterThree.results[0].result.linkedValues.count, 3);
  assert.equal(afterThree.results[0].result.linkedValues.value, true);
});

test.todo(
  "ogn-205-298 Yasuo, Windrider: the trigger condition 'the third time I move in a turn' (383.1.b) needs a " +
    "history predicate in the Condition vocabulary (the merged condition.history is an instruction op, not a " +
    "TriggerSpec condition) and an exactly-once Nth-occurrence shape"
);

test.todo(
  "ogn-205-298 Yasuo, Windrider: register this CardProgram's triggered ability through the card-program layer " +
    "(RIFT-257) and give the object-moved event pattern a closed event name and this-unit payload (the current " +
    "filter spelling is rejected by the merged trigger-spec validator)"
);

test.todo(
  "ogn-205-298 Yasuo, Windrider: [Ganking]'s expansion execution (810.1.c / 144.4.c Battlefield→Battlefield " +
    "Standard Move) — the permission is only read by layers/rules/query.ts movement(); zones/movement.ts still " +
    "consumes caller-supplied readiness/hasGanking records"
);
