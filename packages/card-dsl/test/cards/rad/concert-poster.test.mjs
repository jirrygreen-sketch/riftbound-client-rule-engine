// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/concert-poster.js";
// 生产链路的解释器适配器：把卡牌 args 的 Expr 原样传给已注册原语（RIFT-1xx 契约 3.6 约定）。
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CARD_ID = "card.hash-03f357977584ddf7e53bbe67b5c7b5c02cdcafe1cf40d289953589949e85d0d4";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this or when you conquer here, you may pay :rb_energy_1: to play a 1 :rb_might: Recruit unit token to your base.";

/** 参考内核不认识 "controller" 占位（生产链路由 Finalize 解析），测试里替换为具体玩家。 */
const concretize = (body, player) => JSON.parse(JSON.stringify(body, (_key, value) =>
  value && typeof value === "object" && value.type === "base" && value.player === "controller"
    ? { type: "base", player }
    : value));

test("rad-116-167 Concert Poster: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Deploy/);
  // RIFT-357 (runtime locations) is merged and is no longer the blocker; the
  // remaining gaps are the Deploy layer mapping and the `here` event anchor.
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /here/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357/);
});

test("rad-116-167 Concert Poster: Deploy keyword plus play/conquer optional Recruit bodies", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, onPlay, onConquer] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // “When you play this”：card-played 时点 + 自指过滤（383.4.a / 407）。
  assert.equal(onPlay.kind, "triggered");
  assert.deepEqual(onPlay.trigger, { at: "card-played", filter: { event: "card-played", self: true } });
  assert.equal(onPlay.optional, true);

  // “when you conquer here”：conquer 时点 + here（468.5.d / 471.1 / 473.2.a）。
  assert.equal(onConquer.kind, "triggered");
  assert.deepEqual(onConquer.trigger, {
    at: "conquer",
    filter: { event: "conquered", here: true, player: "controller" }
  });
  assert.equal(onConquer.optional, true);

  // 契约 3.9：“可以……”= choice.optional 把被选指令包进 body（不是 choice + linkedTo）。
  for (const [ability, prefix] of [[onPlay, "concert-poster.play"], [onConquer, "concert-poster.conquer"]]) {
    assert.equal(ability.body.length, 1);
    const [choice] = ability.body;
    assert.equal(choice.id, `${prefix}-opt-in`);
    assert.equal(choice.op, "choice.optional");
    assert.equal(choice.args.body.kind, "constant");
    const [pay, play] = choice.args.body.value;
    assert.deepEqual(choice.args.body.value.map((instruction) => instruction.id), [
      `${prefix}-pay`,
      `${prefix}-recruit`
    ]);
    assert.equal(pay.op, "cost.pay");
    assert.deepEqual(pay.args.payments, {
      kind: "constant",
      value: { energy: 1 }
    });
    assert.equal(pay.linkedTo, undefined);
    assert.equal(play.op, "effect.token");
    assert.equal(play.linkedTo, `${prefix}-pay`);
    assert.deepEqual(play.args.token, { kind: "constant", value: "recruit" });
    assert.deepEqual(play.args.amount, { kind: "constant", value: 1 });
    // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成，再由 effect.token 的 play 模式接手。
    assert.deepEqual(play.args.mode, { kind: "constant", value: "play" });
    assert.deepEqual(play.args.location, {
      kind: "constant",
      value: { type: "base", player: "controller" }
    });
  }
});

test("rad-116-167 Concert Poster: declining both triggers skips payment and token play", () => {
  for (const [ability, prefix] of [[program.abilities[1], "concert-poster.play"], [program.abilities[2], "concert-poster.conquer"]]) {
    const kernel = world().player("A", { energy: 2 }).build();
    kernel.setAnswers({ [`${prefix}-opt-in/optional`]: false });
    const outcome = runAbilityBody(ability.body, kernel);
    assert.deepEqual(outcome.results.map((result) => result.id), [`${prefix}-opt-in`]);
    assert.equal(outcome.results[0].result.status, "negated");
    assert.equal(outcome.results[0].result.reason, "skipped");
    // 拒绝时不评估 cost.pay，也不生成 token、不产生事件。
    assert.deepEqual(kernel.events, []);
    assert.equal(kernel.query({ zone: "board" }).length, 0);
  }
});

test("rad-116-167 Concert Poster: the Recruit token leaf runs through chain create + play (CR 187.1 / 440.2.c)", () => {
  const kernel = world().player("A", { energy: 2 }).build();
  const playInstruction = program.abilities[1].body[0].args.body.value[1];
  // Execute the token leaf independently to keep the token action evidence
  // focused; the accepted branch below covers its paid form end to end.
  const leaf = { ...playInstruction, linkedTo: undefined };
  const outcome = resolveChainBody(concretize([leaf], "A"), kernel);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.equal(outcome.results[0].result.status, "executed");

  const created = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.length, 1);
  const [token] = created;
  assert.equal(token.name, "Recruit");
  assert.equal(token.might, 1);
  assert.deepEqual(token.location, { type: "base", player: "A" });
  assert.equal(token.controller, "A");
  // 解释器把链接值按指令路径限定：<instruction id>.<linkKey>.<key>。
  assert.deepEqual(outcome.linkedValues[`${leaf.id}.recruit.objects`], [token.ref]);
  assert.equal(outcome.linkedValues[`${leaf.id}.recruit.amount`], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["create-token", "play"]);
  assert.deepEqual(outcome.events.map((event) => event.timingPoint), ["chain-item-pending", "card-played"]);
});

test("rad-116-167 Concert Poster: accepting the play trigger pays 1 energy before playing Recruit", () => {
  const kernel = world().player("A", { energy: 2 }).build();
  kernel.setAnswers({ "concert-poster.play-opt-in/optional": true });
  const outcome = resolveChainBody(concretize(program.abilities[1].body, "A"), kernel);

  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["concert-poster.play-pay", "executed"],
      ["concert-poster.play-recruit", "executed"],
      ["concert-poster.play-opt-in", "executed"]
    ]
  );
  assert.equal(kernel.player("A").energy, 1);
  const recruits = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(recruits.length, 1);
  assert.equal(recruits[0].name, "Recruit");
  assert.deepEqual(recruits[0].location, { type: "base", player: "A" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["pay", "create-token", "play"]);
});

test("rad-116-167 Concert Poster: the play trigger really binds through the merged program adapter", () => {
  // 383.4.a / 407: "When you play this" is a card-played trigger whose self
  // filter the merged adapter translates into the source's own objectId. The
  // card stays judge-required (see judgeReason), so the translation layer is
  // exercised directly rather than through the executable-only registry path.
  assert.deepEqual(
    translateTriggerFilter(program.abilities[1].trigger.filter, "poster", "card-played"),
    { event: "card-played", object: { objectId: "poster" } }
  );
});

test("rad-116-167 Concert Poster: the conquer trigger's here anchor is still rejected, never rebound", () => {
  // 468.5.d / 471.1: the conquer trigger is scoped "here". The merged
  // translator has no evaluable battlefield anchor for that key, so it refuses
  // the registration instead of subscribing to every conquer for the player.
  const filter = program.abilities[2].trigger.filter;
  assert.throws(
    () => translateTriggerFilter(filter, "poster", "conquer"),
    /Unsupported filter field here/
  );
});
