import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/noxian-drummer.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// resolveChainBody is the production card-body entry point
// (chain/engine.ts resolveChainBody(item.body, context)).
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const READ_ID = "noxian-drummer.read-here";
const PLAY_ID = "noxian-drummer.play-recruit";

test("ogn-222-298 Noxian Drummer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-5518503e78770284d5f2f55292d0d27dd571a336dd4bcae40fdc3ee530d2b12d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /object-moved/);
  assert.equal(
    program.sourceText,
    "When I move to a battlefield, play a 1 :rb_might: Recruit unit token here. " +
      "(It is also at the battlefield.)"
  );
});

test("ogn-222-298 Noxian Drummer: object-moved trigger with read-here then a linked Recruit play", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 449.2: a Move is defined by origin and destination;
  // 458.1 excludes Recalls from move triggers.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", objectId: "self", toZone: "battlefield" });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 2);
  const [read, play] = ability.body;
  assert.equal(read.id, READ_ID);
  assert.equal(read.op, "condition.value");
  assert.deepEqual(read.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(play.id, PLAY_ID);
  assert.equal(play.op, "effect.token");
  assert.deepEqual(play.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(play.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: a NEW token is created on the Chain and then played.
  assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(play.args.location, {
    kind: "linked-value",
    instructionId: READ_ID,
    key: "here"
  });
  assert.equal(play.linkedTo, READ_ID);
  assert.equal(play.targets, undefined);
});

test("ogn-222-298 Noxian Drummer golden: the effect body plays a 1-Might Recruit at the source battlefield", () => {
  // The trigger plumbing for "When I move to a battlefield" is judged (see the
  // todos); the body itself is executed for real with the source already at the
  // battlefield the Move delivered it to (CR 359.3.f.2 "here").
  const kernel = world()
    .unit("noxian-drummer", {
      might: 3,
      location: { type: "battlefield", id: "battlefield-4" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("noxian-drummer") });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      [READ_ID, "executed"],
      [PLAY_ID, "executed"]
    ]
  );
  assert.deepEqual(outcome.linkedValues[READ_ID + ".here"], {
    type: "battlefield",
    id: "battlefield-4"
  });

  const tokens = kernel
    .query({ zone: "board", type: "unit" })
    .filter((object) => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Recruit");
  assert.equal(tokens[0].might, 1);
  assert.deepEqual(tokens[0].location, { type: "battlefield", id: "battlefield-4" });
  assert.equal(tokens[0].controller, "A");
});

test.todo(
  "ogn-222-298 Noxian Drummer: object-moved trigger filter — the pipeline now emits the point " +
    "(RIFT-270), the program binding now expresses 'this card moved' through objectId: 'self', but " +
    "the emitted event does not fill toZone, so the toZone: 'battlefield' filter never matches; the duel Standard Move " +
    "result is not submitted to the pipeline yet"
);
