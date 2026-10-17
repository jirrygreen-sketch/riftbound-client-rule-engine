import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vanguard-captain.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// resolveChainBody is the production card-body entry point
// (chain/engine.ts resolveChainBody(item.body, context)); it wraps primitive arg
// expressions the way the chain does, which is what effect.token's Expr-only
// schema expects (the plain interpreter hands it already-evaluated values).
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const READ_ID = "vanguard-captain.read-here";
const PLAY_ID = "vanguard-captain.play-two-recruits";

const tokensOnBoard = (kernel) =>
  kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);

test("ogn-218-298 Vanguard Captain: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-a6aafcc461fa5b268158126142402b9ead1ed267a31499c8ae62e16387e3f39c"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /历史计数/);
  assert.doesNotMatch(program.judgeReason, /testTrigger/);
  assert.equal(
    program.sourceText,
    "[Legion] — When you play me, play two 1 :rb_might: Recruit unit tokens here. " +
      "(Get the effect if you've played another card this turn.)"
  );
});

test("ogn-218-298 Vanguard Captain: Legion keyword plus two linked instructions playing two Recruits", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "legion");
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  // "When you play me": the played card identifies itself by canonical id; the
  // older { filter: { source: "self" } } spelling is rejected by the engine
  // validator.
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: program.canonicalCardId }
  });
  assert.equal(triggered.trigger.condition.kind, "compare");
  assert.equal(triggered.trigger.condition.left.kind, "count");
  assert.equal(triggered.trigger.condition.left.subject, "cards-finalized-this-turn");
  assert.deepEqual(triggered.trigger.condition.left.filter, {
    player: "controller",
    exclude: "self"
  });
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 2);
  const [read, play] = triggered.body;
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
  // "play two … tokens": one instruction plays both, per CR 440.2.c / 185.2.a.
  assert.deepEqual(play.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(play.args.location, {
    kind: "linked-value",
    instructionId: READ_ID,
    key: "here"
  });
  assert.equal(play.linkedTo, READ_ID);
  assert.equal(play.targets, undefined);
});

test("ogn-218-298 Vanguard Captain golden: two 1-Might Recruits are played at the source battlefield", () => {
  const kernel = world()
    .unit("vanguard-captain", {
      might: 3,
      location: { type: "battlefield", id: "battlefield-3" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("vanguard-captain") });

  const outcome = resolveChainBody(program.abilities[1].body, kernel);
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
    id: "battlefield-3"
  });

  const tokens = tokensOnBoard(kernel);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    // CR 187.1: Recruit is a 1-Might unit token.
    assert.equal(token.name, "Recruit");
    assert.equal(token.might, 1);
    assert.deepEqual(token.location, { type: "battlefield", id: "battlefield-3" });
    assert.equal(token.controller, "A");
    assert.equal(token.isToken, true);
  }
  // The token receipt exposes both new identities in creation order.
  const created = outcome.linkedValues[PLAY_ID + ".token.objects"];
  assert.equal(created.length, 2);
  assert.notEqual(created[0].id, created[1].id);
});

test("ogn-218-298 Vanguard Captain golden: tokens land in the controller base when the source is in base", () => {
  const kernel = world()
    .unit("vanguard-captain", { might: 3, location: { type: "base", player: "A" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("vanguard-captain") });

  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  const tokens = tokensOnBoard(kernel);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.deepEqual(token.location, { type: "base", player: "A" });
  }
});

test.todo(
  "ogn-218-298 Vanguard Captain: [Legion] dependent-ability activation (CR 812.1.b.1/812.1.c) — " +
    "需要触发条件历史查询与按卡身份排除字段"
);
