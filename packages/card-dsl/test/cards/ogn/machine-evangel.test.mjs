import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/machine-evangel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-17636361767d3b9981692423637f956799fa03a84c22ee687c41f59f2b58aa59";
const [keyword, effect] = program.abilities;
const [tokenInstruction] = effect.body;

test("ogn-239-298 Machine Evangel: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-239-298 Machine Evangel: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /cause/);
  assert.match(program.judgeReason, /controller-base/);
  assert.equal(
    program.sourceText,
    "[Deathknell] — Play three 1 :rb_might: Recruit unit tokens into your base. (When I die, get the effect.)"
  );
});

test("ogn-239-298 Machine Evangel: [Deathknell] keyword plus the explicit when-I-die effect body", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  // CR 808.1.c: Deathknell is functionally "When I die, [Effect]."; the effect body is
  // authored explicitly (the same convention as sfd-167-221 Unsung Hero).
  assert.equal(effect.kind, "triggered");
  assert.equal(effect.trigger.at, "object-killed");
  assert.deepEqual(effect.trigger.filter, { self: true });
  assert.equal(effect.optional, false);
  assert.equal(effect.trigger.condition, undefined);
});

test("ogn-239-298 Machine Evangel: the effect plays three 1-Might Recruit tokens into the base", () => {
  assert.equal(effect.body.length, 1);
  assert.equal(tokenInstruction.id, "machine-evangel.play-recruits");
  assert.equal(tokenInstruction.op, "effect.token");
  // CR 187.1: a 1 [M] Recruit is a domainless 1-Might unit token with the Recruit tag.
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 3 });
  // CR 440.2.c / 185.2.a: a token that is played is created on the chain and then played.
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "machineEvangelRecruits" });
  assert.equal(tokenInstruction.targets, undefined);
  assert.equal(tokenInstruction.picks, undefined);
  assert.equal(tokenInstruction.linkedTo, undefined);
});

test("ogn-239-298 Machine Evangel: the Deathknell expansion produces the death trigger skeleton whose body is the trigger.leave reference", () => {
  // The keyword expands to the trigger skeleton and references the leave
  // subscription op; the effect body itself is authored on the card.
  const expansion = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].trigger.at, "object-killed");
  assert.equal(expansion[0].body[0].op, "trigger.leave");
});

test("ogn-239-298 Machine Evangel: three Recruits land in the playing player's base once located", () => {
  // The controller's base is substituted for the placeholder here; the declared args keep
  // the printed "your base" wording (asserted above).
  const kernel = world().build();
  const run = runInstruction(token, {
    ...tokenInstruction.args,
    location: { kind: "constant", value: { type: "base", player: "A" } }
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["machineEvangelRecruits.amount"], 3);
  const tokens = kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 3);
  for (const created of tokens) {
    assert.equal(created.name, "Recruit");
    assert.equal(created.might, 1);
    assert.deepEqual(created.tags, ["Recruit"]);
    assert.deepEqual(created.location, { type: "base", player: "A" });
    assert.equal(created.zone, "board");
  }
});

test("ogn-239-298 Machine Evangel: the effect body executes through the ability interpreter with a located base", () => {
  const kernel = world().build();
  const outcome = resolveChainBody([{
    ...tokenInstruction,
    args: { ...tokenInstruction.args, location: { kind: "constant", value: { type: "base", player: "A" } } }
  }], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["machine-evangel.play-recruits", "executed"]
  ]);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 3);
  // Linked keys are namespaced by the instruction's execution path.
  assert.deepEqual(outcome.linkedValues["machine-evangel.play-recruits.machineEvangelRecruits.amount"], 3);
  assert.equal(
    outcome.linkedValues["machine-evangel.play-recruits.machineEvangelRecruits.objects"].length,
    3
  );
});

test.todo(
  "ogn-239-298 Machine Evangel: registering the [Deathknell] trigger needs an executable " +
    "trigger.leave instruction and a trigger adapter that accepts the expansion's cause / " +
    "destination filter (CR 808.1.d/429.1.a.1.b)"
);
test.todo(
  "ogn-239-298 Machine Evangel: resolving 'into your base' (CR 440.4) needs effect.token to " +
    "resolve the controller-base placeholder into the acting player's Base"
);
