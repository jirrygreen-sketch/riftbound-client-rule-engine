import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/jarvan-iv-martial-paragon.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-24736fa17d67e359a6f4e4ecf2a322db223ee66f6f8e1041e5e227e305a50dee";
const SOURCE_TEXT =
  "Your gear with [Deploy] have [Action]. (They can be played on your turn or in showdowns.)\n" +
  "When I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted.";

test("rad-091-167 Jarvan IV, Martial Paragon: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the current binding and predicate gaps.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /keyword/);
  assert.match(program.judgeReason, /canAct/);
  assert.match(program.judgeReason, /830\.3/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-091-167 Jarvan IV, Martial Paragon: static [Action] grant to Deploy gear", () => {
  assert.equal(program.abilities.length, 2);
  const grant = program.abilities[0];
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Action");
  assert.deepEqual(grant.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board",
    keyword: "Deploy"
  });
});

test("rad-091-167 Jarvan IV, Martial Paragon: conquer trigger gated on a friendly Deploy gear here", () => {
  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(triggered.optional, false);

  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left, {
    kind: "count",
    subject: "gear",
    filter: {
      type: "gear",
      controller: "controller",
      zone: "board",
      keyword: "Deploy",
      sameLocationAs: "self"
    }
  });
});

test("rad-091-167 Jarvan IV, Martial Paragon: channel 1 rune exhausted is declared exactly", () => {
  const triggered = program.abilities[1];
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["jarvan-iv-martial-paragon.channel"]);
  const [instruction] = triggered.body;
  assert.equal(instruction.op, "effect.channel");
  assert.deepEqual(instruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-091-167 Jarvan IV, Martial Paragon: the channel-exhausted body runs through the interpreter", () => {
  const triggered = program.abilities[1];
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues, { "jarvan-iv-martial-paragon.channel.channeled": 1 });
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
  // 431.2: the exhausted stipulation is forwarded as part of the channel-rune action.
  assert.equal(outcome.events[0].action, "channel-rune");
});

test("rad-091-167 Jarvan IV, Martial Paragon: the exhausted stipulation reaches the GameAction", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const actions = [];
  kernel.addReplacement(action => {
    if (action.type === "channel-rune") actions.push(action);
    return null;
  });
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(actions, [{ type: "channel-rune", player: "A", amount: 1, exhausted: true }]);
  assert.equal(kernel.zone("A", "rune-zone").length, 1);
});

test.todo(
  "jarvan-iv-martial-paragon: wire keyword-form Action grants into the timing-permission query — " +
    "layers/rules canAct reads continuous.timing grants/timings only, so object.keywords.Action " +
    "currently grants no timing (CR 806.1.b)"
);
test.todo(
  "jarvan-iv-martial-paragon: evaluate the “has [Deploy]” predicate (CR 830.3) in filters — " +
    "the static binder and trigger condition still cannot evaluate keyword and sameLocationAs filters"
);
