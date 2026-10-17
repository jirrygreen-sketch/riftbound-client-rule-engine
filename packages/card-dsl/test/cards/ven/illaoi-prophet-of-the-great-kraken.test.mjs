import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/illaoi-prophet-of-the-great-kraken.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-aab496105448f9073e9ec14bc0fc63bb55d3209146671be6e19899fb696a2bd2";
const SOURCE_TEXT =
  "When you play me or when I score, play a :rb_energy_1: :rb_might: Tentacle unit token from Bilgewater.\n" +
  "I have +1 :rb_might: for each token unit you control.";

const [playTrigger, scoreTrigger, mightAbility] = program.abilities;
const [playTentacle] = playTrigger.body;
const [scoreTentacle] = scoreTrigger.body;

const illaoiKernel = () => world().player("controller").build().clone({ controller: "controller" });

test("ven-109-166 Illaoi: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-109-166 Illaoi: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /score/);
  assert.match(program.judgeReason, /473\.2/);
});

test("ven-109-166 Illaoi: the two printed triggers are separate, both playing the Tentacle token", () => {
  assert.deepEqual(playTrigger.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self" } }
  });
  // 470.3 / 473.2：Scoring（不是 “Score X points”）的封闭时点。
  assert.deepEqual(scoreTrigger.trigger, {
    at: "score",
    filter: { event: "score", filter: { source: "self" } }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(scoreTrigger.optional, false);

  // 指令 id 在卡内唯一；两条触发共用同一印文效果。
  assert.equal(playTentacle.id, "illaoi.play-tentacle-token");
  assert.equal(scoreTentacle.id, "illaoi-score.play-tentacle-token");
  for (const instruction of [playTentacle, scoreTentacle]) {
    assert.equal(instruction.op, "effect.token");
    // 187.10：Tentacle = 1 Might、Bilgewater 标签的无领域单位 token。
    assert.deepEqual(instruction.args.token, { kind: "constant", value: "tentacle" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // 440.2.c / 185.2.a：被「打出」的 token 先在链上创建。
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
    assert.deepEqual(instruction.args.location, {
      kind: "constant",
      value: { type: "base", player: "controller" }
    });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("ven-109-166 Illaoi: +1 Might for each token unit you control", () => {
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.equal(mightAbility.effect.appliesTo, "self");
  assert.equal(mightAbility.effect.amount.kind, "count");
  assert.equal(mightAbility.effect.amount.subject, "token-units-you-control");
  assert.deepEqual(mightAbility.effect.amount.filter, {
    type: "token",
    controller: "controller",
    zone: "board"
  });
  assert.equal(mightAbility.condition, undefined);
});

test("ven-109-166 golden: the printed Tentacle token is really created and played (187.10)", () => {
  const kernel = illaoiKernel();
  const run = runInstruction(token, playTentacle.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(
    run.events.map(event => [event.action, event.timingPoint]),
    [
      ["create-token", "chain-item-pending"],
      ["play", "card-played"]
    ]
  );

  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [tentacle] = created;
  assert.equal(tentacle.name, "Tentacle");
  assert.equal(tentacle.might, 1);
  assert.deepEqual(tentacle.tags, ["Bilgewater"]);
  assert.equal(tentacle.isToken, true);
  assert.equal(tentacle.controller, "controller");
  assert.deepEqual(tentacle.location, { type: "base", player: "controller" });
  // 185.3：token 没有印刷费用与领域——null 表示没有印刷值，绝不是 0。
  assert.equal(tentacle.energy, null);
  assert.equal(tentacle.power, null);

  assert.equal(run.linked["tentacle.amount"], 1);
  assert.equal(run.linked["tentacle.objects"].length, 1);
  assert.deepEqual(kernel.pendingItems, []);
});

test("ven-109-166 golden: the score-trigger body drives the same token path", () => {
  const kernel = illaoiKernel();
  const run = runInstruction(token, scoreTentacle.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].tags, ["Bilgewater"]);
  assert.equal(created[0].might, 1);
});

test("ven-109-166 golden: the token definition stays domainless and never gains a printed cost", () => {
  // 185.3.a.1 说明 token 的费用“视为 0”，但这不是印刷值：定义表里保持 null。
  const kernel = illaoiKernel();
  runInstruction(token, playTentacle.args, { world: kernel });
  const [tentacle] = kernel.query({ zone: "board", type: "unit" });
  assert.equal(tentacle.energy, null);
  assert.equal(tentacle.power, null);
  assert.notEqual(tentacle.energy, 0);
  assert.notEqual(tentacle.power, 0);
});

test("ven-109-166 golden: an opponent's base is not a legal unit Base destination", () => {
  // 契约 3.6：单位 token 只能创建在控制者自己的 Base；非法目的地按要求 negated。
  const kernel = world().player("controller").player("B").build().clone({ controller: "controller" });
  const run = runInstruction(
    token,
    {
      ...playTentacle.args,
      location: { kind: "constant", value: { type: "base", player: "B" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test.todo(
  "ven-109-166 Illaoi: subscribe 'when I score' (470.3 / 473.2) — scoring/ only hands the score trigger flags to " +
    "turn-executor-v2; nothing emits it into the single event pipeline, and the merged score GameAction carries " +
    "no object/battlefieldId payload for the 473.2 battlefield anchor"
);

test.todo(
  "ven-109-166 Illaoi: '+1 :rb_might: for each token unit you control' needs the card-side continuous.might " +
    "registration plus an arithmetic layer that evaluates a count amount (layers/engine.ts valueOf returns the " +
    "count expression unchanged); the merged filter also treats an array type as OR, so 'token unit' currently " +
    "matches token gear"
);

test.todo(
  "ven-109-166 Illaoi: the card-played trigger registration path is merged (programs/triggers.ts -> " +
    "events/pipeline.registerTrigger); the score trigger waits on the same score-pipeline gap as the first todo"
);
