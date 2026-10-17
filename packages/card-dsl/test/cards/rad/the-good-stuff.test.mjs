import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/the-good-stuff.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const zone = (await import(new URL("effects/instructions/effect.zone.js", ENGINE))).default;
const discard = (await import(new URL("effects/instructions/effect.discard.js", ENGINE))).default;
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CARD_ID = "card.hash-a3ace5aa975d32c702f9be7ba7a0dc4c7ca23449408374628a66fc6dc72cfd58";
const EXPECTED_SOURCE =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this, discard 1, then draw 3.\n" +
  "When you hold here, return this to its owner's hand.";

test("rad-106-167 The Good Stuff: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /playLocations/);
  assert.match(program.judgeReason, /here 过滤/);
});

test("rad-106-167 The Good Stuff: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-106-167 The Good Stuff: Deploy keyword plus play-triggered discard/draw and hold-triggered return", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, onPlay, onHold] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 383.4.a.1：Gear 的 Play Effect。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(onPlay.optional, false);
  assert.deepEqual(onPlay.body.map((step) => [step.id, step.op]), [
    ["the-good-stuff.discard-1", "effect.discard"],
    ["the-good-stuff.draw-3", "effect.draw"]
  ]);
  // 「then」是顺序词：draw 不绑定 disc 的结果（不写 linkedTo）。
  assert.equal(onPlay.body[1].linkedTo, undefined);
  assert.deepEqual(onPlay.body[0].args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(onPlay.body[1].args.amount, { kind: "constant", value: 3 });

  // 383.4.d.1：Hold Effect。
  assert.equal(onHold.kind, "triggered");
  assert.equal(onHold.trigger.at, "hold");
  assert.deepEqual(onHold.trigger.filter, { event: "hold", here: true, player: "self" });
  assert.equal(onHold.optional, false);
  assert.deepEqual(onHold.body.map((step) => [step.id, step.op]), [
    ["the-good-stuff.return-to-hand", "effect.zone"]
  ]);
});

test("rad-106-167 The Good Stuff: the return instruction sends the source to its owner's hand", () => {
  const [instruction] = program.abilities[2].body;
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "the-good-stuff-self" });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(instruction.targets, [{
    id: "the-good-stuff-self",
    filter: { source: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  const kernel = world()
    .unit("the-good-stuff", {
      types: ["gear"],
      might: null,
      energy: 3,
      power: ["Body"],
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const run = runInstruction(
    zone,
    { target: instruction.args.target.value, to: instruction.args.to },
    { world: kernel, targets: { "the-good-stuff-self": [kernel.ref("the-good-stuff")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("the-good-stuff").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["the-good-stuff"]);
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
});

test("rad-106-167 The Good Stuff: discard 1 then draw 3 replays through the real interpreter", () => {
  const [discardInstruction, drawInstruction] = program.abilities[1].body;
  const kernel = world().hand("h1").hand("h2").hand("h3").deck(["d1", "d2", "d3", "d4"]).build();

  // 第一次执行先挂起在弃牌选择上：事务回滚，世界不变（契约 3.6 choose 的重放式挂起）。
  const asked = runInstruction(
    discard,
    { amount: discardInstruction.args.amount },
    { world: kernel }
  );
  assert.ok(asked.asked, "discard must suspend for the hand choice");
  assert.equal(asked.asked.request.id, "effect.discard:A");
  assert.equal(kernel.player("A").handSize, 3);
  assert.equal(kernel.player("A").deckSize, 4);

  const discarded = runInstruction(
    discard,
    { amount: discardInstruction.args.amount },
    { world: kernel, answers: { "effect.discard:A": [kernel.zone("A", "hand")[0]] } }
  );
  assert.equal(discarded.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["h1"]);
  assert.equal(kernel.player("A").handSize, 2);

  const drawn = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );
  assert.equal(drawn.result.status, "executed");
  assert.equal(drawn.linked.drawn, 3);
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["h1"]);
  assert.equal(kernel.player("A").handSize, 5);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("rad-106-167 The Good Stuff: an empty hand negates the discard but the draw still resolves (CR 055)", () => {
  const [discardInstruction, drawInstruction] = program.abilities[1].body;
  const kernel = world().deck(["d1", "d2", "d3", "d4"]).build();
  const discarded = runInstruction(discard, { amount: discardInstruction.args.amount }, { world: kernel });
  assert.equal(discarded.result.status, "negated");
  assert.equal(discarded.result.reason, "impossible");
  assert.deepEqual(discarded.events, []);
  // 「then draw 3」是独立指令：弃牌被否定后抽牌照常结算（055）。
  const drawn = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(drawn.result.status, "executed");
  assert.equal(drawn.linked.drawn, 3);
  assert.equal(kernel.zone("A", "trash").length, 0);
  assert.equal(kernel.player("A").handSize, 3);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo("rad-106-167 The Good Stuff: the merged Deploy KeywordDef (CR 830.1.b) still has no structured consumers - the playLocations query reads only location-name strings, no Finalize caller consumes KeywordDef.location, cleanup has no non-Unit Deploy recall exemption, and the opponent-hold kill side has no consumer.");
test.todo("rad-106-167 The Good Stuff: the \"hold here\" trigger is registered, but the here filter key is rejected by programs/filters.ts and the hold timing point has no battlefield-identity payload, so \"this battlefield\" cannot be bound.");
