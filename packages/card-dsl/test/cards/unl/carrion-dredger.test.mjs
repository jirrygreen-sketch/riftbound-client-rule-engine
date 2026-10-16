import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/carrion-dredger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-eecb1b7c0e454c85db65c33eaab1cd2d826115fe40c063e70baa81ad2bf8a7d7";
const SOURCE_TEXT =
  "[Deathknell][>] Play a 1 :rb_might: Bird unit token with [Deflect] to your base. " +
  "(When I die, get the effect. Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [deathknellKeyword, diesTrigger] = program.abilities;
const [playBird] = diesTrigger.body;

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
  assert.match(program.judgeReason, /RIFT-82/);
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
  assert.equal(diesTrigger.body.length, 1);
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
    kind: "constant",
    value: { type: "base", player: "controller" }
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
test.todo(
  "unl-153-219 Carrion Dredger: resolve the controller-relative base destination (CR 440.4, 185.2.a) — " +
    "effect.token evaluates location as literal data and accepts only a concrete PlayerId"
);
test.todo(
  "unl-153-219 Carrion Dredger: expand [Deathknell] and register the death trigger into the event " +
    "pipeline (CR 808.1.c / 808.1.d / 429.1.a.1.b) — the KeywordDef references the unmerged trigger.leave " +
    "op (RIFT-82 / RIFT-257)"
);
