// Golden test for Hunting Dog (rad-119-167).
// The Deathknell declaration, the object-killed trigger and the token request shape
// are verifiable; the Bird definition, the on-chain play handoff and the Deflect
// expansion are judged (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunting-dog.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-883ac11e924326f2848f19e337d6d2f7e70dc660d572f974d06708fc1f752353";
const SOURCE_TEXT =
  "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
  "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [deathknellKeyword, killedTrigger] = program.abilities;
const [playBird] = killedTrigger.body;

test("rad-119-167 Hunting Dog: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-119-167 Hunting Dog: judgeReason names the Bird definition, the play pipeline, Deathknell and Deflect", () => {
  assert.match(program.judgeReason, /Bird/);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /RIFT-82/);
});

test("rad-119-167 Hunting Dog: [Deathknell] is declared as a keyword ability (808.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(keywordDefinitionsById.get("Deathknell"), deathknell);
  // The registered KeywordDef already expands to the object-killed skeleton whose
  // body still cites the unmerged trigger.leave primitive (RIFT-82 gap).
  const [expansion] = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "object-killed");
  assert.deepEqual(expansion.body.map(entry => entry.op), ["trigger.leave"]);
  assert.equal(keywordDefinitionsById.has("trigger.leave"), false);
});

test("rad-119-167 Hunting Dog: the Deathknell effect is an explicit self object-killed trigger (808.1.c, 808.1.d)", () => {
  assert.equal(killedTrigger.kind, "triggered");
  assert.equal(killedTrigger.trigger.at, "object-killed");
  assert.deepEqual(killedTrigger.trigger.filter, { self: true });
  assert.equal(killedTrigger.trigger.condition, undefined);
  assert.equal(killedTrigger.optional, false);
});

test("rad-119-167 Hunting Dog: the body plays a 1 Might Bird token with Deflect to your base (187.7, 440.2.c)", () => {
  assert.equal(killedTrigger.body.length, 1);
  assert.equal(playBird.id, "hunting-dog.play-bird-token");
  assert.equal(playBird.op, "effect.token");
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成，再由 play 接手。
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBird.args.locations.value, [{ type: "base", player: "controller" }]);
  assert.equal(playBird.args.choiceId.value, "bird-token-base");
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "birdToken" });
  // The token's Deflect belongs to the 187.7 definition, not to a hand-written
  // keyword grant on this instruction (the frozen table has no bird entry).
  assert.equal(playBird.args.keywords, undefined);
});

test("rad-119-167 Hunting Dog: the frozen token table rejects the Bird definition", () => {
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: playBird.args.token,
      amount: playBird.args.amount,
      mode: playBird.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playBird.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked["birdToken.amount"], 0);
  assert.deepEqual(run.linked["birdToken.objects"], []);
  assert.equal(
    run.linked.birdToken.blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test.todo(
  "rad-119-167 Hunting Dog: the 1 Might Bird unit token definition with the Bird tag and [Deflect] " +
    "(CR 187.7) — deliberately absent from the frozen effect.token table (RIFT-62/RIFT-63)"
);
test.todo(
  "rad-119-167 Hunting Dog: playing the new token through on-chain creation plus the play handoff " +
    "(CR 440.2.c/185.2.a/350.2/354) and the production play pipeline (contract §7.2 batch 4/5)"
);
test.todo(
  "rad-119-167 Hunting Dog: the full Deathknell expansion — trigger.leave subscription and removal from the " +
    "chain when the death is replaced (CR 808.1.d.1/808.1.d.3) — RIFT-82"
);
test.todo(
  "rad-119-167 Hunting Dog: [Deflect] as the mandatory target additional cost on the created token " +
    "(CR 809.1.c) — target.tax plus the cost.pay pipeline are unmerged (RIFT-84/RIFT-89)"
);

