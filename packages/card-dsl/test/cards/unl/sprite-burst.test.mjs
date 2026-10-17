import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sprite-burst.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
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
  assert.match(program.judgeReason, /ARGUMENTS/);
  assert.match(program.judgeReason, /RIFT-265/);
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

test("unl-069-219 Sprite Burst: the card's own Sprite name is refused instead of substituted", () => {
  // 187.2: the printed Sprite carries its own Temporary ability, so the merged
  // token table refuses it with a documented blockedReason rather than playing a
  // different token (judgeReason gap 1).
  const kernel = world().player("A").build();
  const sprite = runInstruction(
    token,
    {
      token: playSprites.args.token,
      amount: playSprites.args.amount,
      mode: playSprites.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playSprites.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(sprite.result.status, "negated");
  assert.equal(sprite.linked.sprites.amount, 0);
  assert.equal(sprite.linked.sprites.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({ zone: "board" }).length, 0);
});

test("unl-069-219 Sprite Burst: the declared 'ready' entry stipulation is not a legal effect.token argument", () => {
  // 143.4 / 185.2.d: the printed readiness is an entry stipulation, and the
  // merged primitive's argument whitelist rejects the authored key, so the
  // shape cannot be executed as written (judgeReason gap 2).
  assert.throws(
    () => runInstruction(token, playSprites.args, { world: world().player("A").build() }),
    (error) => error instanceof TypeError && /entersReady/.test(error.message)
  );
});

test("unl-069-219 Sprite Burst: the merged Temporary expansion kills a Sprite-sized body (CR 816.1.b)", () => {
  // The keyword definition is merged, so the second half of the card text (the
  // reminder about killing each token) has a real expansion; only the token's
  // definition and entry state are missing.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  const [trigger] = temporary.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(trigger.trigger.at, "beginning-start");
  const kernel = world()
    .unit("sprite", { owner: "A", might: 3, tags: ["Fae"], isToken: true, keywords: [{ id: "Temporary" }] })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("sprite") });
  const outcome = resolveChainBody(trigger.body, context);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(context.getObject("sprite").zone, "trash");
});

test.todo(
  "unl-069-219 Sprite Burst: add the 3 Might Sprite token definition (CR 187.2: domainless unit token, " +
    "3 Might, Fae tag, Temporary keyword) to effect.token — the frozen definition table carries only " +
    "ability-free tokens today"
);

test.todo(
  "unl-069-219 Sprite Burst: the printed ready entry-state override for created tokens " +
    "(CR 143.4 / 184.1 / 185.2.d) — the effect.token ARGUMENTS whitelist rejects the declared entersReady key, " +
    "and create-then-ready would emit a wrong became-ready event"
);

test.todo(
  "unl-069-219 Sprite Burst: the Sprite's own [Temporary] trigger (CR 816.1.b: kill at the start of its " +
    "controller's Beginning Phase, before scoring) firing through the keyword/chain pipeline — the KeywordDef " +
    "body executes above, but a card program's keyword abilities are not registered at runtime"
);

