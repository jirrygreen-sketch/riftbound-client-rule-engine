import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mechanical-bandit.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { isTimingPointId, getTimingPoint } = await import(new URL("events/timing-points.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const reveal = (await import(new URL("effects/instructions/effect.reveal.js", ENGINE))).default;
const recycle = (await import(new URL("effects/instructions/effect.recycle.js", ENGINE))).default;

const CARD_ID = "card.hash-fbba24cf4707d7016fafc967822809401157688fd7d9c1ae90a2287ae2a2ea06";
const EXPECTED_SOURCE =
  "At the start of your Beginning Phase, each player reveals the top card of their Main Deck. " +
  "If you revealed a card with the lowest Energy cost, draw it. Recycle the rest.";

test("rad-111-167 Mechanical Bandit: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
});

test("rad-111-167 Mechanical Bandit: judgeReason records the current gaps only", () => {
  // The beginning-start emitter is merged, so it must no longer be listed as a
  // missing producer; the player fan-out, ordered top pick and comparison gaps remain.
  assert.match(program.judgeReason, /beginning-start 已有发出者/);
  assert.match(program.judgeReason, /each player/);
  assert.match(program.judgeReason, /ordered picks/);
  assert.match(program.judgeReason, /lowest Energy cost/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(/没有发出者|链层只把它用于清理时钟/.test(program.judgeReason), false);
});

test("rad-111-167 Mechanical Bandit: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-111-167 Mechanical Bandit: beginning-start is a real timing point with a merged producer (315.2.a.1)", () => {
  // The trigger's timing point is part of the closed enum, and the turn flow
  // publishes it via enter('beginning') (docs/rules/timing-point-producers.md).
  assert.equal(isTimingPointId("beginning-start"), true);
  const timing = getTimingPoint("beginning-start");
  assert.equal(timing.id, "beginning-start");

  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, {});
  assert.equal(ability.optional, false);
});

test("rad-111-167 Mechanical Bandit: the reveal instruction names the deck top and the 1-card count (425.1/425.3)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(program.abilities[0].body.length, 1);
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "mechanical-bandit.reveal");
  assert.equal(instruction.op, "effect.reveal");
  // 425.1 / 425.3：牌库顶必须按真实区域顺序读取，而不是集合查询；
  // player 的 "each-player" 是描述性占位（玩家扇出仍缺，见 judgeReason）。
  assert.deepEqual(instruction.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(instruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.player, { kind: "constant", value: "each-player" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-111-167 Mechanical Bandit: revealing a whole single-card deck executes and links the top card", () => {
  // 可表达的部分：区域可以被完整展示（425.3.a）时不触发有序子集缺口。
  const instruction = program.abilities[0].body[0];
  const kernel = world().deck("only-card").build();
  const run = runInstruction(
    reveal,
    {
      player: { kind: "constant", value: "A" },
      zone: instruction.args.zone,
      count: instruction.args.count
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed.map((ref) => ref.id), ["only-card"]);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal"]);
  // 425.1.a.2：Reveal 不改变区域，牌仍在牌库顶。
  assert.equal(kernel.getObject("only-card").zone, "deck");
  assert.equal(kernel.player("A").deckSize, 1);
});

test("rad-111-167 Mechanical Bandit: \"Recycle the rest\" would go through effect.recycle but has no bound \"rest\" set", () => {
  // 回收原语本身已合入：显式给出对象时它真的把牌放到拥有者牌库底（417.1.a / 417.1.c）。
  const kernel = world().deck(["d1", "d2"]).build();
  const rest = kernel.zone("A", "deck").find((ref) => ref.id === "d1");
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [rest] } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("d1").zone, "deck");
  // 回收后该牌在拥有者 Main Deck 底：剩下的顶牌是 d2。
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d2", "d1"]);
});

test.todo("rad-111-167 Mechanical Bandit: \"each player reveals the top card\" needs player fan-out (effect.reveal accepts a single PlayerId) and zone ordering for the reveal subset (consume zoneSlice, RIFT-64 gap).");
test.todo("rad-111-167 Mechanical Bandit: \"If you revealed a card with the lowest Energy cost, draw it. Recycle the rest.\" needs a cross-object minimum of Energy costs (CR 206, null is not 0), binding that revealed card to the draw, and a set difference for the remainder.");
test.todo("rad-111-167 Mechanical Bandit: the card-played/beginning-start trigger must be registered into the event pipeline — no merged path consumes a CardProgram triggered ability (RIFT-257).");
