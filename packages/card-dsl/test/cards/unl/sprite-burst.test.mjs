import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sprite-burst.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a332f02df43a6859fd03ddb42f9dc18e759e93aba321780ca24792d78ad7cdac";
const SOURCE_TEXT =
  "Play two ready 3 :rb_might: Sprite unit tokens with [Temporary]. " +
  "(Kill each at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [playSprites] = play.body;

test("unl-069-219 Sprite Burst: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-069-219 Sprite Burst: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /184\.1|185\.2\.d/);
  assert.match(program.judgeReason, /RIFT-9/);
});

test("unl-069-219 Sprite Burst: one play effect with a two-token chain-play instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(playSprites.id, "sprite-burst.play-two-sprites");
  assert.equal(playSprites.op, "effect.token");
  // 187.2: the printed Sprite identity; 185.3.a: token cost is null, never 0.
  assert.deepEqual(playSprites.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprites.args.amount, { kind: "constant", value: 2 });
  // 440.2.c / 185.2.a: play a NEW token = create on the Chain, then play.
  assert.deepEqual(playSprites.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playSprites.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 143.4 / 184.1 / 185.2.d: "ready" is a printed entry-state stipulation, not
  // a later effect.ready (see judgeReason: create-token entry overrides are
  // unsupported, so the value is recorded for review only).
  assert.deepEqual(playSprites.args.entersReady, { kind: "constant", value: true });
  // The token is created by this effect, not chosen by the player (355.7).
  assert.equal(playSprites.targets, undefined);
  assert.equal(playSprites.picks, undefined);
  assert.equal(playSprites.linkedTo, undefined);
});

test("unl-069-219 Sprite Burst: the program's chain-play shape creates and plays a token", () => {
  // The card's own Sprite definition is not part of this execution; the merged
  // play-mode handoff itself (create-token to "chain" + play) is exercised with
  // a definition the merged effect.token table resolves, so this assertion
  // stays true whether or not the Sprite entry later lands.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: playSprites.args.amount,
      mode: playSprites.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "sprites" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const tokens = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(tokens.length, 2);
  for (const created of tokens) {
    assert.deepEqual(created.location, { type: "base", player: "A" });
    assert.equal(created.controller, "A");
    assert.equal(created.energy, null);
    assert.equal(created.power, null);
  }
  assert.deepEqual(run.events.map((event) => event.action), [
    "create-token",
    "play",
    "create-token",
    "play"
  ]);
});

test.todo(
  "unl-069-219 Sprite Burst: add the 3 Might Sprite token definition (CR 187.2: domainless unit token, " +
    "3 Might, Fae tag, Temporary keyword) to effect.token — RIFT-9 token table"
);

test.todo(
  "unl-069-219 Sprite Burst: the printed ready entry-state override for created tokens " +
    "(CR 143.4 / 184.1 / 185.2.d) — create-token does not support entry overrides, and create-then-ready " +
    "would emit a wrong became-ready event"
);

test.todo(
  "unl-069-219 Sprite Burst: the Sprite's own [Temporary] trigger (CR 816.1.b: kill at the start of its " +
    "controller's Beginning Phase, before scoring) firing through the keyword/chain pipeline"
);
