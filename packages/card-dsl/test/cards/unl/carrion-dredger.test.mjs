import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/carrion-dredger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-eecb1b7c0e454c85db65c33eaab1cd2d826115fe40c063e70baa81ad2bf8a7d7";
const SOURCE_TEXT =
  "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
  "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [deathknellKeyword, diesTrigger] = program.abilities;
const [controllerBase, playBird] = diesTrigger.body;

test("unl-153-219 Carrion Dredger: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-153-219 Carrion Dredger: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /Bird/);
  assert.match(program.judgeReason, /trigger\.leave/);
});

test("unl-153-219 Carrion Dredger: [Deathknell] is declared (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknellKeyword.value, undefined);
  const registered = keywordDefinitionsById.get("Deathknell");
  assert.ok(registered, "effects/keywords/Deathknell.ts must be in the generated registry");
  assert.equal(deathknellKeyword.keyword, registered.keyword.toLowerCase());
});

test("unl-153-219 Carrion Dredger: the printed [Effect] is a death trigger without a target", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, { self: true });
  assert.equal(diesTrigger.optional, false);
  assert.equal(diesTrigger.body.length, 2);
  assert.equal(controllerBase.id, "carrion-dredger.controller-base");
  assert.equal(controllerBase.op, "condition.value");
  assert.deepEqual(controllerBase.args, {
    value: { kind: "location", value: "ability-controller-base" },
    key: { kind: "constant", value: "location" }
  });
});

test("unl-153-219 Carrion Dredger: the effect plays one 1-Might Bird token into the controller's base", () => {
  assert.equal(playBird.id, "carrion-dredger.play-bird-token");
  assert.equal(playBird.op, "effect.token");
  // 187.7：1 [M] Bird 是无域、Bird 标签并带 [Deflect] 的单位 token（reminder 与之逐字一致）。
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 185.2.a / 440.2.c：被“打出”的 token 先在链上创建，再交给打出流程。
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBird.args.location, {
    kind: "linked-value",
    instructionId: controllerBase.id,
    key: "location"
  });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "birdToken" });
  // [Deflect] 是 187.7 的 token 印刷特征，不是本效果另行授予的关键词；卡内不重复声明。
  assert.deepEqual(Object.keys(playBird.args).sort(), [
    "amount",
    "linkKey",
    "location",
    "mode",
    "token"
  ]);
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
  assert.equal(playBird.linkedTo, undefined);
});

test.todo(
  "unl-153-219 Carrion Dredger: add the CR 187.7 1-Might Bird token definition (domainless, Bird tag, " +
    "Deflect keyword) to effect.token's frozen definitions so mode \"play\" has an executable path"
);
test("unl-153-219 Carrion Dredger golden: the original location instruction resolves either controller's base (440.4)", () => {
  assert.deepEqual(token.argsSchema.parse(playBird.args), playBird.args);
  for (const controller of ["A", "B"]) {
    const owner = controller === "A" ? "B" : "A";
    const initial = world().unit("dredger", { owner, controller }).build();
    const kernel = initial.clone({
      controller,
      sourceSnapshot: initial.getObject("dredger")
    });
    const outcome = resolveChainBody([controllerBase, {
      id: "read-token-destination",
      op: "condition.value",
      args: { value: playBird.args.location }
    }], kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues[`${controllerBase.id}.location`], { type: "base", player: controller });
    assert.deepEqual(outcome.linkedValues["read-token-destination.value"], { type: "base", player: controller });
    assert.deepEqual(kernel.objects, initial.objects);
    assert.deepEqual(outcome.events, []);
  }
});
test.todo(
  "unl-153-219 Carrion Dredger: expand [Deathknell] and register the death trigger into the event " +
    "pipeline (CR 808.1.c / 808.1.d / 429.1.a.1.b) — the KeywordDef's trigger.leave expansion still " +
    "needs an InstructionDef and producer wiring"
);
