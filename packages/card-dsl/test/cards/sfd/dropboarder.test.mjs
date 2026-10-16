import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/dropboarder.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-cf5ebb526629cd42f5259346c00ea7f7b63c437d2818d06612a0ecedc887632d";
const CONDITION_ID = "dropboarder.control-two-gear";

const [ability] = program.abilities;

// "you control" is the ability controller (190.6.d). The chain's Finalize/query
// wrapper normalizes `controller`/`owner` "self" to the item's controller
// (chain/engine.ts); the production object matcher lives in layers/filter.ts.
// Bind both here so the declared condition and body run through the real
// matchers instead of the reference kernel's value-only filter comparison.
const productionQuery = (kernel, filter) => kernel.objects.filter((object) => matchesObjectFilter(
  Object.fromEntries(Object.entries(filter).map(([key, value]) =>
    [key, (key === "controller" || key === "owner") && value === "self" ? kernel.controller : value])),
  object
));

const boundContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => productionQuery(kernel, filter)
});

const conditionBody = [
  {
    id: CONDITION_ID,
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: ability.trigger.condition } }
  }
];

const boardWith = (friendlyGear, extra = () => {}) => {
  const builder = world().unit("dropboarder", { might: 4, exhausted: true });
  for (let index = 0; index < friendlyGear; index += 1) {
    builder.unit("friendly-gear-" + index, { types: ["gear"], controller: "A" });
  }
  extra(builder);
  return builder.build();
};

test("sfd-072-221 Dropboarder: program validates, is registered and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, if you control two or more gear, ready me."
  );
});

test("sfd-072-221 Dropboarder: the extra clause is a trigger condition, not an effect instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  // 383.2.a.1: a conditional statement immediately after the Condition is part
  // of the Trigger Condition, so it must not be pushed into the body.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 2 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "gear");
  assert.deepEqual(condition.left.filter, { type: "gear", controller: "self", zone: "board" });
  assert.equal(ability.body[0].condition, undefined);
});

test("sfd-072-221 Dropboarder: the body readies exactly the source unit", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "dropboarder.ready-me");
  assert.equal(instruction.op, "effect.ready");
  // "me" is the ability source, which is effect.ready's default selection
  // (355.10.g); no fabricated target or runtime ObjectRef is authored.
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-072-221 Dropboarder: the declared condition is true with 2+ friendly gear and false below", () => {
  for (const [friendlyGear, expected] of [[2, true], [3, true], [1, false], [0, false]]) {
    const kernel = boundContext(boardWith(friendlyGear));
    const outcome = resolveChainBody(conditionBody, kernel);
    assert.equal(outcome.status, "executed", "friendly gear = " + friendlyGear);
    assert.equal(
      outcome.linkedValues[CONDITION_ID + ".value"],
      expected,
      "friendly gear = " + friendlyGear
    );
  }
});

test("sfd-072-221 Dropboarder: gear in other zones or controlled by the opponent is not counted", () => {
  const kernel = boundContext(boardWith(1, (builder) => {
    // A second gear is still in hand: not on the Board, so it does not count.
    builder.hand("held-gear", { types: ["gear"], controller: "A" });
    // A gear the opponent controls: not "you control".
    builder.unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" });
  }));
  const outcome = resolveChainBody(conditionBody, kernel);
  assert.equal(outcome.linkedValues[CONDITION_ID + ".value"], false);
});

test("sfd-072-221 Dropboarder golden: the body readies the exhausted source unit (CR 416.1)", () => {
  const kernel = boardWith(2);
  const bound = kernel.clone({
    source: kernel.ref("dropboarder"),
    sourceSnapshot: kernel.getObject("dropboarder")
  });
  assert.equal(bound.getObject("dropboarder").exhausted, true);

  const outcome = resolveChainBody(ability.body, bound);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["dropboarder.ready-me", "executed"]
  ]);
  assert.equal(bound.getObject("dropboarder").exhausted, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
  assert.equal(bound.getObject("friendly-gear-0").exhausted, false);
});

test("sfd-072-221 Dropboarder golden: an already-ready source is a no-op (CR 416.1.b/416.1.c)", () => {
  const kernel = boardWith(2, (builder) => {
    builder.unit("ready-dropboarder", { might: 4, exhausted: false });
  });
  const bound = kernel.clone({
    source: kernel.ref("ready-dropboarder"),
    sourceSnapshot: kernel.getObject("ready-dropboarder")
  });
  const outcome = resolveChainBody(ability.body, bound);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events, []);
  assert.equal(bound.getObject("ready-dropboarder").exhausted, false);
});

test.todo(
  "sfd-072-221 Dropboarder: the card-played subscription evaluates the trigger condition at trigger " +
    "time (CR 383.2.a.1) and puts the ability on the chain as a Pending item (CR 420.4.a) through the " +
    "CardProgram -> trigger/chain adapter (RIFT-120)"
);
