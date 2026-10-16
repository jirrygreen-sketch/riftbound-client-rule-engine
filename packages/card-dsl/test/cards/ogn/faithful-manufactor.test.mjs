import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/faithful-manufactor.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
// resolveChainBody is the production card-body entry point (chain/engine.ts
// resolveChainBody(item.body, context)); it wraps primitive arg expressions the
// way the chain does, which is what effect.token's Expr-only schema expects.
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const READ_ID = "faithful-manufactor.read-here";
const PLAY_ID = "faithful-manufactor.play-recruit";

const boardOf = (kernel) =>
  kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);

test("ogn-211-298 Faithful Manufactor: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-ef1c7eb120057e88602660880f334f51bc98de276bb82ec36762ef1b9981a792"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, play a 1 :rb_might: Recruit unit token here."
  );
});

test("ogn-211-298 Faithful Manufactor: card-played self trigger with read-here then linked token play", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", source: "self" });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

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
  // CR v1.5 440.2.c / 185.2.a：被「打出」的 token 先在链上生成再走打出流程。
  assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
  // 「here」引用前一条指令写下的链接值（359.3.f.1/f.2 referent）。
  assert.deepEqual(play.args.location, {
    kind: "linked-value",
    instructionId: READ_ID,
    key: "here"
  });
  assert.equal(play.linkedTo, READ_ID);
  assert.equal(play.targets, undefined);
  assert.equal(play.picks, undefined);
});

test("ogn-211-298 Faithful Manufactor golden: plays a 1-Might Recruit at the source battlefield", () => {
  const kernel = world()
    .unit("manufactor", {
      might: 2,
      location: { type: "battlefield", id: "battlefield-7" }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("manufactor") });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      [READ_ID, "executed"],
      [PLAY_ID, "executed"]
    ]
  );
  // The read writes the source's current location (CR 359.3.f.2).
  assert.deepEqual(outcome.linkedValues[READ_ID + ".here"], {
    type: "battlefield",
    id: "battlefield-7"
  });

  const tokens = boardOf(kernel);
  assert.equal(tokens.length, 1);
  const [recruit] = tokens;
  // CR 187.1: Recruit is a 1-Might unit token (effect.token definition "recruit").
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.location, { type: "battlefield", id: "battlefield-7" });
  assert.equal(recruit.controller, "A");
  assert.equal(recruit.isToken, true);
});

test("ogn-211-298 Faithful Manufactor golden: the token lands at the source's base when played to base", () => {
  const kernel = world()
    .unit("manufactor", { might: 2, location: { type: "base", player: "A" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("manufactor") });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  const tokens = boardOf(kernel);
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0].location, { type: "base", player: "A" });
});

test("ogn-211-298 Faithful Manufactor: an ignored 'here' read suppresses the linked token play (contract 3.4)", () => {
  // The read targets a TargetSpec that Finalize never resolved (empty locked
  // set), so the read itself is ignored/mistargeted; the linked play must then be
  // ignored as linked-ignored and must not create a token (CR 359.3.e.12).
  const kernel = world()
    .unit("manufactor", { might: 2, location: { type: "base", player: "A" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("manufactor") });

  const [read, play] = program.abilities[0].body;
  const unresolvableRead = {
    ...read,
    args: {
      value: {
        kind: "object-property",
        object: { target: "unresolved-spec" },
        property: "location"
      },
      key: { kind: "constant", value: "here" }
    },
    targets: [
      {
        id: "unresolved-spec",
        filter: { type: "unit", zone: "board" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  };
  const outcome = resolveChainBody([unresolvableRead, play], kernel);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      [READ_ID, "ignored", "mistargeted"],
      [PLAY_ID, "ignored", "linked-ignored"]
    ]
  );
  assert.equal(boardOf(kernel).length, 0);
});

test("ogn-211-298 Faithful Manufactor: a forward or unknown linkedTo reference is rejected (contract 3.4)", () => {
  const kernel = world()
    .unit("manufactor", { might: 2, location: { type: "base", player: "A" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("manufactor") });
  const [, play] = program.abilities[0].body;
  assert.throws(
    () => resolveChainBody([play], kernel),
    /Unknown or forward instruction link/
  );
});

test.todo(
  "ogn-211-298 Faithful Manufactor: full trigger path — card-played subscription, trigger batching and " +
    "the 355.3/355.15 Finalize transaction that registers the trigger on play (依赖 RIFT-120 事件管线 / 链)"
);
