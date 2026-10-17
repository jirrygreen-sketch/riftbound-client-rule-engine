// Golden test for Hunting Dog (rad-119-167).
// The Deathknell declaration, the object-killed trigger and the token request
// shape and controller-relative base binding are verifiable; the Bird
// definition and Deathknell/Deflect consumers remain judged (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunting-dog.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { appliedCosts } from "../../../../engine-core/dist/layers/rules/query.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-883ac11e924326f2848f19e337d6d2f7e70dc660d572f974d06708fc1f752353";
const SOURCE_TEXT =
  "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
  "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [deathknellKeyword, killedTrigger] = program.abilities;
const [bindBase, playBird] = killedTrigger.body;

test("rad-119-167 Hunting Dog: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-119-167 Hunting Dog: judgeReason names the Bird definition, Deathknell and Deflect consumers", () => {
  assert.match(program.judgeReason, /Bird/);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /target\.tax/);
});

test("rad-119-167 Hunting Dog: [Deathknell] is declared as a keyword ability (808.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(keywordDefinitionsById.get("Deathknell"), deathknell);
});

test("rad-119-167 Hunting Dog: the merged Deathknell expansion declares its trigger.leave body", () => {
  const [expansion] = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "object-killed");
  assert.deepEqual(expansion.body.map((entry) => entry.op), ["trigger.leave"]);
});

test("rad-119-167 Hunting Dog: the Deathknell effect is an explicit self object-killed trigger (808.1.c, 808.1.d)", () => {
  assert.equal(killedTrigger.kind, "triggered");
  assert.equal(killedTrigger.trigger.at, "object-killed");
  assert.deepEqual(killedTrigger.trigger.filter, { self: true });
  assert.equal(killedTrigger.trigger.condition, undefined);
  assert.equal(killedTrigger.optional, false);
});

test("rad-119-167 Hunting Dog: the body plays a 1 Might Bird token with Deflect to your base (187.7, 440.2.c)", () => {
  assert.equal(killedTrigger.body.length, 2);
  assert.equal(bindBase.id, "hunting-dog.base");
  assert.equal(bindBase.op, "condition.value");
  assert.deepEqual(bindBase.args.value, { kind: "location", value: "ability-controller-base" });
  assert.equal(playBird.id, "hunting-dog.play-bird-token");
  assert.equal(playBird.op, "effect.token");
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成，再由 play 接手。
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBird.args.location, {
    kind: "linked-value", instructionId: bindBase.id, key: "value"
  });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "birdToken" });
  // The token's Deflect belongs to the 187.7 definition, not to a hand-written
  // keyword grant on this instruction (the definition table has no bird entry).
  assert.equal(playBird.args.keywords, undefined);
});

test("rad-119-167 Hunting Dog boundary: an unresolved Bird request has empty receipts and no token side effects", () => {
  const kernel = world().build();
  const before = kernel.snapshot();
  const run = resolveChainBody(killedTrigger.body, kernel);

  assert.deepEqual(run.linkedValues[`${bindBase.id}.value`], { type: "base", player: "A" });
  assert.equal(run.linkedValues[`${playBird.id}.birdToken.amount`], 0);
  assert.deepEqual(run.linkedValues[`${playBird.id}.birdToken.objects`], []);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  assert.deepEqual(run.results.at(-1).result.events, []);
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.snapshot(), before);
});

test("rad-119-167 Hunting Dog: the merged Deflect expansion is a static target tax and leaves movement costs alone", () => {
  const definition = keywordDefinitionsById.get("Deflect");
  assert.ok(definition, "effects/keywords/Deflect.ts must be registered");
  const [expansion] = definition.expand({ value: 1, host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.deepEqual(expansion.effect, { kind: "target.tax", value: { kind: "constant", value: 1 } });
  const registry = createContinuousEffectRegistry();
  assert.deepEqual(appliedCosts(registry, "move"), []);
});

test.todo(
  "rad-119-167 Hunting Dog: the 1 Might Bird unit token definition with the Bird tag and [Deflect] " +
    "(CR 187.7) needs a token definition carrying Bird and Deflect abilities"
);
test("rad-119-167 Hunting Dog golden: your base follows the ability controller even when the source has another owner", () => {
  for (const controller of ["A", "B"]) {
    const base = world().unit("dog", {
      owner: controller === "A" ? "B" : "A", controller,
      location: { type: "battlefield", id: "away-from-base" }
    }).build();
    const kernel = base.clone({ controller, sourceSnapshot: base.getObject("dog") });
    const outcome = resolveChainBody(killedTrigger.body, kernel);
    assert.deepEqual(outcome.linkedValues[`${bindBase.id}.value`], { type: "base", player: controller });
    assert.equal(outcome.results[0].result.status, "executed");
    assert.deepEqual(outcome.events, []);
    assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
  }
});
test.todo(
  "rad-119-167 Hunting Dog: the full Deathknell expansion — the trigger.leave subscription and removal " +
    "from the chain when the death is replaced (CR 808.1.d.1/808.1.d.3)"
);
test.todo(
  "rad-119-167 Hunting Dog: [Deflect] as the mandatory target additional cost on the created token " +
    "(CR 809.1.c) needs the target.tax consumer and any-Domain Power payment"
);
